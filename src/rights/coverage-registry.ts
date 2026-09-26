/**
 * Interopérabilité avec le registre national de l'assurance maladie (ARCH) et des mutuelles.
 *
 * Ganji n'a pas d'accès réel au registre : l'adaptateur est une interface, et la seule
 * implémentation fournie est un BAC À SABLE déterministe, clairement nommé. En production, on
 * branche un adaptateur réel (échange sécurisé de l'administration, ex. X-Road / PNE) en changeant
 * le fournisseur COVERAGE_REGISTRY, sans toucher au reste du module.
 */

export type RegistryScheme = 'ARCH' | 'MUTUELLE';
export type RegistryStatus = 'ACTIF' | 'EN_ATTENTE' | 'INACTIF';
/** Motif d'un statut non actif, pour afficher la bonne prochaine étape. */
export type RegistryReason = 'NUMERO_INVALIDE' | 'NON_RACCORDE' | null;

export interface RegistryQuery {
  scheme: RegistryScheme;
  number: string;
  person: { firstName: string; lastName: string; birthDate: Date; npiLast4?: string | null };
}

export interface RegistryResult {
  status: RegistryStatus;
  /** Part prise en charge, en %. */
  rate: number;
  /** Numéro tel que le registre le connaît (forme canonique). */
  number: string;
  reason: RegistryReason;
  /** Prochaine étape pour la personne, en français. */
  nextStep: string | null;
  /** Fin de validité des droits, si le registre la donne. */
  validUntil: Date | null;
  /** Nom de la source, affiché en petit (« bac à sable »). */
  source: string;
}

export interface CoverageRegistry {
  readonly name: string;
  check(query: RegistryQuery): Promise<RegistryResult>;
}

export const COVERAGE_REGISTRY = Symbol('COVERAGE_REGISTRY');

/** Chiffre de contrôle de Luhn des 7 premiers chiffres d'un numéro ARCH. */
export function luhnCheckDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    let d = Number(body[body.length - 1 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10;
}

/** « arch 2024 1535 » → « ARCH-20241535 » ; null si ce n'est pas la forme ARCH-XXXXXXXX. */
export function normalizeArch(raw: string): string | null {
  const compact = raw.toUpperCase().replace(/[\s.-]/g, '');
  const m = /^(?:ARCH)?(\d{8})$/.exec(compact);
  return m ? `ARCH-${m[1]}` : null;
}

export function isValidArch(raw: string): boolean {
  const n = normalizeArch(raw);
  if (!n) return false;
  const digits = n.slice(5);
  return luhnCheckDigit(digits.slice(0, 7)) === Number(digits[7]);
}

/** Taux du volet « assurance maladie » de l'ARCH dans le bac à sable. */
export const ARCH_RATE = 70;

function endOfYear(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), 11, 31, 22, 59, 0));
}

/**
 * Registre BAC À SABLE, déterministe :
 * - ARCH, numéro ARCH-XXXXXXXX au chiffre de contrôle valide → ACTIF, 70 % (bénéficiaire du volet
 *   « risques maladie »), droits jusqu'au 31 décembre ;
 * - ARCH, numéro mal formé ou chiffre de contrôle faux → EN_ATTENTE, « vérifiez le numéro » ;
 * - MUTUELLE → EN_ATTENTE : les mutuelles ne sont pas raccordées ; la carte se montre à l'accueil.
 */
export class SandboxCoverageRegistry implements CoverageRegistry {
  readonly name = 'bac à sable';

  async check(q: RegistryQuery): Promise<RegistryResult> {
    const base = { validUntil: null, source: this.name };
    if (q.scheme === 'MUTUELLE') {
      return {
        ...base,
        status: 'EN_ATTENTE',
        rate: 0,
        number: q.number.trim().toUpperCase(),
        reason: 'NON_RACCORDE',
        nextStep: 'Votre mutuelle n’est pas encore raccordée : montrez votre carte de mutuelle à l’accueil de l’hôpital.',
      };
    }
    const canonical = normalizeArch(q.number);
    if (!canonical || !isValidArch(canonical)) {
      return {
        ...base,
        status: 'EN_ATTENTE',
        rate: 0,
        number: canonical ?? q.number.trim().toUpperCase(),
        reason: 'NUMERO_INVALIDE',
        nextStep: 'Numéro introuvable : vérifiez-le sur votre carte ARCH, ou passez au guichet ARCH de votre mairie.',
      };
    }
    return { ...base, status: 'ACTIF', rate: ARCH_RATE, number: canonical, reason: null, nextStep: null, validUntil: endOfYear() };
  }
}

/**
 * Choix de l'adaptateur. Seul le bac à sable existe aujourd'hui ; un adaptateur réel s'ajoute ici
 * (COVERAGE_REGISTRY=xroad…) sans modifier le service.
 */
export function coverageRegistryFactory(): CoverageRegistry {
  const which = process.env.COVERAGE_REGISTRY ?? 'sandbox';
  if (which !== 'sandbox') throw new Error(`Registre de couverture inconnu : ${which}`);
  return new SandboxCoverageRegistry();
}
