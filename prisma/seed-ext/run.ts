/**
 * Relance le seed d'une seule fonction sur la base existante, sans tout réinitialiser :
 *   npx tsx prisma/seed-ext/run.ts <profile|blood|appointments|orders|listen|rights|assistant|circle>
 * Chaque seed de fonction doit donc être rejouable (il efface ou met à jour ses propres données).
 */
import { PrismaClient } from '@prisma/client';
import { loadDotEnv } from '../../src/common/env';
import * as seeds from './index';

loadDotEnv();
const prisma = new PrismaClient();
const PERSONAS: Record<string, string> = {
  koffi: 'koffi', afiavi: 'afiavi', bio: 'bio', houngbedji: 'houngbedji', agossou: 'dr-sans-consentement', rachidatou: 'rachidatou',
  pharmaParakou: 'pharmacie-parakou', pharmaCotonou: 'pharmacie-cotonou', ants: 'ants', ministere: 'ministere', mathieu: 'mathieu',
  rafiatou: 'rafiatou', serge: 'serge', admin: 'controleur',
};
const DAY = 86_400_000;
const daysAgo = (d: number, h = 9) => {
  const x = new Date(Date.now() - d * DAY);
  x.setUTCHours(h - 1, 0, 0, 0);
  return x;
};
const at = (d: number, h: number, m = 0) => {
  const x = new Date(Date.now() + d * DAY);
  x.setUTCHours(h - 1, m, 0, 0);
  return x;
};

async function main() {
  const name = process.argv[2];
  const fn = (seeds as Record<string, unknown>)[`seed${name?.[0]?.toUpperCase()}${name?.slice(1)}`];
  if (typeof fn !== 'function') throw new Error(`Seed inconnu : ${name}`);
  const users: Record<string, { id: string }> = {};
  for (const [key, persona] of Object.entries(PERSONAS)) {
    const u = await prisma.user.findUnique({ where: { demoPersona: persona }, select: { id: true } });
    if (u) users[key] = u;
  }
  const communes = await prisma.commune.findMany({ select: { id: true, name: true } });
  const communeId = (n: string) => communes.find((c) => c.name === n)!.id;
  await (fn as (c: seeds.SeedCtx) => Promise<void>)({ prisma, users, communeId, daysAgo, inDays: (d, h) => daysAgo(-d, h), at });
  console.log(`Seed « ${name} » rejoué.`);
}
main().finally(() => prisma.$disconnect());
