import { describe, expect, it } from 'vitest';
import { boundingBox, canDonateNow, contraindicationOf, coverage, eligibility, nextDonationDate, pickByRadius, planStockDraw } from '../src/blood/eligibility';
import { canDonate, distanceKm } from '../src/common/geo';

const NOW = new Date('2026-09-26T10:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

describe('M4 · règles du don de sang', () => {
  it('impose 8 semaines de repos à un homme et 12 semaines à une femme (même règle que canDonate)', () => {
    expect(eligibility({ lastDonationAt: daysAgo(57), sex: 'M' }, NOW).eligible).toBe(true);
    expect(eligibility({ lastDonationAt: daysAgo(55), sex: 'M' }, NOW).reason).toBe('REST');
    const woman = eligibility({ lastDonationAt: daysAgo(70), sex: 'F' }, NOW);
    expect(woman).toMatchObject({ eligible: false, reason: 'REST' });
    expect(woman.nextDate?.toISOString()).toBe(new Date(daysAgo(70).getTime() + 84 * 86_400_000).toISOString());
    expect(eligibility({ lastDonationAt: daysAgo(85), sex: 'F' }, NOW).eligible).toBe(true);
    expect(eligibility({ lastDonationAt: null, sex: 'F' }, NOW)).toMatchObject({ eligible: true, nextDate: null });
    for (const [days, sex] of [[55, 'M'], [57, 'M'], [83, 'F'], [85, 'F']] as const) {
      expect(canDonateNow(daysAgo(days), sex, null, null, NOW)).toBe(canDonate(daysAgo(days), sex, NOW));
    }
  });

  it('écarte la grossesse en cours et les maladies qui excluent le don, sans les nommer', () => {
    expect(contraindicationOf({ conditions: [{ code: 'C92.1' }], pregnancies: [] })).toBe('CONDITION');
    expect(contraindicationOf({ conditions: [{ code: 'D57' }] })).toBe('CONDITION');
    expect(contraindicationOf({ conditions: [{ code: 'B24' }] })).toBe('CONDITION');
    expect(contraindicationOf({ conditions: [{ code: 'I10' }, { code: 'E11' }], pregnancies: [{}] })).toBe('PREGNANCY');
    expect(contraindicationOf({ conditions: [{ code: 'I10' }, { code: null }] })).toBeNull();
    expect(contraindicationOf(null)).toBeNull();
    expect(canDonateNow(null, 'F', null, 'PREGNANCY', NOW)).toBe(false);
    expect(eligibility({ lastDonationAt: null, sex: 'M', contraindication: 'CONDITION' }, NOW).reason).toBe('CONDITION');
  });

  it('cherche les donneurs dans un carré qui contient tout le cercle de 150 km', () => {
    const box = boundingBox(6.36, 2.412, 150);
    for (const [lat, lng] of [[7.7, 2.412], [6.36, 3.77], [5.02, 1.05]]) {
      const inside = lat >= box.lat.gte && lat <= box.lat.lte && lng >= box.lng.gte && lng <= box.lng.lte;
      if (distanceKm(6.36, 2.412, lat, lng) <= 150) expect(inside).toBe(true);
    }
    expect(9.35 > box.lat.lte).toBe(true); // Parakou, à plus de 300 km du CNHU, est exclu par la base
  });

  it('refuse avant 18 ans et après 60 ans, et si le poids est insuffisant', () => {
    expect(eligibility({ lastDonationAt: null, sex: 'M', birthDate: new Date('2010-01-01') }, NOW).reason).toBe('TOO_YOUNG');
    expect(eligibility({ lastDonationAt: null, sex: 'M', birthDate: new Date('1965-06-02') }, NOW).reason).toBe('TOO_OLD');
    expect(eligibility({ lastDonationAt: null, sex: 'M', age: 34, weightOk: false }, NOW).reason).toBe('WEIGHT');
    expect(eligibility({ lastDonationAt: null, sex: 'F', birthDate: new Date('1974-05-30') }, NOW)).toMatchObject({ eligible: true, age: 52 });
  });

  it('calcule la date du prochain don', () => {
    expect(nextDonationDate(null, 'M')).toBeNull();
    expect(nextDonationDate(new Date('2026-05-10T08:00:00Z'), 'M')?.toISOString().slice(0, 10)).toBe('2026-07-05');
    expect(nextDonationDate(new Date('2026-05-10T08:00:00Z'), 'F')?.toISOString().slice(0, 10)).toBe('2026-08-02');
  });

  it('élargit le rayon 40 → 80 → 150 km seulement si personne n’est disponible plus près', () => {
    const near = [{ km: 3 }, { km: 55 }, { km: 12 }];
    expect(pickByRadius(near, 14)).toEqual({ chosen: [{ km: 3 }, { km: 12 }], radiusKm: 40 });
    expect(pickByRadius([{ km: 95 }, { km: 70 }], 14)).toEqual({ chosen: [{ km: 70 }], radiusKm: 80 });
    expect(pickByRadius([{ km: 140 }, { km: 120 }], 14).radiusKm).toBe(150);
    expect(pickByRadius([{ km: 400 }], 14)).toEqual({ chosen: [], radiusKm: null });
    expect(pickByRadius(Array.from({ length: 20 }, (_, i) => ({ km: i })), 14).chosen).toHaveLength(14);
  });

  it('couvre une demande avec les donneurs qui ont dit oui et les poches réservées', () => {
    expect(coverage(2, 1, 0)).toMatchObject({ covered: 1, missing: 1, complete: false });
    expect(coverage(2, 1, 1)).toMatchObject({ covered: 2, missing: 0, complete: true });
    expect(coverage(1, 3, 0)).toMatchObject({ covered: 1, missing: 0, complete: true });
  });

  it('prend d’abord le groupe identique, garde le O− universel pour la fin', () => {
    const rows = [
      { bloodGroup: 'O-', units: 5 },
      { bloodGroup: 'O+', units: 1 },
      { bloodGroup: 'A+', units: 1 },
      { bloodGroup: 'B+', units: 9 },
    ];
    expect(planStockDraw(rows, 'A+', ['O-', 'O+', 'A-', 'A+'], 3)).toEqual({ draw: [{ bloodGroup: 'A+', units: 1 }, { bloodGroup: 'O+', units: 1 }, { bloodGroup: 'O-', units: 1 }], missing: 0 });
    expect(planStockDraw(rows, 'O+', ['O-', 'O+'], 9).missing).toBe(3);
    expect(planStockDraw(rows, 'O-', ['O-'], 2).draw).toEqual([{ bloodGroup: 'O-', units: 2 }]);
  });
});
