import type { SeedCtx } from './context';

/**
 * Données de démonstration : profil. Les comptes de démonstration ont déjà rempli leur profil
 * (pas d'accueil à la connexion) ; le groupe de Koffi a été vérifié par le laboratoire du CNHU-HKM,
 * les autres groupes sont déclarés. Rejouable : ne fait que des mises à jour.
 */
export async function seedProfile(ctx: SeedCtx) {
  const { prisma, users, daysAgo } = ctx;
  const personaIds = Object.values(users).map((u) => u.id);

  await prisma.patient.updateMany({
    where: { userId: { in: personaIds }, profileDoneAt: null },
    data: { profileDoneAt: daysAgo(45) },
  });
  await prisma.patient.updateMany({
    where: { userId: { in: personaIds }, bloodGroup: { not: null }, bloodGroupSource: null },
    data: { bloodGroupSource: 'DECLARE' },
  });

  const addresses: Record<string, { address: string; verified?: boolean; emergency?: [string, string] }> = {
    koffi: { address: 'Tankpè · derrière l’école primaire publique', verified: true },
    afiavi: { address: 'Tankpè · maison bleue près du marché', emergency: ['Koffi Agossou (fils)', '0190000001'] },
    bio: { address: 'Bérécingou · à côté de la pharmacie' },
    rafiatou: { address: 'Kossarou · près de la mosquée centrale', verified: true },
    serge: { address: 'Ouando · face au stade' },
  };
  for (const [key, a] of Object.entries(addresses)) {
    const u = users[key];
    if (!u) continue;
    await prisma.patient.updateMany({
      where: { userId: u.id },
      data: {
        address: a.address,
        ...(a.verified ? { bloodGroupSource: 'VERIFIE' } : {}),
        ...(a.emergency ? { emergencyName: a.emergency[0], emergencyPhone: a.emergency[1] } : {}),
      },
    });
  }
}
