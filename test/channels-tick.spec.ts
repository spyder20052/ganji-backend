import { describe, expect, it, vi } from 'vitest';

// Services voisins remplacés : seul l'envoi des rappels par lots est testé ici.
vi.mock('../src/blood/blood.service', () => ({ BloodService: class {} }));
vi.mock('../src/alerts/alerts.service', () => ({ AlertsService: class {} }));
vi.mock('../src/circle/circle.service', () => ({ CircleService: class {} }));

import { ChannelsService, TICK_BATCH } from '../src/channels/channels.service';

function reminders(n: number, start = 0) {
  return Array.from({ length: n }, (_, i) => ({
    id: `r${start + i}`,
    kind: 'MEDICATION',
    title: 'Prise : x',
    place: null,
    dueAt: new Date(Date.now() + 3600_000),
    channels: ['SMS'],
    patient: { firstName: 'Koffi', discreetMode: false, user: { phone: '0190000001', lang: 'fr' }, delegations: [] },
  }));
}

describe('tâche planifiée : rappels envoyés par lots jusqu’à épuisement', () => {
  it('450 rappels dus → 3 lots, tous envoyés et marqués', async () => {
    const pending = reminders(450);
    const prisma = {
      reminder: {
        // Chaque lecture renvoie les rappels pas encore envoyés, 200 au plus.
        findMany: vi.fn().mockImplementation(({ take }) => Promise.resolve(pending.filter((r) => !('sent' in r)).slice(0, take))),
        update: vi.fn().mockImplementation(({ where }) => {
          Object.assign(pending.find((r) => r.id === where.id)!, { sent: true });
          return Promise.resolve({});
        }),
      },
      donorAlert: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    const outbox = { send: vi.fn().mockResolvedValue({}) };
    const alerts = { detectClusters: vi.fn().mockResolvedValue({ created: 0 }) };
    const ticks = { runAll: vi.fn().mockResolvedValue({}) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new ChannelsService(prisma as any, outbox as any, {} as any, alerts as any, ticks as any, {} as any);
    const out = await svc.tick();
    expect(out.remindersSent).toBe(450);
    expect(prisma.reminder.findMany).toHaveBeenCalledTimes(3);
    expect(prisma.reminder.findMany.mock.calls[0][0].take).toBe(TICK_BATCH);
    expect(outbox.send).toHaveBeenCalledTimes(450);
  });
});
