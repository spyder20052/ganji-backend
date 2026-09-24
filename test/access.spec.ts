import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessService } from '../src/common/access.service';
import type { AuthUser } from '../src/common/auth-user';

/** Base en mémoire minimale pour tester la décision d'accès sans PostgreSQL. */
function fakePrisma(state: { consents?: unknown[]; team?: boolean; delegation?: { scopes: string[] } | null }) {
  return {
    patient: { findUnique: vi.fn(async () => ({ id: 'p1', userId: 'u-koffi', parentId: null })) },
    delegation: { findFirst: vi.fn(async () => state.delegation ?? null) },
    careTeamMember: { findUnique: vi.fn(async () => (state.team ? { id: 't' } : null)) },
    consent: { findFirst: vi.fn(async () => (state.consents?.[0] as object) ?? null) },
  };
}

const koffi: AuthUser = { id: 'u-koffi', role: 'PATIENT', name: 'Koffi', patientId: 'p1' };
const drH: AuthUser = { id: 'u-h', role: 'PRACTITIONER', name: 'Dr Houngbédji', practitionerId: 'pr-h' };
const drD: AuthUser = { id: 'u-d', role: 'PRACTITIONER', name: 'Dr Dansou', practitionerId: 'pr-d' };
const afiavi: AuthUser = { id: 'u-a', role: 'CAREGIVER', name: 'Afiavi' };

describe('AccessService : consentement ou motif tracé', () => {
  let audit: { log: ReturnType<typeof vi.fn> };
  beforeEach(() => (audit = { log: vi.fn(async () => ({})) }));

  it('le patient accède à son propre carnet sans être journalisé', async () => {
    const s = new AccessService(fakePrisma({}) as never, audit as never);
    await expect(s.assert(koffi, 'p1', 'summary', 'Fiche')).resolves.toMatchObject({ via: 'OWNER' });
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('un soignant sans consentement est refusé ET la tentative est journalisée', async () => {
    const s = new AccessService(fakePrisma({}) as never, audit as never);
    await expect(s.assert(drD, 'p1', 'summary', 'Fiche')).rejects.toBeInstanceOf(ForbiddenException);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'DENIED', allowed: false, patientId: 'p1' }));
  });

  it("l'équipe de soins accède, la lecture est journalisée", async () => {
    const s = new AccessService(fakePrisma({ team: true }) as never, audit as never);
    await expect(s.assert(drH, 'p1', 'observations', 'Résultats')).resolves.toMatchObject({ via: 'CARE_TEAM' });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'READ', allowed: true }));
  });

  it("l'équipe de soins n'ouvre jamais le compartiment très sensible sans consentement explicite", async () => {
    const s = new AccessService(fakePrisma({ team: true }) as never, audit as never);
    await expect(s.decide(drH, 'p1', 'sensitive')).resolves.toMatchObject({ allowed: false });
  });

  it('un consentement QR actif ouvre le périmètre accordé', async () => {
    const expiresAt = new Date(Date.now() + 3600_000);
    const s = new AccessService(fakePrisma({ consents: [{ source: 'QR', expiresAt }] }) as never, audit as never);
    await expect(s.decide(drD, 'p1', 'summary')).resolves.toMatchObject({ allowed: true, via: 'CONSENT', consentExpiresAt: expiresAt });
  });

  it('le bris de glace est identifié comme tel dans le journal', async () => {
    const s = new AccessService(fakePrisma({ consents: [{ source: 'BREAK_GLASS', expiresAt: new Date(Date.now() + 1e6) }] }) as never, audit as never);
    await s.assert(drD, 'p1', 'timeline', 'Chronologie');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'READ_BREAK_GLASS' }));
  });

  it("l'aidant n'agit que dans les périmètres délégués", async () => {
    const s = new AccessService(fakePrisma({ delegation: { scopes: ['summary', 'reminders'] } }) as never, audit as never);
    await expect(s.decide(afiavi, 'p1', 'summary')).resolves.toMatchObject({ allowed: true, via: 'DELEGATION' });
    await expect(s.decide(afiavi, 'p1', 'observations')).resolves.toMatchObject({ allowed: false });
    await expect(s.decide(afiavi, 'p1', 'sensitive')).resolves.toMatchObject({ allowed: false });
  });
});
