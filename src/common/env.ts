/**
 * Charge `.env` s'il existe (développement, tests, seed). En production, les variables viennent
 * de la plateforme et le fichier est absent. Appelé avant toute lecture de clé : l'API, le seed et
 * les tests chiffrent et déchiffrent ainsi avec les mêmes clés.
 */
export function loadDotEnv(path = '.env') {
  try {
    process.loadEnvFile(path);
  } catch {
    // Pas de fichier .env : variables d'environnement de la plateforme.
  }
}
