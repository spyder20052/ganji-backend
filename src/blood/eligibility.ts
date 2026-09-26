/**
 * Règles du don de sang (logique pure, testée dans test/blood.spec.ts).
 * Repos entre deux dons de sang total : 8 semaines pour un homme, 12 semaines pour une femme
 * (intervalles minimaux de l'OMS, comme canDonate() de common/geo.ts).
 * Âge : 18 à 60 ans. Poids : au moins 50 kg (question facultative, déclarée par le donneur).
 * Contre-indications connues du carnet : grossesse en cours, cancer, maladie du sang, VIH.
 */
export const REST_DAYS: Record<string, number> = { M: 56, F: 84 };
export const MIN_AGE = 18;
export const MAX_AGE = 60;
/** Élargissement progressif du rayon de recherche des donneurs, en km. */
export const RADIUS_STEPS = [40, 80, 150] as const;
/** Rayon des « demandes près de chez vous » vues par un donneur. */
export const NEARBY_KM = 40;

export type IneligibleReason = 'REST' | 'TOO_YOUNG' | 'TOO_OLD' | 'WEIGHT' | 'UNAVAILABLE' | 'PREGNANCY' | 'CONDITION';
export type Contraindication = 'PREGNANCY' | 'CONDITION';

/** Maladies qui excluent le don (cancers, maladies du sang, VIH) : codes CIM-10. */
const EXCLUDING_CONDITION = /^(C|D5\d|D6\d|B2[0-4])/;

/** Contre-indication tirée du carnet (sans jamais nommer la maladie). */
export function contraindicationOf(p: { conditions?: { code: string | null }[]; pregnancies?: unknown[] } | null | undefined): Contraindication | null {
  if (!p) return null;
  if (p.pregnancies?.length) return 'PREGNANCY';
  return p.conditions?.some((c) => EXCLUDING_CONDITION.test(c.code ?? '')) ? 'CONDITION' : null;
}

export interface Eligibility {
  eligible: boolean;
  reason?: IneligibleReason;
  /** Premier jour où un nouveau don est possible (repos après le dernier don). */
  nextDate: Date | null;
  age: number | null;
}

export function ageOn(birth: Date, now = new Date()): number {
  let a = now.getUTCFullYear() - birth.getUTCFullYear();
  const m = now.getUTCMonth() - birth.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < birth.getUTCDate())) a--;
  return a;
}

/** Date à partir de laquelle la personne peut redonner (null : jamais donné, donc tout de suite). */
export function nextDonationDate(lastDonationAt: Date | null, sex: string): Date | null {
  if (!lastDonationAt) return null;
  return new Date(lastDonationAt.getTime() + (REST_DAYS[sex] ?? REST_DAYS.F) * 86_400_000);
}

export function eligibility(
  input: { lastDonationAt: Date | null; sex: string; birthDate?: Date | null; age?: number | null; weightOk?: boolean | null; available?: boolean; contraindication?: Contraindication | null },
  now = new Date(),
): Eligibility {
  const age = input.birthDate ? ageOn(input.birthDate, now) : (input.age ?? null);
  const nextDate = nextDonationDate(input.lastDonationAt, input.sex);
  const base = { nextDate: nextDate && nextDate > now ? nextDate : null, age };
  if (input.contraindication) return { eligible: false, reason: input.contraindication, ...base };
  if (age !== null && age < MIN_AGE) return { eligible: false, reason: 'TOO_YOUNG', ...base };
  if (age !== null && age > MAX_AGE) return { eligible: false, reason: 'TOO_OLD', ...base };
  if (input.weightOk === false) return { eligible: false, reason: 'WEIGHT', ...base };
  if (base.nextDate) return { eligible: false, reason: 'REST', ...base };
  if (input.available === false) return { eligible: false, reason: 'UNAVAILABLE', ...base };
  return { eligible: true, ...base };
}

/** Peut être sollicité aujourd'hui (repos respecté ; l'âge et le carnet ne sont vérifiés que s'ils sont connus). */
export function canDonateNow(lastDonationAt: Date | null, sex: string, birthDate?: Date | null, contraindication?: Contraindication | null, now = new Date()): boolean {
  return eligibility({ lastDonationAt, sex, birthDate, contraindication }, now).eligible;
}

/** Cadre de recherche (degrés) autour d'un point : filtre la base avant le calcul exact des distances. */
export function boundingBox(lat: number, lng: number, km: number) {
  const dLat = km / 111;
  const dLng = km / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return { lat: { gte: lat - dLat, lte: lat + dLat }, lng: { gte: lng - dLng, lte: lng + dLng } };
}

/**
 * Donneurs à alerter : d'abord dans le rayon de 40 km ; si personne n'y est disponible, 80 km,
 * puis 150 km. Renvoie le rayon retenu (null si personne, même à 150 km).
 */
export function pickByRadius<T extends { km: number }>(candidates: T[], max: number, steps: readonly number[] = RADIUS_STEPS): { chosen: T[]; radiusKm: number | null } {
  const sorted = [...candidates].sort((a, b) => a.km - b.km);
  for (const r of steps) {
    const inside = sorted.filter((c) => c.km <= r);
    if (inside.length) return { chosen: inside.slice(0, max), radiusKm: r };
  }
  return { chosen: [], radiusKm: null };
}

/** Couverture d'une demande : chaque donneur qui dit oui et chaque poche réservée couvre une poche. */
export function coverage(quantity: number, accepted: number, reserved: number) {
  const covered = Math.min(quantity, accepted + reserved);
  return { quantity, accepted, reserved, covered, missing: Math.max(0, quantity - covered), complete: accepted + reserved >= quantity };
}

/**
 * Poches à prendre dans un stock pour un receveur : groupe identique d'abord, puis les autres
 * groupes compatibles (O- en dernier : c'est la réserve universelle).
 */
export function planStockDraw(rows: { bloodGroup: string; units: number }[], recipientGroup: string, compatible: string[], units: number) {
  const rank = (g: string) => (g === recipientGroup ? 0 : g === 'O-' ? 2 : 1);
  const ordered = rows.filter((r) => compatible.includes(r.bloodGroup) && r.units > 0).sort((a, b) => rank(a.bloodGroup) - rank(b.bloodGroup) || b.units - a.units);
  const draw: { bloodGroup: string; units: number }[] = [];
  let left = units;
  for (const r of ordered) {
    if (left <= 0) break;
    const take = Math.min(left, r.units);
    draw.push({ bloodGroup: r.bloodGroup, units: take });
    left -= take;
  }
  return { draw, missing: left };
}
