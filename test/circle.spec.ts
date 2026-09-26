import { describe, expect, it, vi } from 'vitest';
import { CircleService } from '../src/circle/circle.service';
import { beninDay, canConfirm, escalationLevel, nextVisitDue, reminderState } from '../src/circle/escalation';
import { OutboxService } from '../src/common/outbox.service';
import { sms } from '../src/common/sms';
// Textes SMS de l'écoute (déclarés au chargement du module).
import '../src/listen/listen.service';

const H = 3_600_000;
const NOW = new Date('2026-09-26T12:00:00Z'); // 13 h au Bénin
const ago = (h: number) => new Date(NOW.getTime() - h * H);
const med = (over: Partial<{ kind: string; dueAt: Date; sentAt: Date | null; confirmedAt: Date | null }> = {}) => ({
  kind: 'MEDICATION',
  dueAt: ago(1),
  sentAt: ago(1),
  confirmedAt: null,
  ...over,
});

describe('Cercle de soins : délais de relance', () => {
  it('rien avant 2 h, les aidants à 2 h, le relais à 6 h', () => {
    expect(escalationLevel(med({ dueAt: ago(1.9), sentAt: ago(1.9) }), NOW)).toBe(0);
    expect(escalationLevel(med({ dueAt: ago(2), sentAt: ago(2) }), NOW)).toBe(1);
    expect(escalationLevel(med({ dueAt: ago(5.9), sentAt: ago(5.9) }), NOW)).toBe(1);
    expect(escalationLevel(med({ dueAt: ago(6), sentAt: ago(6) }), NOW)).toBe(2);
  });

  it('un rappel confirmé, pas encore envoyé, trop ancien ou d’un autre type ne relance personne', () => {
    expect(escalationLevel(med({ dueAt: ago(8), sentAt: ago(8), confirmedAt: ago(7) }), NOW)).toBe(0);
    expect(escalationLevel(med({ dueAt: ago(8), sentAt: null }), NOW)).toBe(0);
    expect(escalationLevel(med({ dueAt: ago(49), sentAt: ago(49) }), NOW)).toBe(0);
    expect(escalationLevel(med({ kind: 'VACCINE', dueAt: ago(8), sentAt: ago(8) }), NOW)).toBe(0);
    expect(escalationLevel(med({ kind: 'APPOINTMENT', dueAt: ago(8), sentAt: ago(8) }), NOW)).toBe(2);
  });

  it('un rappel envoyé la veille attend son heure : le délai part de l’heure prévue', () => {
    // Envoyé il y a 20 h pour une prise prévue il y a 1 h : pas encore manqué.
    expect(escalationLevel(med({ sentAt: ago(20), dueAt: ago(1) }), NOW)).toBe(0);
    expect(escalationLevel(med({ sentAt: ago(20), dueAt: ago(3) }), NOW)).toBe(1);
  });

  it('état affiché et bouton « C’est fait »', () => {
    expect(reminderState(med({ dueAt: ago(-3), sentAt: ago(1) }), NOW)).toBe('A_VENIR');
    expect(reminderState(med({ dueAt: ago(1) }), NOW)).toBe('A_FAIRE');
    expect(reminderState(med({ dueAt: ago(3), sentAt: ago(3) }), NOW)).toBe('SANS_REPONSE');
    expect(reminderState(med({ confirmedAt: ago(0.5) }), NOW)).toBe('FAIT');
    expect(canConfirm(med({ dueAt: ago(-1) }), NOW)).toBe(true);
    expect(canConfirm(med({ dueAt: ago(-5) }), NOW)).toBe(false);
    expect(canConfirm(med({ confirmedAt: ago(0.5) }), NOW)).toBe(false);
  });

  it('visite du relais le lendemain à 10 h, heure du Bénin (même tard le soir)', () => {
    expect(nextVisitDue(NOW).toISOString()).toBe('2026-09-27T09:00:00.000Z');
    // 23 h 30 au Bénin (22 h 30 UTC) : le lendemain reste le 27.
    expect(nextVisitDue(new Date('2026-09-26T22:30:00Z')).toISOString()).toBe('2026-09-27T09:00:00.000Z');
    // 0 h 30 au Bénin le 27 (23 h 30 UTC le 26) : le lendemain est le 28.
    expect(nextVisitDue(new Date('2026-09-26T23:30:00Z')).toISOString()).toBe('2026-09-28T09:00:00.000Z');
    expect(beninDay(new Date('2026-09-26T23:30:00Z')).start.toISOString()).toBe('2026-09-26T23:00:00.000Z');
  });
});

describe('Cercle de soins : tâche planifiée', () => {
  function setup(reminders: Record<string, unknown>[]) {
    const notify = vi.fn(async (ids: string | string[]) => (Array.isArray(ids) ? ids.length : 1));
    const created: Record<string, unknown>[] = [];
    const prisma = {
      reminder: {
        updateMany: vi.fn(async () => ({ count: 1 })),
        findMany: vi.fn(async () => reminders),
      },
      delegation: { findMany: vi.fn(async () => [{ caregiverId: 'afiavi', scopes: ['summary', 'reminders'] }, { caregiverId: 'sena', scopes: ['summary'] }]) },
      user: {
        findMany: vi.fn(async (args: { where: { id?: { in: string[] }; role?: string } }) =>
          args.where.role === 'RELAY'
            ? [{ id: 'mathieu', displayName: 'Mathieu Gounou (relais)', phone: '0190000050', patient: { commune: { name: 'Djougou' } } }]
            : (args.where.id?.in ?? []).map((id) => ({ id, lang: 'fr' })),
        ),
      },
      relayVisit: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return { id: 'v1', ...data };
        }),
      },
    };
    const svc = new CircleService(prisma as never, { notify } as never, {} as never, {} as never, { register: vi.fn() } as never);
    return { svc, prisma, notify, created };
  }
  const patient = { id: 'p1', firstName: 'Koffi', discreetMode: false, communeId: 'calavi', userId: 'koffi', commune: { name: 'Abomey-Calavi' } };

  it('2 h sans réponse : seuls les aidants qui reçoivent les rappels sont prévenus (application + SMS)', async () => {
    const { svc, notify, created } = setup([{ id: 'r1', patientId: 'p1', kind: 'MEDICATION', dueAt: ago(2.5), sentAt: ago(2.5), confirmedAt: null, escalation: 0, patient }]);
    const out = await svc.tick(NOW);
    expect(out.cercleAidantsPrevenus).toBe(1);
    expect(out.cercleVisitesDemandees).toBe(0);
    const [ids, n] = notify.mock.calls[0] as unknown as [string[], { href: string; sms?: (l: 'fr') => string }];
    expect(ids).toEqual(['afiavi']);
    expect(n.href).toBe('/app/cercle?p=p1&r=r1');
    expect(n.sms?.('fr')).toBe(sms('circle.sms.missed', 'fr', { name: 'Koffi' }));
    expect(created).toHaveLength(0);
  });

  it('6 h sans réponse : visite du relais demandée pour le lendemain 10 h', async () => {
    const { svc, created } = setup([{ id: 'r1', patientId: 'p1', kind: 'MEDICATION', dueAt: ago(6.5), sentAt: ago(6.5), confirmedAt: null, escalation: 1, patient }]);
    const out = await svc.tick(NOW);
    expect(out.cercleAidantsPrevenus).toBe(0); // déjà prévenus à 2 h
    expect(out.cercleVisitesDemandees).toBe(1);
    expect(created[0]).toMatchObject({ patientId: 'p1', relayId: 'mathieu', relayName: 'Mathieu Gounou', reminderId: 'r1', dueAt: new Date('2026-09-27T09:00:00Z') });
  });

  it('les SMS du cercle restent neutres (acceptés par la file d’envoi)', async () => {
    const outbox = new OutboxService({ outbox: { create: vi.fn(async ({ data }) => data) } } as never);
    for (const key of ['circle.sms.missed', 'circle.sms.missed.discreet', 'circle.sms.visit', 'circle.sms.visitDone', 'listen.reply']) {
      await expect(outbox.send({ channel: 'SMS', to: '0190000002', body: sms(key, 'fr', { name: 'Koffi' }) })).resolves.toBeTruthy();
      await expect(outbox.send({ channel: 'SMS', to: '0190000002', body: sms(key, 'en', { name: 'Koffi' }) })).resolves.toBeTruthy();
    }
  });
});
