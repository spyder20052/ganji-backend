import type { Lang } from '@prisma/client';

export type { Lang };

/** Langues nationales : traduites dans leur propre fichier (fon.ts, yoruba.ts, bariba.ts, dendi.ts). */
export type NationalLang = Exclude<Lang, 'fr' | 'en'>;
export const NATIONAL_LANGS: readonly NationalLang[] = ['fon', 'yoruba', 'bariba', 'dendi'];

/** Un texte du catalogue : français et anglais obligatoires, langue nationale possible en ligne (rare). */
export type Entry = { fr: string; en: string } & Partial<Record<NationalLang, string>>;

/**
 * Variables {x} d'un texte. Une date ou un libellé qui dépend de la langue se passe en fonction `(lang) => …` :
 * elle reçoit la langue du texte réellement envoyé (le français quand la traduction manque), jamais une
 * phrase française avec une date en yoruba.
 */
export type Var = string | number | ((lang: Lang) => string | number);
export type Vars = Record<string, Var>;

/**
 * Déclare des textes du catalogue (un fichier par module dans catalog/). Fonction identité typée :
 * garde les clés littérales, pour que `sms('clé', …)` soit vérifié à la compilation.
 */
export function defineSms<K extends string>(entries: Record<K, Entry>): Record<K, Entry> {
  return entries;
}
