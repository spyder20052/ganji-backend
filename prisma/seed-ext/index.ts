import { seedAppointments } from './appointments';
import { seedBlood } from './blood';
import { seedOrders } from './orders';
import { seedListen } from './listen';
import { seedRights } from './rights';
import { seedAssistant } from './assistant';
import { seedCircle } from './circle';
import { seedProfile } from './profile';
import type { SeedCtx } from './context';

export type { SeedCtx } from './context';
export { seedProfile, seedBlood, seedAppointments, seedOrders, seedListen, seedRights, seedAssistant, seedCircle };

/** Seeds des fonctions ajoutées, dans l'ordre (le profil d'abord : les autres s'appuient dessus). */
export async function seedExtensions(ctx: SeedCtx) {
  await seedProfile(ctx);
  await seedBlood(ctx);
  await seedAppointments(ctx);
  await seedOrders(ctx);
  await seedListen(ctx);
  await seedRights(ctx);
  await seedAssistant(ctx);
  await seedCircle(ctx);
}
