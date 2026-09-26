import { randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Règles métier des commandes, sans base de données (testées dans test/orders.spec.ts) :
 * frais de livraison, automate des statuts, code de remise.
 */

export type OrderMode = 'LIVRAISON' | 'RETRAIT';
export type OrderPayment = 'ESPECES' | 'MOBILE_MONEY';
export type OrderStatus = 'RECUE' | 'ACCEPTEE' | 'PRETE' | 'EN_LIVRAISON' | 'LIVREE' | 'RETIREE' | 'REFUSEE' | 'ANNULEE' | 'ECHEC';
export type MobileOperator = 'MTN' | 'MOOV' | 'CELTIIS';

export const ORDER_MODES: OrderMode[] = ['LIVRAISON', 'RETRAIT'];
export const ORDER_PAYMENTS: OrderPayment[] = ['ESPECES', 'MOBILE_MONEY'];
export const MOBILE_OPERATORS: MobileOperator[] = ['MTN', 'MOOV', 'CELTIIS'];

/** Opérateur mobile money → fournisseur enregistré sur le paiement (Payment.provider). */
export const PROVIDER: Record<MobileOperator, string> = { MTN: 'MTN_MOMO', MOOV: 'MOOV_MONEY', CELTIIS: 'CELTIIS_CASH' };
export const PROVIDER_LABEL: Record<string, string> = { MTN_MOMO: 'MTN MoMo', MOOV_MONEY: 'Moov Money', CELTIIS_CASH: 'Celtiis Cash', ESPECES: 'Espèces' };

/** Commandes encore en cours : une seule par ordonnance. */
export const ACTIVE_STATUSES: OrderStatus[] = ['RECUE', 'ACCEPTEE', 'PRETE', 'EN_LIVRAISON'];
/** Statuts où le stock est réservé (décrémenté à l'acceptation). */
export const RESERVED_STATUSES: OrderStatus[] = ['ACCEPTEE', 'PRETE', 'EN_LIVRAISON'];

export const STATUS_LABEL: Record<OrderStatus, string> = {
  RECUE: 'Reçue',
  ACCEPTEE: 'Acceptée',
  PRETE: 'Prête',
  EN_LIVRAISON: 'En route',
  LIVREE: 'Livrée',
  RETIREE: 'Retirée',
  REFUSEE: 'Refusée',
  ANNULEE: 'Annulée',
  ECHEC: 'Non remise',
};

export const DELIVERY_FEE_SAME_COMMUNE = 500;
export const DELIVERY_FEE_OTHER_COMMUNE = 1000;
/** Au-delà, la pharmacie ne livre pas (le retrait reste possible). */
export const MAX_DELIVERY_KM = 40;
/** Relance de la pharmacie, puis annulation automatique d'une commande restée sans réponse. */
export const REMIND_AFTER_MIN = 30;
export const EXPIRE_AFTER_H = 24;
/** Commande acceptée mais jamais remise (livreur perdu, patient absent, code bloqué) : clôturée en échec. */
export const STALE_AFTER_H = 72;
/** Codes faux tolérés avant blocage de la remise, et nouveaux codes que la pharmacie peut faire envoyer. */
export const MAX_CODE_ATTEMPTS = 5;
export const MAX_NEW_CODES = 3;

/**
 * Délais de la tâche planifiée. En démonstration publique, les commandes du jeu de données doivent rester
 * à traiter pendant des jours : 30 jours au lieu de 24 h (sans réponse) et de 72 h (non remise).
 */
export function expiryHours(demo: boolean): { unanswered: number; undelivered: number } {
  return demo ? { unanswered: 24 * 30, undelivered: 24 * 30 } : { unanswered: EXPIRE_AFTER_H, undelivered: STALE_AFTER_H };
}

/** Frais de livraison : gratuits au comptoir, 500 FCFA dans la commune de la pharmacie, 1 000 FCFA ailleurs. */
export function deliveryFee(mode: OrderMode, pharmacyCommuneId: string, deliveryCommuneId?: string | null): number {
  if (mode === 'RETRAIT') return 0;
  return deliveryCommuneId && deliveryCommuneId === pharmacyCommuneId ? DELIVERY_FEE_SAME_COMMUNE : DELIVERY_FEE_OTHER_COMMUNE;
}

/**
 * Automate des statuts. Livraison : Reçue → Acceptée → Prête → En route → Livrée.
 * Retrait : Reçue → Acceptée → Prête → Retirée. La pharmacie peut refuser tant que rien n'est parti ;
 * le patient (ou la tâche planifiée) ne peut annuler que tant qu'elle n'a pas accepté. Une commande
 * acceptée qui ne peut pas être remise (patient absent, code bloqué, ordonnance expirée entre-temps)
 * passe en échec : stock rendu, remboursement, nouvelle commande possible. Aucune commande ne reste bloquée.
 */
export function allowedNext(status: OrderStatus, mode: OrderMode): OrderStatus[] {
  switch (status) {
    case 'RECUE':
      return ['ACCEPTEE', 'REFUSEE', 'ANNULEE'];
    case 'ACCEPTEE':
      return ['PRETE', 'REFUSEE', 'ECHEC'];
    case 'PRETE':
      return mode === 'LIVRAISON' ? ['EN_LIVRAISON', 'REFUSEE', 'ECHEC'] : ['RETIREE', 'REFUSEE', 'ECHEC'];
    case 'EN_LIVRAISON':
      return ['LIVREE', 'ECHEC'];
    default:
      return [];
  }
}

/** Statuts où la remise contre le code est attendue (un nouveau code peut y être envoyé). */
export function awaitsHandover(status: OrderStatus, mode: OrderMode): boolean {
  return mode === 'LIVRAISON' ? status === 'EN_LIVRAISON' || status === 'PRETE' : status === 'PRETE';
}

export function canTransition(from: OrderStatus, to: OrderStatus, mode: OrderMode): boolean {
  return allowedNext(from, mode).includes(to);
}

/** Statut atteint à la remise (code vérifié) : livrée à domicile ou retirée au comptoir. */
export function handoverStatus(mode: OrderMode): OrderStatus {
  return mode === 'LIVRAISON' ? 'LIVREE' : 'RETIREE';
}

/** Code de remise à 4 chiffres (0000 à 9999), tiré au hasard cryptographique. */
export function newHandoverCode(): string {
  return String(randomInt(0, 10_000)).padStart(4, '0');
}

/** Compare le code saisi (espaces tolérés) au code attendu, en temps constant. */
export function checkHandoverCode(expected: string, given: string): boolean {
  const g = given.replace(/\s/g, '');
  if (!/^\d{4}$/.test(g) || !/^\d{4}$/.test(expected)) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(g));
}

/** Référence courte lisible au téléphone (« C-4F2A9 »). */
export function orderRef(id: string): string {
  return `C-${id.replace(/-/g, '').slice(0, 5).toUpperCase()}`;
}

/** Numéro de reçu du bac à sable mobile money / caisse. */
export function receiptNumber(prefix: 'MM' | 'ES'): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += alphabet[randomInt(0, alphabet.length)];
  return `${prefix}-${s}`;
}

/**
 * Médicaments qui ne se commandent qu'avec une ordonnance (commande libre refusée) : anticancéreux et
 * immunosuppresseurs, opioïdes, psychotropes, antibiotiques, antituberculeux, antirétroviraux, corticoïdes, insulines, misoprostol et
 * formes injectables.
 */
export function requiresPrescription(m: { atc: string | null; form: string; category?: string | null }): boolean {
  const atc = (m.atc ?? '').toUpperCase();
  if (['L', 'N02A', 'N03', 'N05', 'N06', 'J01', 'J04', 'J05', 'H02', 'A10A', 'G02AD'].some((p) => atc.startsWith(p))) return true;
  return /inject|perfusion|ampoule|stylo/i.test(m.form);
}

export interface OrderEvent {
  status: string;
  at: string;
  by?: string;
  note?: string;
}

/** Essais de code restants (le compteur Order.codeAttempts est incrémenté atomiquement avant chaque comparaison). */
export function codeAttemptsLeft(codeAttempts: number): number {
  return Math.max(0, MAX_CODE_ATTEMPTS - codeAttempts);
}

/** Nouveaux codes déjà envoyés (journal de la commande). */
export function newCodesSent(events: OrderEvent[]): number {
  return events.filter((e) => e.status === 'NOUVEAU_CODE').length;
}

/** Nom du livreur tel qu'il part par SMS : lettres, espaces, trait d'union, apostrophe ; 2 à 40 caractères. */
export const COURIER_NAME = /^\p{L}[\p{L} '’-]{1,39}$/u;
/** Téléphone du livreur : chiffres seulement (8 ou 10). */
export const COURIER_PHONE = /^\d{8}(\d{2})?$/;

/**
 * Qui reçoit le code de remise : le patient (ou son parent) et l'auteur de la commande s'il a toujours accès
 * (lui-même, parent, ou aidant dont la délégation active porte le volet « commandes »). Les autres aidants
 * avec ce volet sont prévenus sans le code ; un aidant révoqué ou sans ce volet n'est pas prévenu du tout.
 */
export function splitRecipients(family: string[], delegates: string[], ordererId: string): { holders: string[]; others: string[] } {
  const holders = new Set(family);
  if (family.includes(ordererId) || delegates.includes(ordererId)) holders.add(ordererId);
  return { holders: [...holders], others: [...new Set(delegates)].filter((id) => !holders.has(id)) };
}
