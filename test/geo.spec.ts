import { describe, expect, it } from 'vitest';
import { canDonate, compatibleDonorGroups, distanceKm } from '../src/common/geo';

describe('géographie et compatibilité sanguine', () => {
  it('calcule la distance Cotonou → Porto-Novo (~ 27 km)', () => {
    const d = distanceKm(6.3654, 2.4183, 6.4969, 2.6289);
    expect(d).toBeGreaterThan(24);
    expect(d).toBeLessThan(30);
  });

  it('O− ne reçoit que du O−, AB+ reçoit de tous', () => {
    expect(compatibleDonorGroups('O-')).toEqual(['O-']);
    expect(compatibleDonorGroups('AB+')).toHaveLength(8);
    expect(compatibleDonorGroups('A+')).toEqual(expect.arrayContaining(['O-', 'O+', 'A-', 'A+']));
    expect(compatibleDonorGroups('A+')).not.toContain('B+');
  });

  it('respecte le délai entre deux dons (8 semaines hommes, 12 semaines femmes)', () => {
    const now = new Date('2026-09-24T12:00:00Z');
    const tenWeeksAgo = new Date(now.getTime() - 70 * 86_400_000);
    expect(canDonate(tenWeeksAgo, 'M', now)).toBe(true);
    expect(canDonate(tenWeeksAgo, 'F', now)).toBe(false);
    expect(canDonate(null, 'F', now)).toBe(true);
  });
});
