import type { Prisma } from '@prisma/client';
import { CryptoService } from '../../src/common/crypto.service';
import { prescriptionSignedString, type PrescriptionItem } from '../../src/medications/medications.service';
import { orderRef } from '../../src/orders/orders.logic';
import type { SeedCtx } from './context';

/** Identifiants fixes : le seed se rejoue sans doublon. */
const ID = {
  pastRx: 'a1b2c3d4-0000-4000-8000-0000000000a1',
  delivered: '7e1a2c01-0000-4000-8000-00000000c001',
  pickup: '4b2f5c02-0000-4000-8000-00000000c002',
  waiting: '9c3d8c03-0000-4000-8000-00000000c003',
};
const SEEDED = [ID.delivered, ID.pickup, ID.waiting];
const iso = (d: Date) => d.toISOString();

/**
 * Commandes de médicaments (retrait ou livraison) :
 * - Koffi : une commande de son ordonnance du mois dernier, livrée la semaine dernière (payée MTN MoMo) ;
 *   une commande sans ordonnance prête à retirer (espèces) ;
 * - Serge, pour l'un de ses jumeaux : une commande qui vient d'arriver, visible tout de suite par la pharmacie Camp Guézo ;
 * - stock et prix de la pharmacie Camp Guézo pour l'ordonnance en cours de Koffi (parcours de démonstration) ;
 * - volet « commandes » ajouté à la délégation d'Afiavi : elle peut commander pour Koffi et suivre ses livraisons.
 */
export async function seedOrders(ctx: SeedCtx) {
  const { prisma, users, communeId, daysAgo } = ctx;
  const crypto = new CryptoService();
  const pharmacy = await prisma.facility.findFirst({ where: { type: 'PHARMACIE', name: 'Pharmacie Camp Guézo' } });
  const koffi = users.koffi && (await prisma.patient.findUnique({ where: { userId: users.koffi.id } }));
  if (!pharmacy || !koffi) return;
  const meds = await prisma.medication.findMany();
  const med = (dci: string, strength?: string) => meds.find((m) => m.dci.startsWith(dci) && (!strength || m.strength.startsWith(strength)))!;

  // ─── 1. Remise à zéro : commandes et paiements de commande (y compris ceux créés pendant une démo) ───
  const previous = await prisma.order.findMany({ where: { prescriptionId: { not: null } }, select: { id: true, prescriptionId: true, status: true } });
  // Ordonnances délivrées par une commande de démonstration : de nouveau valables pour rejouer le parcours.
  const replayRx = previous.filter((o) => !SEEDED.includes(o.id) && ['LIVREE', 'RETIREE'].includes(o.status)).map((o) => o.prescriptionId!);
  if (replayRx.length) {
    await prisma.prescription.updateMany({
      where: { id: { in: replayRx }, status: 'DISPENSED', expiresAt: { gt: new Date() } },
      data: { status: 'ACTIVE', dispensedAt: null, dispensedById: null, dispensedByName: null },
    });
  }
  await prisma.payment.deleteMany({ where: { kind: 'COMMANDE' } });
  await prisma.order.deleteMany({});

  // Afiavi (mère de Koffi) peut commander ses médicaments et suivre les livraisons : volet « commandes ».
  if (users.afiavi) {
    const d = await prisma.delegation.findFirst({ where: { patientId: koffi.id, caregiverId: users.afiavi.id, revokedAt: null } });
    if (d && !d.scopes.includes('orders')) await prisma.delegation.update({ where: { id: d.id }, data: { scopes: [...d.scopes, 'orders'] } });
  }

  // ─── 2. Stock et prix de la pharmacie Camp Guézo ───
  const imatinib = med('Imatinib');
  const allopurinol = med('Allopurinol');
  const paracetamol = med('Paracétamol', '500');
  const paraSirop = med('Paracétamol', '120');
  const folique = meds.find((m) => m.dci === 'Acide folique')!;
  const sro = med('Sels de réhydratation');
  const zinc = med('Zinc');
  const stock: [typeof imatinib, number, number][] = [
    [imatinib, 8, 42_500],
    [allopurinol, 24, 1_050],
    [paracetamol, 60, 200],
    [paraSirop, 20, 550],
    [folique, 30, 300],
    [sro, 40, 150],
    [zinc, 30, 500],
  ];
  const price = new Map<string, number>();
  for (const [m, qty, p] of stock) {
    const current = await prisma.pharmacyStock.findUnique({ where: { pharmacyId_medicationId: { pharmacyId: pharmacy.id, medicationId: m.id } } });
    const row = await prisma.pharmacyStock.upsert({
      where: { pharmacyId_medicationId: { pharmacyId: pharmacy.id, medicationId: m.id } },
      update: { quantity: Math.max(current?.quantity ?? 0, qty), priceFcfa: current?.priceFcfa ?? p },
      create: { pharmacyId: pharmacy.id, medicationId: m.id, quantity: qty, priceFcfa: p },
    });
    price.set(m.id, row.priceFcfa ?? p);
  }
  const line = (m: typeof imatinib, quantity: number) => ({ medicationId: m.id, dci: m.dci, form: m.form, strength: m.strength, quantity, unitPriceFcfa: price.get(m.id)! });

  // ─── 3. Ordonnance du mois dernier, commandée et livrée la semaine dernière ───
  const rxItems: PrescriptionItem[] = [
    { medicationId: imatinib.id, dci: imatinib.dci, form: imatinib.form, strength: imatinib.strength, dosage: '1 comprimé par jour, au cours du repas', duration: '30 jours', quantity: 1 },
    { medicationId: allopurinol.id, dci: allopurinol.dci, form: allopurinol.form, strength: allopurinol.strength, dosage: '1 comprimé le matin', duration: '30 jours', quantity: 1 },
  ];
  const pharmacist = users.pharmaCotonou;
  const pharmacistName = 'Dr Zinsou (pharmacie)';
  const t0 = daysAgo(8, 9);
  const at = (min: number) => new Date(t0.getTime() + min * 60_000);
  const rxData = {
    patientId: koffi.id,
    prescriberId: users.houngbedji.id,
    prescriberName: 'Dr Houngbédji (CNHU-HKM)',
    items: rxItems as unknown as Prisma.InputJsonValue,
    signature: crypto.sign(prescriptionSignedString(ID.pastRx, koffi.id, rxItems)),
    status: 'DISPENSED',
    issuedAt: daysAgo(31, 11),
    expiresAt: daysAgo(1, 11),
    dispensedAt: at(125),
    dispensedById: pharmacist?.id ?? null,
    dispensedByName: `Pharmacie Camp Guézo · ${pharmacistName}`,
  };
  await prisma.prescription.upsert({ where: { id: ID.pastRx }, update: rxData, create: { id: ID.pastRx, ...rxData } });

  const deliveredItems = [line(imatinib, 1), line(allopurinol, 1)];
  const deliveredSubtotal = deliveredItems.reduce((s, i) => s + i.unitPriceFcfa * i.quantity, 0);
  await prisma.order.create({
    data: {
      id: ID.delivered,
      patientId: koffi.id,
      userId: users.koffi.id,
      pharmacyId: pharmacy.id,
      pharmacyName: pharmacy.name,
      prescriptionId: ID.pastRx,
      items: deliveredItems,
      subtotalFcfa: deliveredSubtotal,
      deliveryFeeFcfa: 1_000,
      totalFcfa: deliveredSubtotal + 1_000,
      mode: 'LIVRAISON',
      address: 'Godomey, rue du marché, maison bleue après la station',
      communeId: communeId('Abomey-Calavi'),
      phone: '0190000001',
      instructions: 'Appeler en arrivant',
      payment: 'MOBILE_MONEY',
      paymentStatus: 'PAYE',
      status: 'LIVREE',
      courierName: 'Mathias',
      courierPhone: '0197112233',
      handoverCode: '5307',
      events: [
        { status: 'RECUE', at: iso(at(0)), by: 'Koffi Agossou' },
        { status: 'PAYE', at: iso(at(0)), by: 'MTN MoMo', note: 'MM-DEMO7K2P' },
        { status: 'ACCEPTEE', at: iso(at(9)), by: pharmacistName },
        { status: 'PRETE', at: iso(at(38)), by: pharmacistName },
        { status: 'EN_LIVRAISON', at: iso(at(52)), by: pharmacistName, note: 'Mathias' },
        { status: 'LIVREE', at: iso(at(125)), by: pharmacistName },
      ],
      createdAt: at(0),
      updatedAt: at(125),
    },
  });
  await prisma.payment.create({
    data: {
      patientId: koffi.id,
      userId: users.koffi.id,
      kind: 'COMMANDE',
      ref: `order:${ID.delivered}`,
      label: `Commande ${orderRef(ID.delivered)} · Pharmacie Camp Guézo`,
      amountFcfa: deliveredSubtotal + 1_000,
      provider: 'MTN_MOMO',
      phone: '0190000001',
      status: 'REUSSI',
      receipt: 'MM-DEMO7K2P',
      createdAt: at(0),
    },
  });

  // ─── 4. Commande sans ordonnance, prête à retirer, payée au comptoir ───
  const t1 = new Date(Date.now() - 95 * 60_000);
  const at1 = (min: number) => new Date(t1.getTime() + min * 60_000);
  const pickupItems = [line(paracetamol, 2), line(folique, 1)];
  const pickupTotal = pickupItems.reduce((s, i) => s + i.unitPriceFcfa * i.quantity, 0);
  await prisma.order.create({
    data: {
      id: ID.pickup,
      patientId: koffi.id,
      userId: users.koffi.id,
      pharmacyId: pharmacy.id,
      pharmacyName: pharmacy.name,
      items: pickupItems,
      subtotalFcfa: pickupTotal,
      deliveryFeeFcfa: 0,
      totalFcfa: pickupTotal,
      mode: 'RETRAIT',
      phone: '0190000001',
      payment: 'ESPECES',
      paymentStatus: 'A_PAYER',
      status: 'PRETE',
      handoverCode: '2468',
      events: [
        { status: 'RECUE', at: iso(at1(0)), by: 'Koffi Agossou' },
        { status: 'ACCEPTEE', at: iso(at1(6)), by: pharmacistName },
        { status: 'PRETE', at: iso(at1(21)), by: pharmacistName },
      ],
      createdAt: at1(0),
      updatedAt: at1(21),
    },
  });

  // ─── 5. Nouvelle commande en attente : Serge pour l'un de ses jumeaux (livraison à Porto-Novo, Moov Money) ───
  const serge = users.serge && (await prisma.patient.findUnique({ where: { userId: users.serge.id } }));
  const twin = serge && (await prisma.patient.findFirst({ where: { parentId: serge.id }, orderBy: { firstName: 'asc' } }));
  if (serge && twin) {
    const t2 = new Date(Date.now() - 4 * 60_000);
    const items = [line(paraSirop, 1), line(sro, 3), line(zinc, 1)];
    const subtotal = items.reduce((s, i) => s + i.unitPriceFcfa * i.quantity, 0);
    await prisma.order.create({
      data: {
        id: ID.waiting,
        patientId: twin.id,
        userId: users.serge.id,
        pharmacyId: pharmacy.id,
        pharmacyName: pharmacy.name,
        items,
        subtotalFcfa: subtotal,
        deliveryFeeFcfa: 1_000,
        totalFcfa: subtotal + 1_000,
        mode: 'LIVRAISON',
        address: 'Ouando, derrière le marché, portail vert',
        communeId: communeId('Porto-Novo'),
        phone: '0190000070',
        instructions: 'Enfant malade, merci de faire vite',
        payment: 'MOBILE_MONEY',
        paymentStatus: 'PAYE',
        handoverCode: '8142',
        events: [
          { status: 'RECUE', at: iso(t2), by: 'Serge Dossou' },
          { status: 'PAYE', at: iso(t2), by: 'Moov Money', note: 'MM-DEMO4QX9' },
        ],
        createdAt: t2,
        updatedAt: t2,
      },
    });
    await prisma.payment.create({
      data: {
        patientId: twin.id,
        userId: users.serge.id,
        kind: 'COMMANDE',
        ref: `order:${ID.waiting}`,
        label: `Commande ${orderRef(ID.waiting)} · Pharmacie Camp Guézo`,
        amountFcfa: subtotal + 1_000,
        provider: 'MOOV_MONEY',
        phone: '0190000070',
        status: 'REUSSI',
        receipt: 'MM-DEMO4QX9',
        createdAt: t2,
      },
    });
  }
}
