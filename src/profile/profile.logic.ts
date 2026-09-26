import type { Lang } from '@prisma/client';

/** Langues de l'interface (codes du frontend) → langue enregistrée pour les SMS et la voix. */
export const UI_LANGS = ['fr', 'en', 'fon', 'yo', 'bba', 'ddn'] as const;
export type UiLang = (typeof UI_LANGS)[number];

const UI_TO_LANG: Record<UiLang, Lang> = { fr: 'fr', en: 'en', fon: 'fon', yo: 'yoruba', bba: 'bariba', ddn: 'dendi' };
const LANG_TO_UI: Record<Lang, UiLang> = { fr: 'fr', en: 'en', fon: 'fon', yoruba: 'yo', bariba: 'bba', dendi: 'ddn' };

export const toLang = (ui: UiLang): Lang => UI_TO_LANG[ui];
export const toUiLang = (lang: Lang): UiLang => LANG_TO_UI[lang] ?? 'fr';

export const BLOOD_GROUPS = ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'] as const;

/** Marque des maladies déclarées par la personne elle-même (FHIR : verificationStatus « unconfirmed »). */
export const DECLARED = 'DECLARE';

/**
 * Adresse : « quartier · repère » en une seule chaîne (lue telle quelle par la livraison et le relais),
 * redécoupée pour l'écran de profil.
 */
const SEP = ' · ';
export function joinAddress(quartier?: string | null, repere?: string | null): string | null {
  const parts = [quartier, repere].map((s) => (s ?? '').replace(/\s+/g, ' ').trim());
  if (!parts[0] && !parts[1]) return null;
  return `${parts[0]}${parts[1] ? `${SEP}${parts[1]}` : ''}`;
}
export function splitAddress(address: string | null | undefined): { quartier: string; repere: string } {
  if (!address) return { quartier: '', repere: '' };
  const i = address.indexOf(SEP);
  return i === -1 ? { quartier: address, repere: '' } : { quartier: address.slice(0, i), repere: address.slice(i + SEP.length) };
}

export type BloodDecision =
  | { change: false }
  | { change: true; bloodGroup: string | null; bloodGroupSource: string | null }
  | { refused: true };

/**
 * Groupe sanguin saisi par la personne : il est « déclaré ». Un groupe vérifié par un soignant ou un
 * laboratoire ne peut pas être remplacé par une déclaration (seul un soignant peut le corriger).
 * `requested` : un groupe, null pour « Je ne sais pas ».
 */
export function patientBloodGroup(current: string | null, source: string | null, requested: string | null): BloodDecision {
  if (requested === current) return { change: false };
  if (source === 'VERIFIE') return { refused: true };
  return requested ? { change: true, bloodGroup: requested, bloodGroupSource: 'DECLARE' } : { change: true, bloodGroup: null, bloodGroupSource: null };
}

/** Allergies : sans doublon (casse ignorée), sans vide, dans l'ordre saisi. */
export function cleanList(items: string[] | undefined, max = 20): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items ?? []) {
    const s = raw.replace(/\s+/g, ' ').trim();
    const key = s.toLocaleLowerCase('fr');
    if (!s || seen.has(key)) continue;
    seen.add(key);
    out.push(s.charAt(0).toLocaleUpperCase('fr') + s.slice(1));
    if (out.length >= max) break;
  }
  return out;
}

/** Les quatre informations qui servent en urgence et pour être orienté : ce qu'il reste à remplir. */
export type MissingField = 'bloodGroup' | 'emergencyContact' | 'commune' | 'allergies';
export function missingFields(p: { bloodGroup: string | null; emergencyPhone: string | null; communeId: string | null; allergies: string[]; profileDoneAt: Date | null }): MissingField[] {
  const out: MissingField[] = [];
  if (!p.bloodGroup) out.push('bloodGroup');
  if (!p.emergencyPhone) out.push('emergencyContact');
  if (!p.communeId) out.push('commune');
  // « Aucune allergie » ne se distingue d'un oubli qu'une fois l'accueil terminé.
  if (!p.allergies.length && !p.profileDoneAt) out.push('allergies');
  return out;
}
