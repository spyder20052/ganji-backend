import { ConflictException } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@prisma/client';

/** Codes Prisma d'un conflit de sérialisation ou d'une transaction annulée par PostgreSQL. */
const CONFLICT_CODES = new Set(['P2034', 'P2028']);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Transaction sérialisable, rejouée jusqu'à trois fois en cas de conflit de sérialisation (deux réponses ou deux
 * réservations au même instant : PostgreSQL en annule une, qui relit l'état et conclut correctement, par exemple
 * « besoin déjà couvert »). Au-delà, « réessayez ». Toute autre erreur remonte telle quelle, sans rejeu.
 */
export async function serializable<T>(prisma: Pick<PrismaClient, '$transaction'>, fn: (tx: Prisma.TransactionClient) => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (e) {
      const conflict = e instanceof Prisma.PrismaClientKnownRequestError && CONFLICT_CODES.has(e.code);
      if (!conflict) throw e;
      if (attempt >= attempts) throw new ConflictException('Une autre opération est en cours sur cette demande. Réessayez.');
      await sleep(40 * attempt + Math.floor(Math.random() * 60));
    }
  }
}
