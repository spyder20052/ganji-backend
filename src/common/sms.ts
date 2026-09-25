import type { Lang } from '@prisma/client';

/**
 * Textes des SMS et messages vocaux, dans la langue de la personne (réglage de l'application).
 * Clé → texte par langue ; variables {x}. Sans traduction : français (langue officielle).
 * Jamais de donnée médicale : un rappel, un code, une consigne (voir OutboxService).
 * Les traductions en langues nationales sont à faire valider par des locuteurs natifs (docs/LANGUES.md).
 */
export const SMS: Record<string, Partial<Record<Lang, string>>> = {};

export function sms(key: string, lang: Lang | null | undefined, vars: Record<string, string | number> = {}): string {
  const entry = SMS[key];
  if (!entry) throw new Error(`Texte SMS inconnu : ${key}`);
  const text = (lang && entry[lang]) || entry.fr!;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Ajoute des textes au catalogue (chaque module déclare les siens, en français et en anglais au minimum). */
export function defineSms(entries: Record<string, Partial<Record<Lang, string>>>) {
  for (const [k, v] of Object.entries(entries)) SMS[k] = { ...SMS[k], ...v };
}
