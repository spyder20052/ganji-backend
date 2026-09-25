import type { PrismaClient } from '@prisma/client';

/** Ce que le seed principal transmet aux seeds des fonctions ajoutées (prisma/seed-ext/*.ts). */
export interface SeedCtx {
  prisma: PrismaClient;
  /** Comptes de démonstration par clé de persona (koffi, afiavi, houngbedji, pharmaCotonou, ants, mathieu…). */
  users: Record<string, { id: string }>;
  communeId: (name: string) => string;
  daysAgo: (d: number, h?: number) => Date;
  inDays: (d: number, h?: number) => Date;
  /** Heure ronde (heure de Cotonou), d jours à partir d'aujourd'hui. */
  at: (d: number, h: number, m?: number) => Date;
}
