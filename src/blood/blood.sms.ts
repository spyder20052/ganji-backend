import type { Lang } from '@prisma/client';
import { dayMonth, label, longDateTime } from '../common/i18n';

/**
 * Morceaux des SMS et notifications du don de sang (textes : common/i18n/catalog/blood.ts), dans la langue
 * du destinataire (français par défaut) : jamais de maladie, seulement un lieu, un groupe, une consigne.
 */

/** « lundi 12 octobre à 09:00 ». */
export function whenIn(d: Date, lang?: Lang | null) {
  return longDateTime(d, lang);
}

/** « 12 octobre ». */
export function dayIn(d: Date, lang?: Lang | null) {
  return dayMonth(d, lang);
}

/** Libellés français des produits : journal d'audit et carnet (le texte envoyé passe par productIn). */
export const PRODUCT_LABEL: Record<string, string> = { CGR: 'globules rouges', PLAQUETTES: 'plaquettes', PLASMA: 'plasma' };

export function productIn(p: string, lang?: Lang | null) {
  return label('blood.product', p, lang);
}
export function urgencyIn(u: string, lang?: Lang | null) {
  return label('blood.urgency', u, lang);
}
