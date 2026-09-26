import type { Lang } from '@prisma/client';
import { BARIBA } from './bariba';
import { SMS, type TextKey } from './catalog';
import { localeOf } from './dates';
import { DENDI } from './dendi';
import { FON } from './fon';
import { type Entry, type NationalLang, type Vars } from './types';
import { YORUBA } from './yoruba';

/**
 * Textes envoyés à une personne (SMS, messages vocaux, notifications, USSD), dans sa langue
 * (User.lang ou Donor.lang). Catalogue : catalog/ (français et anglais, un fichier par module) ;
 * langues nationales : fon.ts, yoruba.ts, bariba.ts, dendi.ts (un fichier par langue, par clé).
 * Jamais de donnée médicale dans un SMS : un rappel, un code, une consigne (voir OutboxService).
 */
export { CATALOG_PARTS, SMS, type TextKey } from './catalog';
export * from './dates';
export { defineSms, NATIONAL_LANGS, type Entry, type NationalLang, type Var, type Vars } from './types';

export const NATIONAL: Record<NationalLang, Record<string, string>> = { fon: FON, yoruba: YORUBA, bariba: BARIBA, dendi: DENDI };

const CATALOG: Record<string, Entry | undefined> = SMS;

export function isTextKey(key: string): key is TextKey {
  return key in CATALOG;
}

/**
 * Remplace les variables {x} ; une variable fonction reçoit la langue du texte (`lang`). Une variable non
 * fournie reste visible telle quelle.
 */
export function fill(template: string, vars: Vars = {}, lang: Lang = 'fr'): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => {
    if (!(k in vars)) return m;
    const v = vars[k];
    return String(typeof v === 'function' ? v(lang) : v);
  });
}

/**
 * Texte d'une entrée dans une langue, et langue de ce texte : l'entrée elle-même (français, anglais, rare langue
 * nationale en ligne), puis le fichier de la langue nationale, puis le français. Un texte vide compte comme absent.
 */
export function resolve(entry: Entry, key: string, lang: Lang | null | undefined): { template: string; lang: Lang } {
  const l = lang ?? 'fr';
  const own = entry[l] || (l === 'fr' || l === 'en' ? undefined : NATIONAL[l]?.[key]);
  return own ? { template: own, lang: l } : { template: entry.fr, lang: 'fr' };
}

/** Texte d'une entrée, variables remplacées dans la langue du texte retenu. */
export function translate(entry: Entry, key: string, lang: Lang | null | undefined, vars: Vars = {}): string {
  const r = resolve(entry, key, lang);
  return fill(r.template, vars, r.lang);
}

function entryOf(key: TextKey): Entry {
  const entry = CATALOG[key];
  if (!entry) throw new Error(`Texte inconnu : ${key}`);
  return entry;
}

/** Texte du catalogue dans la langue de la personne ; sans traduction : français (langue officielle). */
export function sms(key: TextKey, lang: Lang | null | undefined, vars: Vars = {}): string {
  return translate(entryOf(key), key, lang, vars);
}

/** Même fonction, pour les textes qui ne partent pas par SMS (notifications, menus). */
export const text = sms;

/** Langue dans laquelle ce texte partira pour cette personne : la sienne s'il est traduit, sinon le français. */
export function textLang(key: TextKey, lang: Lang | null | undefined): Lang {
  return resolve(entryOf(key), key, lang).lang;
}

/** Libellé d'un code (« blood.product.CGR ») ; code inconnu du catalogue : la valeur de repli. */
export function label(prefix: string, code: string, lang: Lang | null | undefined, fallback: string = code): string {
  const key = `${prefix}.${code}`;
  return isTextKey(key) ? sms(key, lang) : fallback;
}

/** Forme du pluriel selon la langue (« one » ou « other »), règles de l'ICU (0 et 1 au singulier en français). */
export function pluralOf(n: number, lang: Lang | null | undefined): 'one' | 'other' {
  return new Intl.PluralRules(localeOf(lang)).select(n) === 'one' ? 'one' : 'other';
}

type PluralBase = { [K in TextKey]: K extends `${infer B}.one` ? (`${B}.other` extends TextKey ? B : never) : never }[TextKey];

/**
 * Texte au singulier ou au pluriel : clés `<base>.one` et `<base>.other`, variable {n}. La règle de pluriel est
 * celle de la langue du texte envoyé (le français tant que la traduction manque).
 */
export function plural(base: PluralBase, n: number, lang: Lang | null | undefined, vars: Vars = {}): string {
  const used = textLang(`${base}.other` as TextKey, lang);
  return sms(`${base}.${pluralOf(n, used)}` as TextKey, used, { n, ...vars });
}

/** Titre et texte d'une notification dans une langue. */
export type Localized = (lang: Lang) => { title: string; body: string };

/** Notification dont le titre et le texte sont deux clés du catalogue (dates et libellés : variables fonctions). */
export function note(title: TextKey, body: TextKey, vars: Vars = {}): Localized {
  return (lang) => ({ title: sms(title, lang, vars), body: sms(body, lang, vars) });
}
