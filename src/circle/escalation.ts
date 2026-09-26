/**
 * Règles du cercle de soins, sans base de données (testées dans test/circle.spec.ts).
 *
 * Un rappel de traitement ou de rendez-vous envoyé mais pas confirmé :
 *   - 2 h après : escalade 1, les aidants qui reçoivent les rappels sont prévenus (application + SMS neutre) ;
 *   - 6 h après : escalade 2, une visite du relais communautaire est demandée pour le lendemain 10 h.
 * Le délai part du plus tard entre l'envoi et l'heure prévue : la tâche planifiée envoie les rappels
 * jusqu'à 24 h à l'avance, un rappel envoyé la veille n'est pas « manqué » avant son heure.
 */
export const CAREGIVERS_AFTER_HOURS = 2;
export const RELAY_AFTER_HOURS = 6;
/** Au-delà, un rappel est de l'histoire ancienne : on ne relance plus personne. */
export const MAX_AGE_HOURS = 48;
export const ESCALATED_KINDS = ['MEDICATION', 'APPOINTMENT'];

const HOUR = 3_600_000;
/** Bénin : UTC+1 toute l'année (Africa/Porto-Novo, pas d'heure d'été). */
const BENIN_OFFSET = HOUR;

export interface ReminderTiming {
  kind: string;
  dueAt: Date;
  sentAt: Date | null;
  confirmedAt: Date | null;
}

/** Moment à partir duquel le rappel attend une réponse (null s'il n'est pas encore parti). */
export function waitingSince(r: Pick<ReminderTiming, 'dueAt' | 'sentAt'>): Date | null {
  if (!r.sentAt) return null;
  return new Date(Math.max(r.sentAt.getTime(), r.dueAt.getTime()));
}

/** Niveau d'escalade que le rappel devrait avoir maintenant : 0, 1 (aidants) ou 2 (relais). */
export function escalationLevel(r: ReminderTiming, now: Date): 0 | 1 | 2 {
  if (!ESCALATED_KINDS.includes(r.kind) || r.confirmedAt) return 0;
  const since = waitingSince(r);
  if (!since) return 0;
  const elapsed = now.getTime() - since.getTime();
  if (elapsed > MAX_AGE_HOURS * HOUR) return 0;
  if (elapsed >= RELAY_AFTER_HOURS * HOUR) return 2;
  if (elapsed >= CAREGIVERS_AFTER_HOURS * HOUR) return 1;
  return 0;
}

export type ReminderState = 'FAIT' | 'SANS_REPONSE' | 'A_FAIRE' | 'A_VENIR';

/** État affiché d'un rappel du jour. */
export function reminderState(r: ReminderTiming, now: Date): ReminderState {
  if (r.confirmedAt) return 'FAIT';
  if (r.dueAt.getTime() > now.getTime()) return 'A_VENIR';
  const since = waitingSince(r) ?? r.dueAt;
  return now.getTime() - since.getTime() >= CAREGIVERS_AFTER_HOURS * HOUR ? 'SANS_REPONSE' : 'A_FAIRE';
}

/** « C'est fait » possible dès que l'heure approche (2 h avant) : pas pour un rendez-vous de la semaine prochaine. */
export function canConfirm(r: ReminderTiming, now: Date): boolean {
  return !r.confirmedAt && r.dueAt.getTime() - now.getTime() <= 2 * HOUR;
}

/** Lendemain, 10 h, heure du Bénin : moment de la visite du relais. */
export function nextVisitDue(now: Date): Date {
  const local = new Date(now.getTime() + BENIN_OFFSET);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1, 10) - BENIN_OFFSET);
}

/** Début et fin de la journée en cours, heure du Bénin. */
export function beninDay(now: Date): { start: Date; end: Date } {
  const local = new Date(now.getTime() + BENIN_OFFSET);
  const start = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - BENIN_OFFSET;
  return { start: new Date(start), end: new Date(start + 24 * HOUR) };
}
