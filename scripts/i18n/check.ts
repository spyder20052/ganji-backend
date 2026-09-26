import { CATALOG_PARTS, NATIONAL, NATIONAL_LANGS, SMS, type Entry, type NationalLang } from '../../src/common/i18n';

/** Variables {x} d'un texte, triées et sans doublon. */
export function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
}

export type ProblemKind = 'MISSING' | 'EMPTY' | 'PLACEHOLDERS' | 'EXTRA' | 'DUPLICATE';
export interface Problem {
  lang: NationalLang | 'fr' | 'en';
  key: string;
  kind: ProblemKind;
  detail?: string;
}

const CATALOG = SMS as Record<string, Entry>;

/** Module (fichier de catalog/) qui déclare chaque clé. */
export function moduleOf(key: string): string | undefined {
  return Object.entries(CATALOG_PARTS).find(([, part]) => key in part)?.[0];
}

function samePlaceholders(lang: Problem['lang'], key: string, reference: string, text: string): Problem[] {
  const want = placeholders(reference).join(', ');
  const got = placeholders(text).join(', ');
  return want === got ? [] : [{ lang, key, kind: 'PLACEHOLDERS', detail: `attendu {${want}}, trouvé {${got}}` }];
}

/** Catalogue lui-même : clé déclarée par deux modules, texte vide, variables différentes entre français et anglais. */
export function checkCatalog(): Problem[] {
  const problems: Problem[] = [];
  const seen = new Map<string, string>();
  for (const [module, part] of Object.entries(CATALOG_PARTS)) {
    for (const key of Object.keys(part)) {
      if (seen.has(key)) problems.push({ lang: 'fr', key, kind: 'DUPLICATE', detail: `${seen.get(key)} et ${module}` });
      seen.set(key, module);
    }
  }
  for (const [key, e] of Object.entries(CATALOG)) {
    for (const lang of ['fr', 'en'] as const) if (!e[lang]?.trim()) problems.push({ lang, key, kind: 'EMPTY' });
    problems.push(...samePlaceholders('en', key, e.fr, e.en));
  }
  return problems;
}

/**
 * Une langue nationale : chaque clé traduite (fichier de la langue, ou en ligne dans le catalogue), non vide,
 * avec exactement les mêmes variables que le français ; clés inconnues du catalogue signalées.
 */
export function checkNational(lang: NationalLang, dict: Record<string, string> = NATIONAL[lang]) {
  const problems: Problem[] = [];
  let translated = 0;
  for (const [key, e] of Object.entries(CATALOG)) {
    const text = e[lang] ?? dict[key];
    if (text === undefined) {
      problems.push({ lang, key, kind: 'MISSING' });
      continue;
    }
    if (!text.trim()) {
      problems.push({ lang, key, kind: 'EMPTY' });
      continue;
    }
    translated++;
    problems.push(...samePlaceholders(lang, key, e.fr, text));
  }
  for (const key of Object.keys(dict)) if (!(key in CATALOG)) problems.push({ lang, key, kind: 'EXTRA', detail: 'clé absente du catalogue' });
  return { problems, translated, total: Object.keys(CATALOG).length };
}

export { NATIONAL_LANGS };
