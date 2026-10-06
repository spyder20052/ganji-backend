/**
 * Ordonnance : forme signée et statuts, sans dépendance à Nest ni à Prisma (réutilisé par le jeu de
 * données de démo, le module des commandes et les tests).
 */

/** Ligne d'ordonnance telle que stockée (JSON) et signée. */
export type PrescriptionItem = {
  medicationId: string;
  dci: string;
  form: string;
  strength: string;
  dosage: string;
  duration: string;
  quantity: number;
};

export type PrescriptionStatus = 'ACTIVE' | 'DISPENSED' | 'EXPIRED' | 'CANCELLED';

export const PRESCRIPTION_STATUS_LABEL: Record<PrescriptionStatus, string> = {
  ACTIVE: 'Valide',
  DISPENSED: 'Délivrée',
  EXPIRED: 'Expirée',
  CANCELLED: 'Annulée',
};

/** Charge utile du QR d'une ordonnance : « ganji:rx:<id>.<signature> ». */
export const RX_PAYLOAD = /^(?:ganji:rx:)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{16,64})$/i;

/**
 * Chaîne signée d'une ordonnance. Les lignes sont sérialisées dans un ordre de champs fixe : PostgreSQL
 * (jsonb) ne conserve pas l'ordre des clés, un simple JSON.stringify de la valeur relue ne redonnerait pas
 * la chaîne signée. À réutiliser tel quel par tout code qui crée des ordonnances (jeu de données compris).
 */
export function prescriptionSignedString(id: string, patientId: string, items: PrescriptionItem[]): string {
  const canonical = items.map((i) => [i.medicationId, i.dci, i.form, i.strength, i.dosage, i.duration, i.quantity]);
  return `${id}|${patientId}|${JSON.stringify(canonical)}`;
}

/** Statut effectif : une ordonnance active devient expirée à sa date, sans écriture en base. */
export function prescriptionStatus(rx: { status: string; expiresAt: Date }, now = new Date()): PrescriptionStatus {
  if (rx.status === 'DISPENSED') return 'DISPENSED';
  if (rx.status === 'CANCELLED') return 'CANCELLED';
  return rx.expiresAt <= now ? 'EXPIRED' : 'ACTIVE';
}
