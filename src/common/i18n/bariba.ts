/**
 * Textes en Baatonum (bariba), par clé du catalogue (src/common/i18n/catalog/). Fichier propre à cette langue :
 * chaque traducteur travaille dans le sien, sans conflit avec les autres.
 *
 * - Liste des clés à traduire, avec le français et l'anglais : `npm run i18n:export`
 *   (écrit scripts/i18n/sms-catalog.json).
 * - Garder les variables {x} telles quelles ; jamais de donnée médicale (ni maladie, ni traitement).
 * - Vérification (clé manquante, variable différente, texte vide, clé inconnue) : `npm run i18n:verify`.
 * - Clé absente : le texte part en français. Traductions à faire valider par un locuteur natif.
 */
export const BARIBA: Record<string, string> = {};
