/** « Koffi Agossou » → « Koffi A. » : ce qu'un tiers (pharmacie, banque de sang, spécialiste) voit d'un patient. */
export function shortName(p: { firstName: string; lastName: string }): string {
  return `${p.firstName} ${p.lastName.charAt(0)}.`;
}

/** « Mathieu Gounou (relais) » → « Mathieu Gounou » : nom affiché sans la mention de rôle du jeu de démo. */
export function withoutRole(displayName: string): string {
  return displayName.replace(/\s*\([^)]*\)\s*$/, '').trim();
}
