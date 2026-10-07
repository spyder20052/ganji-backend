/**
 * Transaction sérialisable rejouée : un conflit de sérialisation est rejoué (jusqu'à trois fois), toute autre
 * erreur remonte sans rejeu. C'est ce qui rend sûres deux réponses de donneurs ou deux réservations simultanées.
 */
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { serializable } from '../src/common/transactions';

const conflict = () => new Prisma.PrismaClientKnownRequestError('conflit de sérialisation', { code: 'P2034', clientVersion: 'test' });
type Client = Parameters<typeof serializable>[0];

function fakeClient(impl: () => Promise<unknown>) {
  const transaction = vi.fn(impl);
  return { prisma: { $transaction: transaction } as unknown as Client, transaction };
}

describe('transaction sérialisable rejouée en cas de conflit', () => {
  it('rejoue après un conflit et rend le résultat de la tentative qui aboutit', async () => {
    let calls = 0;
    const { prisma, transaction } = fakeClient(async () => {
      if (++calls < 3) throw conflict();
      return 'ok';
    });
    await expect(serializable(prisma, async () => 'ok')).resolves.toBe('ok');
    expect(transaction).toHaveBeenCalledTimes(3);
  });

  it('abandonne après trois conflits avec un 409 explicite', async () => {
    const { prisma, transaction } = fakeClient(async () => {
      throw conflict();
    });
    await expect(serializable(prisma, async () => 'ok')).rejects.toBeInstanceOf(ConflictException);
    expect(transaction).toHaveBeenCalledTimes(3);
  });

  it('laisse remonter toute autre erreur sans rejouer', async () => {
    const { prisma, transaction } = fakeClient(async () => {
      throw new Error('autre');
    });
    await expect(serializable(prisma, async () => 'ok')).rejects.toThrow('autre');
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
