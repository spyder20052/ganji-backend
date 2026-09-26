import { TARIFFS } from '../../src/data/tariffs';
import type { SeedCtx } from './context';

/** Numéro ARCH de démonstration de Koffi (chiffre de contrôle de Luhn valide : voir test/rights.spec.ts). */
export const KOFFI_ARCH = 'ARCH-20241535';

/**
 * Données de démonstration : droits. Rejouable.
 * - grille des tarifs publics (indicatifs) ;
 * - Koffi : ARCH vérifiée, 70 % ; un reste à charge déjà payé par MTN MoMo (bac à sable) ;
 * - Serge : aucune couverture déclarée (le parcours « Déclarer ma couverture » reste à faire).
 */
export async function seedRights(ctx: SeedCtx) {
  const { prisma, users } = ctx;
  await prisma.careTariff.deleteMany({ where: { code: { notIn: TARIFFS.map((t) => t.code) } } });
  for (const t of TARIFFS) {
    await prisma.careTariff.upsert({ where: { code: t.code }, update: t, create: t });
  }

  const koffi = users.koffi && (await prisma.patient.findUnique({ where: { userId: users.koffi.id }, select: { id: true } }));
  if (koffi) {
    const coverage = { scheme: 'ARCH', number: KOFFI_ARCH, rate: 70, status: 'ACTIF', source: 'VERIFIE', verifiedAt: ctx.daysAgo(20, 10) };
    await prisma.coverage.upsert({ where: { patientId: koffi.id }, update: coverage, create: { patientId: koffi.id, ...coverage } });

    await prisma.payment.deleteMany({ where: { patientId: koffi.id, kind: 'RESTE_A_CHARGE' } });
    const year = new Date().getUTCFullYear();
    await prisma.payment.create({
      data: {
        patientId: koffi.id,
        userId: users.koffi.id,
        kind: 'RESTE_A_CHARGE',
        ref: 'EST-5A1C0D2E',
        // Consultation de spécialiste (5 000) + NFS (3 500) = 8 500 ; ARCH 70 % → reste 2 550.
        label: 'Consultation de spécialiste, NFS',
        amountFcfa: 2550,
        provider: 'MTN_MOMO',
        phone: '0190000001',
        status: 'REUSSI',
        receipt: `GJ-${year}-000101`,
        createdAt: ctx.daysAgo(12, 11),
      },
    });
  }

  const serge = users.serge && (await prisma.patient.findUnique({ where: { userId: users.serge.id }, select: { id: true } }));
  if (serge) {
    await prisma.coverage.deleteMany({ where: { patientId: serge.id } });
    await prisma.payment.deleteMany({ where: { patientId: serge.id, kind: 'RESTE_A_CHARGE' } });
  }
}
