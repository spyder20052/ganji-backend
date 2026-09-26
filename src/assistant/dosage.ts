/**
 * Lecture des posologies écrites en français par le prescripteur (« 1 comprimé matin et soir »,
 * « 3x/j », « toutes les 8 heures », « pendant 7 jours »…) pour en tirer des heures de prise.
 *
 * Règle de prudence : si le texte n'est pas compris, AUCUNE heure n'est inventée (understood = false) ;
 * l'application renvoie alors vers le pharmacien. « Si besoin » ne donne jamais de rappel.
 * Heures de référence (heure de Cotonou) : matin 8 h, midi 13 h, soir 20 h, coucher 22 h.
 */

export type Slot = 'MATIN' | 'MIDI' | 'SOIR' | 'COUCHER';
export type Meal = 'AVANT' | 'PENDANT' | 'APRES' | 'A_JEUN';

export const SLOT_TIME: Record<Slot, string> = { MATIN: '08:00', MIDI: '13:00', SOIR: '20:00', COUCHER: '22:00' };

export interface DosagePlan {
  /** Heures de prise (HH:MM, heure de Cotonou), triées. Vide : pas de rappel. */
  times: string[];
  /** Prises par jour de prise (0 si « si besoin » ou non compris). */
  perDay: number;
  /** 1 : chaque jour ; 2 : un jour sur deux ; 7 : une fois par semaine. */
  everyDays: number;
  /** Quantité par prise telle qu'écrite (« 1 comprimé », « 2 gélules »), si trouvée. */
  dose: string | null;
  meal: Meal | null;
  /** Durée du traitement en jours ; null si non précisée ou au long cours. */
  durationDays: number | null;
  longTerm: boolean;
  asNeeded: boolean;
  understood: boolean;
}

const WORDS: Record<string, number> = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, dix: 10, douze: 12, quinze: 15, vingt: 20, trente: 30 };
const NUM_ALT = '\\d+|un|une|deux|trois|quatre|cinq|six|sept|huit|dix|douze|quinze|vingt|trente';
/** Nombre en chiffres ou en lettres, jamais au milieu d'un mot. */
const NUM = `(?<![a-z0-9])(${NUM_ALT})`;

function toNumber(s: string): number {
  return /^\d+$/.test(s) ? Number(s) : (WORDS[s] ?? NaN);
}

/** Minuscules, sans accents ni apostrophes typographiques. Garde la longueur (texte NFC en entrée). */
export function fold(s: string): string {
  return s
    .normalize('NFC')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’']/g, ' ');
}

const hhmm = (minutes: number) => {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
const sortTimes = (t: string[]) => [...new Set(t)].sort();

/** Heures par défaut pour n prises par jour (repas pris en compte pour une prise unique). */
export function defaultTimes(n: number, meal: Meal | null): string[] {
  if (n <= 0) return [];
  if (n === 1) return [meal === 'PENDANT' || meal === 'APRES' ? SLOT_TIME.MIDI : SLOT_TIME.MATIN];
  if (n === 2) return [SLOT_TIME.MATIN, SLOT_TIME.SOIR];
  if (n === 3) return [SLOT_TIME.MATIN, SLOT_TIME.MIDI, SLOT_TIME.SOIR];
  if (n === 4) return ['08:00', '12:00', '16:00', '20:00'];
  // Au-delà : réparties entre 6 h et 22 h, à la demi-heure.
  const step = Math.round((16 * 60) / (n - 1) / 30) * 30;
  return sortTimes(Array.from({ length: n }, (_, k) => hhmm(6 * 60 + k * step)));
}

/** « Toutes les N heures » : départ à 6 h (8 h pour 12 h et plus) pour éviter les prises de nuit. */
export function everyHoursTimes(h: number): string[] {
  if (h >= 24) return [SLOT_TIME.MATIN];
  const start = h >= 12 ? 8 : 6;
  const n = Math.floor(24 / h);
  return sortTimes(Array.from({ length: n }, (_, k) => hhmm((start + k * h) * 60)));
}

function detectMeal(t: string): Meal | null {
  if (/\ba jeun\b/.test(t)) return 'A_JEUN';
  if (/\bavant (?:le |les |chaque |un )?(?:repas|manger)\b|\bavant de manger\b/.test(t)) return 'AVANT';
  if (/\bapres (?:le |les |chaque |un )?(?:repas|manger)\b|\bapres avoir mange\b/.test(t)) return 'APRES';
  if (/\b(?:au cours|pendant|au milieu|au moment|avec|lors) (?:du |des |d un |le |les |de )?repas\b|\ben mangeant\b|\bavec (?:de la )?nourriture\b/.test(t)) return 'PENDANT';
  return null;
}

function detectSlots(t: string): Slot[] {
  const slots: Slot[] = [];
  if (/\b(?:matin|matins|petit[ -]dejeuner|au reveil)\b/.test(t)) slots.push('MATIN');
  if (/\bmidi\b|(?<!petit[ -])\bdejeuner\b/.test(t)) slots.push('MIDI');
  if (/\b(?:soir|soirs|diner|souper)\b/.test(t)) slots.push('SOIR');
  if (/\b(?:coucher|au lit|avant de dormir|nuit)\b/.test(t)) slots.push('COUCHER');
  return slots;
}

/** Durée en jours (« 7 jours », « 2 semaines », « 1 mois », « 10 j ») ; null si absente. */
export function parseDuration(text: string): { days: number | null; longTerm: boolean } {
  const t = fold(text);
  if (/\b(?:a vie|au long cours|en continu|continu|permanent|sans arret|a poursuivre|chronique|jusqu a nouvel ordre)\b/.test(t)) {
    return { days: null, longTerm: true };
  }
  const m = new RegExp(`${NUM}\\s*(jours?|j|semaines?|sem|mois)\\b`).exec(t);
  if (!m) return { days: null, longTerm: false };
  const n = toNumber(m[1]);
  if (!Number.isFinite(n) || n <= 0) return { days: null, longTerm: false };
  const unit = m[2];
  const days = unit.startsWith('mois') ? n * 30 : unit.startsWith('sem') ? n * 7 : n;
  return { days, longTerm: false };
}

function detectDose(original: string): string | null {
  const src = original.normalize('NFC');
  const t = fold(src);
  const re = new RegExp(
    `(?<![a-z0-9])(\\d+(?:[.,]\\d+)?|½|1/2|un demi|une demie|demi|${NUM_ALT})\\s*(comprimes?|cps?|gelules?|sachets?|cuilleres?(?:\\s+a\\s+(?:cafe|soupe|mesure))?|ml|gouttes?|bouffees?|ampoules?|suppositoires?|capsules?|doses?|unites?|ui|injections?|applications?|pulverisations?)\\b`,
  );
  const m = re.exec(t);
  if (!m) return null;
  return src.slice(m.index, m.index + m[0].length).trim();
}

/**
 * Lit une posologie (et, à part, la durée de l'ordonnance) et renvoie les heures de prise.
 * @param dosage texte du prescripteur, ex. « 1 comprimé matin et soir pendant 7 jours »
 * @param duration champ « durée » de l'ordonnance, ex. « 30 jours » (prioritaire sur le texte)
 */
export function parseDosage(dosage: string, duration?: string | null): DosagePlan {
  const t = fold(dosage);
  const meal = detectMeal(t);
  const dose = detectDose(dosage);
  const fromField = duration ? parseDuration(duration) : { days: null, longTerm: false };
  // Les rythmes (« un jour sur deux », « tous les 2 jours ») ne sont pas des durées.
  const fromText = parseDuration(t.replace(/\bun jour sur deux\b|\btous les (?:deux|2) jours\b|\btoutes? les\s+\d+\s*h(?:eures?)?\b/g, ' '));
  const durationDays = fromField.days ?? fromText.days;
  const longTerm = durationDays === null && (fromField.longTerm || fromText.longTerm);
  const base = { dose, meal, durationDays, longTerm };

  const asNeeded = /\b(?:si besoin|au besoin|en cas de|si douleur|si douleurs|si fievre|a la demande|si necessaire)\b/.test(t);
  if (asNeeded) return { ...base, times: [], perDay: 0, everyDays: 1, asNeeded: true, understood: true };

  let everyDays = 1;
  if (/\bun jour sur deux\b|\btous les deux jours\b|\btous les 2 jours\b/.test(t)) everyDays = 2;
  if (/\b(?:par|chaque|\/)\s*semaine\b|\bhebdomadaire\b|\bune fois la semaine\b/.test(t)) everyDays = 7;

  // « toutes les 8 heures », « toutes les 12 h », « /8h », « q8h »
  const every = /\btoutes? les\s+(\d+)\s*h(?:eures?)?\b/.exec(t) ?? /\/\s*(\d+)\s*h\b/.exec(t) ?? /\bq(\d+)h\b/.exec(t);
  if (every) {
    const h = Number(every[1]);
    if (h >= 1 && h <= 72) {
      if (h >= 24) everyDays = Math.max(1, Math.round(h / 24));
      const times = everyHoursTimes(h);
      return { ...base, times, perDay: times.length, everyDays, asNeeded: false, understood: true };
    }
  }

  // « 3 fois par jour », « 2x/j », « 3 x par jour », « 1 prise par jour », « deux fois/jour »
  const countMatch = new RegExp(`${NUM}\\s*(?:fois|x|prises?)\\s*(?:par|/|a|au|le|dans la)?\\s*(?:jour|j|24\\s*h|journee)\\b`).exec(t);
  const weeklyCount = new RegExp(`${NUM}\\s*(?:fois|x|prises?)\\s*(?:par|/)?\\s*semaine\\b`).exec(t);
  let count = countMatch ? toNumber(countMatch[1]) : null;
  if (count === null && weeklyCount) count = 1; // une prise le jour de prise
  if (count !== null && (!Number.isFinite(count) || count < 1 || count > 12)) count = null;

  const slots = detectSlots(t);
  if (slots.length > 0 && (count === null || count === slots.length)) {
    const times = sortTimes(slots.map((s) => SLOT_TIME[s]));
    return { ...base, times, perDay: times.length, everyDays, asNeeded: false, understood: true };
  }
  if (count !== null) {
    const times = defaultTimes(count, meal);
    return { ...base, times, perDay: times.length, everyDays, asNeeded: false, understood: true };
  }
  // « par jour », « /j », « chaque jour », « quotidien », « 1 comprimé au cours du repas » : une prise.
  if (/\bpar jour\b|\/\s*j\b|\bchaque jour\b|\bquotidien(?:ne)?\b|\btous les jours\b|\bune fois\b/.test(t) || everyDays > 1 || meal !== null) {
    const times = defaultTimes(1, meal);
    return { ...base, times, perDay: 1, everyDays, asNeeded: false, understood: true };
  }
  return { ...base, times: [], perDay: 0, everyDays, asNeeded: false, understood: false };
}

// ─── Calendrier (heure de Cotonou, UTC+1 toute l'année) ───────────────

const COTONOU_OFFSET_MS = 3600_000;
const DAY_MS = 86_400_000;

/** Minuit (heure de Cotonou) du jour de `d`. */
export function startOfCotonouDay(d: Date): Date {
  const local = new Date(d.getTime() + COTONOU_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - COTONOU_OFFSET_MS);
}

/** Date du jour à Cotonou, « AAAA-MM-JJ ». */
export function cotonouDateKey(d: Date): string {
  return new Date(d.getTime() + COTONOU_OFFSET_MS).toISOString().slice(0, 10);
}

/** Instant correspondant à « HH:MM » à Cotonou, le jour qui commence à `dayStart`. */
export function atCotonou(dayStart: Date, time: string): Date {
  const [h, m] = time.split(':').map(Number);
  return new Date(dayStart.getTime() + (h * 60 + m) * 60_000);
}

/**
 * Instants de prise entre `from` et `until` (inclus), jour après jour, en respectant « un jour sur N »
 * compté depuis `anchor` (début du traitement).
 */
export function occurrences(times: string[], everyDays: number, from: Date, until: Date, anchor: Date = from): Date[] {
  const out: Date[] = [];
  if (!times.length || until < from) return out;
  const anchorDay = startOfCotonouDay(anchor).getTime();
  for (let day = startOfCotonouDay(from); day <= until; day = new Date(day.getTime() + DAY_MS)) {
    const index = Math.round((day.getTime() - anchorDay) / DAY_MS);
    if (((index % everyDays) + everyDays) % everyDays !== 0) continue;
    for (const time of times) {
      const at = atCotonou(day, time);
      if (at >= from && at <= until) out.push(at);
    }
  }
  return out;
}
