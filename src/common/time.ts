/**
 * Temps et âges, une seule fois pour tous les modules. Le Bénin est à UTC+1 toute l'année
 * (Africa/Porto-Novo, pas d'heure d'été) : les calculs de journée se font par simple décalage.
 */
export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;
export const BENIN_OFFSET_MS = HOUR_MS;
export const BENIN_TZ = 'Africa/Porto-Novo';

/** Âge révolu à une date, calculé en temps universel (dates de naissance stockées à minuit UTC). */
export function ageOn(birth: Date, now = new Date()): number {
  let a = now.getUTCFullYear() - birth.getUTCFullYear();
  const m = now.getUTCMonth() - birth.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < birth.getUTCDate())) a--;
  return a;
}

/** Minuit (heure du Bénin) du jour contenant `d`. */
export function startOfBeninDay(d: Date): Date {
  const local = new Date(d.getTime() + BENIN_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - BENIN_OFFSET_MS);
}

/** Début et fin (exclue) de la journée en cours, heure du Bénin. */
export function beninDay(now: Date): { start: Date; end: Date } {
  const start = startOfBeninDay(now);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

/** Date du jour au Bénin, « AAAA-MM-JJ ». */
export function beninDateKey(d: Date): string {
  return new Date(d.getTime() + BENIN_OFFSET_MS).toISOString().slice(0, 10);
}

/** Instant correspondant à « HH:MM » (heure du Bénin) le jour qui commence à `dayStart`. */
export function atBeninTime(dayStart: Date, time: string): Date {
  const [h, m] = time.split(':').map(Number);
  return new Date(dayStart.getTime() + (h * 60 + m) * 60_000);
}

/** Date et heure en français, heure du Bénin : « 24 septembre 2026 à 09:30 ». */
export function fmtDateTimeFr(d: Date): string {
  return d.toLocaleString('fr-FR', { timeZone: BENIN_TZ, day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Date en français, heure du Bénin : « 24 septembre 2026 ». */
export function fmtDateFr(d: Date): string {
  return d.toLocaleDateString('fr-FR', { timeZone: BENIN_TZ, day: 'numeric', month: 'long', year: 'numeric' });
}
