/** Distance orthodromique en kilomètres (formule de haversine). */
export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)) * 10) / 10;
}

/** Compatibilité ABO/Rh donneur → receveur (globules rouges et plaquettes, règle simplifiée). */
const COMPAT: Record<string, string[]> = {
  'O-': ['O-'],
  'O+': ['O-', 'O+'],
  'A-': ['O-', 'A-'],
  'A+': ['O-', 'O+', 'A-', 'A+'],
  'B-': ['O-', 'B-'],
  'B+': ['O-', 'O+', 'B-', 'B+'],
  'AB-': ['O-', 'A-', 'B-', 'AB-'],
  'AB+': ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'],
};
export const BLOOD_GROUPS = Object.keys(COMPAT);
export function compatibleDonorGroups(recipient: string): string[] {
  return COMPAT[recipient] ?? [recipient];
}

/** Délai minimal entre deux dons de sang total (jours) : 8 semaines hommes, 12 semaines femmes. */
export function canDonate(lastDonationAt: Date | null, sex: string, now = new Date()): boolean {
  if (!lastDonationAt) return true;
  const days = (now.getTime() - lastDonationAt.getTime()) / 86_400_000;
  return days >= (sex === 'F' ? 84 : 56);
}
