import type { Prescription } from '@prisma/client';
import type { PrescriptionItem } from '../medications/medications.service';
import { parseDosage, startOfCotonouDay, type DosagePlan } from './dosage';

const DAY = 86_400_000;
/** Durée retenue quand l'ordonnance ne l'écrit pas (ou traitement au long cours) : un mois. */
export const DEFAULT_TREATMENT_DAYS = 30;

/** Lignes d'une ordonnance avec leurs heures de prise lues sur la posologie. */
export function itemsWithPlan(rx: Pick<Prescription, 'items'>) {
  return (rx.items as unknown as PrescriptionItem[]).map((i) => ({ ...i, plan: parseDosage(i.dosage, i.duration) }));
}

/** Début du traitement : délivrance en pharmacie, sinon émission de l'ordonnance. */
export function treatmentStart(rx: Pick<Prescription, 'dispensedAt' | 'issuedAt'>): Date {
  return rx.dispensedAt ?? rx.issuedAt;
}

/** Fin du traitement d'une ligne (dernière minute du dernier jour) ; null si durée non écrite ou au long cours. */
export function treatmentUntil(rx: Pick<Prescription, 'dispensedAt' | 'issuedAt'>, plan: DosagePlan): Date | null {
  if (!plan.durationDays) return null;
  return new Date(startOfCotonouDay(treatmentStart(rx)).getTime() + plan.durationDays * DAY - 60_000);
}

/**
 * Ordonnance « en cours » pour l'assistant : valide et pas encore délivrée, ou délivrée et dont le
 * traitement n'est pas fini (30 jours quand la durée n'est pas écrite).
 */
export function isCurrentPrescription(rx: Pick<Prescription, 'status' | 'expiresAt' | 'dispensedAt' | 'issuedAt' | 'items'>, now = new Date()): boolean {
  if (rx.status === 'CANCELLED') return false;
  if (rx.status === 'ACTIVE') return rx.expiresAt > now;
  const longest = Math.max(...itemsWithPlan(rx).map((i) => (i.plan.durationDays && !i.plan.longTerm ? i.plan.durationDays : DEFAULT_TREATMENT_DAYS)));
  return startOfCotonouDay(treatmentStart(rx)).getTime() + longest * DAY > now.getTime();
}
