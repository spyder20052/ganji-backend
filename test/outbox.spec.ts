import { describe, expect, it, vi } from 'vitest';
import { OutboxService } from '../src/common/outbox.service';

describe('OutboxService : aucune donnée médicale par SMS', () => {
  const prisma = { outbox: { create: vi.fn(async ({ data }) => ({ id: 'x', ...data })) } };
  const outbox = new OutboxService(prisma as never);

  it('envoie un rappel neutre', async () => {
    const r = await outbox.send({ channel: 'SMS', to: '0190000001', body: 'Alafia : rendez-vous demain à 10 h au CNHU-HKM.' });
    expect(r.status).toBe('SENT');
  });

  it('refuse un SMS contenant un diagnostic', async () => {
    await expect(outbox.send({ channel: 'SMS', to: '0190000001', body: 'Votre traitement contre la leucémie est prêt' })).rejects.toThrow(/aucune donnée médicale/);
    await expect(outbox.send({ channel: 'SMS', to: '0190000001', body: 'Résultat VIH disponible' })).rejects.toThrow();
  });
});
