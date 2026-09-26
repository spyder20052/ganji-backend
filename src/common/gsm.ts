import type { Lang } from '@prisma/client';

/** Langues nationales : lettres propres (ɔ, ɛ, ɖ, ẹ, ọ, ṣ) et tons. */
const NATIONAL: readonly Lang[] = ['fon', 'yoruba', 'bariba', 'dendi'];
const LETTERS: Record<string, string> = { ɔ: 'o', Ɔ: 'O', ɛ: 'e', Ɛ: 'E', ɖ: 'd', Ɖ: 'D', ŋ: 'ng', Ŋ: 'Ng', ɲ: 'ny', Ɲ: 'Ny', ƒ: 'f', Ƒ: 'F', ʋ: 'v', Ʋ: 'V' };

/**
 * SMS et USSD en langue nationale : écrits sans lettres spéciales ni tons, comme on écrit ces langues
 * par SMS au Bénin. Une seule lettre hors de l'alphabet GSM fait passer le SMS en Unicode (70 caractères
 * par partie au lieu de 160) et beaucoup de téléphones simples ne l'affichent pas. Français et anglais :
 * inchangés. L'application garde l'orthographe complète.
 */
export function smsSafe(text: string, lang: Lang | null | undefined): string {
  if (!lang || !NATIONAL.includes(lang)) return text;
  return text
    .replace(/[ɔƆɛƐɖƉŋŊɲƝƒƑʋƲ]/g, (c) => LETTERS[c])
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .normalize('NFC')
    .replace(/[’‘]/g, "'")
    .replace(/[«»“”]/g, '"')
    .replace(/…/g, '...');
}
