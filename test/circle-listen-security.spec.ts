/**
 * Revue de sécurité de l'écoute et du cercle de soins : simulateur limité aux numéros de démonstration,
 * confirmation d'un rappel (rôle, droit « rappels », fenêtre, journal), noms de médicaments masqués,
 * réglage des aidants sans perte de droits, journal des lectures de l'écoutante, pagination.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ChannelsService } from '../src/channels/channels.service';
import { CircleService, genericTitle } from '../src/circle/circle.service';
import type { AuthUser } from '../src/common/auth-user';
import { CryptoService } from '../src/common/crypto.service';
import { MAX_MESSAGES, ListenService } from '../src/listen/listen.service';

const H = 3_600_000;
const koffi: AuthUser = { id: 'u-koffi', role: 'PATIENT', name: 'Koffi Agossou', patientId: 'p-koffi' };
const afiavi: AuthUser = { id: 'u-afiavi', role: 'CAREGIVER', name: 'Afiavi Agossou', patientId: 'p-afiavi' };
const pharmacist: AuthUser = { id: 'u-pharma', role: 'PHARMACIST', name: 'Dr Zinsou', patientId: null };

describe('Simulateur SMS : numéros de démonstration seulement', () => {
  const outboxRows = [
    { id: '1', to: '0190000001', body: 'Code 123456' }, // persona
    { id: '2', to: '0196000000', body: 'Appel au don' }, // donneur simulé (Rodrigue)
    { id: '3', to: '0197123456', body: 'Code 654321' }, // vraie inscription
    { id: '4', to: '0196000123', body: 'Appel au don' }, // donneur relié à un vrai compte
  ];
  const prisma = {
    user: {
      findMany: vi.fn(async ({ where }: { where: { phone: { in: string[] } } }) =>
        [
          { phone: '0190000001', demoPersona: 'koffi' },
          { phone: '0197123456', demoPersona: null },
          { phone: '0196000123', demoPersona: null },
        ].filter((u) => where.phone.in.includes(u.phone)),
      ),
    },
    donor: {
      findMany: vi.fn(async ({ where }: { where: { phone: { in: string[] }; userId: null } }) =>
        [{ phone: '0196000000' }].filter((d) => where.userId === null && where.phone.in.includes(d.phone)),
      ),
    },
    outbox: {
      findMany: vi.fn(async ({ where }: { where?: { to: string } }) => (where ? outboxRows.filter((r) => r.to === where.to) : outboxRows)),
    },
  };
  const svc = new ChannelsService(prisma as never, {} as never, {} as never, {} as never, { register: vi.fn() } as never, {} as never);

  it('persona et donneur simulé : visibles (parcours héros avec Rodrigue)', async () => {
    expect(await svc.outboxFor('0190000001')).toHaveLength(1);
    expect(await svc.outboxFor('01 96 00 00 00')).toHaveLength(1);
  });

  it('vraie inscription ou donneur relié à un compte : rien (ni code, ni message)', async () => {
    expect(await svc.outboxFor('0197123456')).toEqual([]);
    expect(await svc.outboxFor('0196000123')).toEqual([]);
  });

  it('le fil public ne contient que les numéros de démonstration', async () => {
    expect((await svc.recent()).map((r) => r.to)).toEqual(['0190000001', '0196000000']);
  });
});

describe('Cercle de soins : confirmation d’un rappel', () => {
  function setup(reminder: Record<string, unknown>, decision: () => Promise<unknown> = async () => ({ allowed: true, via: 'DELEGATION' })) {
    const audit = { log: vi.fn(async () => ({})) };
    const access = { assert: vi.fn(decision) };
    const prisma = {
      reminder: {
        findUnique: vi.fn(async () => ({ id: 'r1', patientId: 'p-koffi', kind: 'MEDICATION', ...reminder, patient: { firstName: 'Koffi' } })),
        updateMany: vi.fn(async () => ({ count: 1 })),
        findUniqueOrThrow: vi.fn(async () => ({ id: 'r1', confirmedAt: new Date() })),
      },
    };
    const svc = new CircleService(prisma as never, { notify: vi.fn() } as never, access as never, audit as never, { register: vi.fn() } as never);
    return { svc, audit, access, prisma };
  }

  it('réservée au patient et à ses aidants (un pharmacien avec consentement est refusé)', async () => {
    const { svc } = setup({ dueAt: new Date(Date.now() - H), sentAt: new Date(Date.now() - H), confirmedAt: null, escalation: 0 });
    await expect(svc.confirm(pharmacist, 'r1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('un aidant passe par le droit « rappels » ; la confirmation est journalisée (WRITE)', async () => {
    const { svc, access, audit } = setup({ dueAt: new Date(Date.now() - H), sentAt: new Date(Date.now() - H), confirmedAt: null, escalation: 0 });
    await expect(svc.confirm(afiavi, 'r1')).resolves.toMatchObject({ state: 'FAIT' });
    expect(access.assert).toHaveBeenCalledWith(afiavi, 'p-koffi', 'reminders', expect.any(String));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'WRITE', patientId: 'p-koffi' }));
  });

  it('aidant sans droit « rappels » : refusé par le contrôle d’accès', async () => {
    const { svc } = setup({ dueAt: new Date(Date.now() - H), sentAt: new Date(Date.now() - H), confirmedAt: null, escalation: 0 }, async () => {
      throw new ForbiddenException();
    });
    await expect(svc.confirm(afiavi, 'r1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('trop tôt (plus de 2 h avant l’heure) : refusé, rien n’est écrit', async () => {
    const { svc, prisma, audit } = setup({ dueAt: new Date(Date.now() + 5 * H), sentAt: null, confirmedAt: null, escalation: 0 });
    await expect(svc.confirm(koffi, 'r1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.reminder.updateMany).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });
});

describe('Cercle de soins : ce que voit un aidant et réglages', () => {
  function circleSetup(scopes: string[]) {
    const reminder = { id: 'r1', patientId: 'p-koffi', kind: 'MEDICATION', title: 'Prise : Imatinib', place: 'Pharmacie Camp Guézo', dueAt: new Date(), sentAt: new Date(), confirmedAt: null, escalation: 0 };
    const prisma = {
      delegation: {
        findFirst: vi.fn(async () => ({ scopes })),
        findMany: vi.fn(async () => []),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      patient: { findUniqueOrThrow: vi.fn(async () => ({ id: 'p-koffi', firstName: 'Koffi', communeId: null, commune: null, user: { phone: '0190000001' } })) },
      user: { findMany: vi.fn(async () => []) },
      careTeamMember: { findMany: vi.fn(async () => []) },
      reminder: { findMany: vi.fn(async () => [reminder]) },
      relayVisit: { findMany: vi.fn(async () => []) },
      notification: { findMany: vi.fn(async () => []) },
    };
    const access = { assert: vi.fn(async () => ({ allowed: true, via: 'DELEGATION' })) };
    const svc = new CircleService(prisma as never, { notify: vi.fn() } as never, access as never, { log: vi.fn() } as never, { register: vi.fn() } as never);
    return { svc, prisma };
  }

  it('droit « rappels » seul : « Prise de traitement », sans nom de médicament ni lieu', async () => {
    const { svc } = circleSetup(['summary', 'reminders']);
    const c = await svc.circle(afiavi, '7d2bae3e-e9b3-4ee0-9992-149e79753990');
    expect(c.today[0]).toMatchObject({ title: genericTitle('MEDICATION'), place: null });
    expect(JSON.stringify(c)).not.toContain('Imatinib');
  });

  it('droit « ordonnances » (ou « all ») : le nom du médicament reste visible', async () => {
    const { svc } = circleSetup(['reminders', 'prescriptions']);
    const c = await svc.circle(afiavi, '7d2bae3e-e9b3-4ee0-9992-149e79753990');
    expect(c.today[0].title).toBe('Prise : Imatinib');
  });

  it('réglage : seul « reminders » change, les autres droits restent ; « all » n’est jamais réécrit', async () => {
    const { svc, prisma } = circleSetup([]);
    const circle = vi.spyOn(svc, 'circle').mockResolvedValue({} as never);
    prisma.delegation.findUnique.mockResolvedValueOnce({ id: 'd1', patientId: 'p-koffi', revokedAt: null, scopes: ['summary', 'reminders', 'appointments', 'prescriptions'], caregiver: { displayName: 'Afiavi' } });
    await svc.updateSettings(koffi, { delegationId: 'd1', escalations: false });
    expect(prisma.delegation.update).toHaveBeenCalledWith({ where: { id: 'd1' }, data: { scopes: ['summary', 'appointments', 'prescriptions'] } });

    prisma.delegation.update.mockClear();
    prisma.delegation.findUnique.mockResolvedValueOnce({ id: 'd2', patientId: 'p-koffi', revokedAt: null, scopes: ['all'], caregiver: { displayName: 'Sèna' } });
    await svc.updateSettings(koffi, { delegationId: 'd2', escalations: true });
    expect(prisma.delegation.update).not.toHaveBeenCalled();
    prisma.delegation.findUnique.mockResolvedValueOnce({ id: 'd2', patientId: 'p-koffi', revokedAt: null, scopes: ['all'], caregiver: { displayName: 'Sèna' } });
    await expect(svc.updateSettings(koffi, { delegationId: 'd2', escalations: false })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.delegation.update).not.toHaveBeenCalled();
    circle.mockRestore();
  });
});

describe('Écoute : journal de l’écoutante, pagination, SMS sans identifiant', () => {
  const crypto = new CryptoService();
  const counselor: AuthUser = { id: 'u-psy', role: 'PRACTITIONER', name: 'Mme Hounkpè (écoute)', practitionerId: 'pr-psy' };
  function setup(anonymous: boolean) {
    const audit = { log: vi.fn(async () => ({})) };
    const notify = vi.fn(async () => 1);
    const thread = {
      id: 't1',
      userId: 'u-koffi',
      anonymous,
      urgent: false,
      status: 'EN_COURS',
      counselorId: 'u-psy',
      counselorName: 'Mme Hounkpè',
      callbackPhone: null,
      callbackAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      user: { displayName: 'Koffi Agossou', patient: { id: 'p-koffi' } },
      messages: [{ id: 'm1', threadId: 't1', author: 'PERSONNE', bodyEnc: crypto.encrypt('Bonjour')!, createdAt: new Date() }],
    };
    const prisma = {
      practitioner: { findUnique: vi.fn(async () => ({ specialty: 'PSYCHOLOGIE', verifiedAt: new Date(), user: { displayName: 'Mme Hounkpè (écoute)' } })) },
      listenThread: { findUnique: vi.fn(async () => ({ ...thread, messages: [...thread.messages] })), update: vi.fn() },
      listenMessage: { createMany: vi.fn() },
      user: { findMany: vi.fn(async () => [{ id: 'u-koffi', lang: 'fr' }]) },
    };
    const svc = new ListenService(prisma as never, crypto, { notify } as never, audit as never);
    return { svc, prisma, audit, notify };
  }

  it('conversation nommée : lecture journalisée dans le carnet de la personne, une fois par quart d’heure', async () => {
    const { svc, audit } = setup(false);
    await svc.counselorGet(counselor, 't1');
    await svc.counselorGet(counselor, 't1');
    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'READ', patientId: 'p-koffi' }));
  });

  it('conversation anonyme : lecture journalisée sans aucun lien avec un carnet', async () => {
    const { svc, audit } = setup(true);
    const view = await svc.counselorGet(counselor, 't1');
    expect(view.name).toBeNull();
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'READ', patientId: null }));
  });

  it('seuls les derniers messages sont chargés', async () => {
    const { svc, prisma } = setup(true);
    await svc.counselorGet(counselor, 't1');
    const args = prisma.listenThread.findUnique.mock.calls[0] as unknown as [{ include: { messages: { take: number; orderBy: unknown } } }];
    expect(args[0].include.messages).toMatchObject({ take: MAX_MESSAGES, orderBy: { createdAt: 'desc' } });
  });

  it('le SMS de réponse ne porte pas l’identifiant de la conversation', async () => {
    const { svc, notify } = setup(true);
    await svc.counselorMessage(counselor, 't1', 'Je suis là.');
    const n = notify.mock.calls[0] as unknown as [string[], { ref?: string; sms?: unknown }];
    expect(n[1].ref).toBe('listen');
    expect(n[1].sms).toBeTypeOf('function');
  });
});
