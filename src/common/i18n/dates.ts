import type { Lang } from '@prisma/client';

export const TZ = 'Africa/Porto-Novo';

/** Yoruba : formats du Nigeria si l'ICU de Node les connaît, sinon ceux du français (langue officielle). */
const YORUBA_LOCALE = Intl.DateTimeFormat.supportedLocalesOf(['yo-NG']).length ? 'yo-NG' : 'fr-FR';

/**
 * Locale des dates et heures glissées dans un texte : en-GB pour l'anglais, yo-NG pour le yoruba,
 * fr-FR pour le français et les langues nationales sans locale (fon, bariba, dendi).
 */
export function localeOf(lang?: Lang | null): string {
  if (lang === 'en') return 'en-GB';
  if (lang === 'yoruba') return YORUBA_LOCALE;
  return 'fr-FR';
}

/** « ven. 26 sept., 13:00 » : rappels, réponses SMS et USSD (textes courts). */
export function shortDateTime(d: Date, lang?: Lang | null) {
  return d.toLocaleString(localeOf(lang), { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** « lundi 12 octobre à 09:00 » : rendez-vous de don. */
export function longDateTime(d: Date, lang?: Lang | null) {
  return d.toLocaleString(localeOf(lang), { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}

/** « 12 octobre ». */
export function dayMonth(d: Date, lang?: Lang | null) {
  return d.toLocaleDateString(localeOf(lang), { timeZone: TZ, day: 'numeric', month: 'long' });
}

/** « jeudi 3 octobre ». */
export function weekdayDate(d: Date, lang?: Lang | null) {
  return d.toLocaleDateString(localeOf(lang), { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });
}

/** « 9 h 30 » à la française, « 09:30 » ailleurs. */
export function clock(d: Date, lang?: Lang | null) {
  const locale = localeOf(lang);
  const time = d.toLocaleTimeString(locale, { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  if (locale !== 'fr-FR') return time;
  const [h, m] = time.split(':');
  return `${Number(h)} h ${m}`;
}
