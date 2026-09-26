/**
 * Commandes de médicaments sur la base seedée (ignorés sans DATABASE_URL) : force brute du code de remise
 * en parallèle, nouveau code, échec de livraison (stock rendu, remboursement, ordonnance à nouveau
 * commandable), volets de délégation, validation du livreur. Les commandes créées ici sont supprimées à la fin.
 */
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadDotEnv } from '../src/common/env';

loadDotEnv();

type Persona = 'koffi' | 'afiavi' | 'pharmacie-cotonou';

describe.skipIf(!process.env.DATABASE_URL)('Commandes : remise, échec, délégations', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const agents = {} as Record<Persona, ReturnType<typeof request.agent>>;
  const created: string[] = [];
  let pharmacyId = '';
  let paracetamol = '';
  let koffiPatient = '';
  let afiaviScopes: string[] | null = null;
  let delegationId = '';

  const as = (p: Persona) => agents[p];
  const stock = async (medicationId: string) =>
    (await prisma.pharmacyStock.findUnique({ where: { pharmacyId_medicationId: { pharmacyId, medicationId } } }))?.quantity ?? 0;
  const order = async (body: Record<string, unknown>) => {
    const r = await as('koffi')
      .post('/me/orders')
      .send({ pharmacyId, phone: '0190000001', ...body })
      .expect(201);
    created.push(r.body.id);
    return r.body as { id: string; handoverCode: string };
  };
  const pharma = (id: string, action: string, body?: object) => as('pharmacie-cotonou').post(`/pharmacy/orders/${id}/${action}`).send(body ?? {});

  beforeAll(async () => {
    const { createApp } = await import('../src/app.factory');
    app = await createApp();
    await app.init();
    for (const p of ['koffi', 'afiavi', 'pharmacie-cotonou'] as Persona[]) {
      agents[p] = request.agent(app.getHttpServer());
      await agents[p].post(`/auth/demo/${p}`).expect(200);
    }
    pharmacyId = (await prisma.facility.findFirstOrThrow({ where: { name: 'Pharmacie Camp Guézo' } })).id;
    paracetamol = (await prisma.medication.findFirstOrThrow({ where: { dci: 'Paracétamol', form: 'comprimé' } })).id;
    await prisma.pharmacyStock.upsert({
      where: { pharmacyId_medicationId: { pharmacyId, medicationId: paracetamol } },
      update: { quantity: { increment: 20 } },
      create: { pharmacyId, medicationId: paracetamol, quantity: 20, priceFcfa: 200 },
    });
    const koffi = await prisma.user.findUniqueOrThrow({ where: { demoPersona: 'koffi' }, include: { patient: true } });
    koffiPatient = koffi.patient!.id;
    const afiavi = await prisma.user.findUniqueOrThrow({ where: { demoPersona: 'afiavi' } });
    const d = await prisma.delegation.findFirst({ where: { patientId: koffiPatient, caregiverId: afiavi.id, revokedAt: null } });
    if (d) {
      delegationId = d.id;
      afiaviScopes = d.scopes;
    }
  }, 60_000);

  afterAll(async () => {
    if (delegationId && afiaviScopes) await prisma.delegation.update({ where: { id: delegationId }, data: { scopes: afiaviScopes } });
    await prisma.payment.deleteMany({ where: { kind: 'COMMANDE', ref: { in: created.map((id) => `order:${id}`) } } });
    await prisma.order.deleteMany({ where: { id: { in: created } } });
    await prisma.$disconnect();
    await app?.close();
  });

  it('codes faux envoyés en parallèle : jamais plus de 5 essais, puis nouveau code envoyé au patient seulement', async () => {
    const o = await order({ items: [{ medicationId: paracetamol, quantity: 1 }], mode: 'RETRAIT', payment: 'ESPECES' });
    await pharma(o.id, 'accept').expect(200);
    await pharma(o.id, 'ready').expect(200);
    const wrong = o.handoverCode === '0000' ? '1111' : '0000';
    const results = await Promise.all(Array.from({ length: 9 }, () => pharma(o.id, 'deliver', { code: wrong })));
    expect(results.filter((r) => r.status === 400)).toHaveLength(5);
    expect(results.filter((r) => r.status === 403)).toHaveLength(4);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).codeAttempts).toBe(5);
    // Bloquée : même le bon code est refusé.
    await pharma(o.id, 'deliver', { code: o.handoverCode }).expect(403);

    const since = new Date();
    const view = await pharma(o.id, 'new-code').expect(200);
    expect(view.body.codeAttemptsLeft).toBe(5);
    expect(JSON.stringify(view.body)).not.toContain('handoverCode');
    const fresh = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(fresh.handoverCode).not.toBe(o.handoverCode);
    const sent = await prisma.outbox.findMany({ where: { ref: `order:${o.id}`, createdAt: { gte: since } } });
    expect(sent.map((m) => m.to)).toEqual(['0190000001']); // pas d'aidant sans volet « commandes »
    expect(sent[0].body).toContain(fresh.handoverCode);

    await pharma(o.id, 'deliver', { code: fresh.handoverCode }).expect(200);
    const done = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(done.status).toBe('RETIREE');
    expect(done.codeAttempts).toBe(0);
  });

  it('échec de livraison : stock rendu, mobile money remboursé, ordonnance de nouveau commandable', async () => {
    const rx = await prisma.prescription.findFirst({ where: { patientId: koffiPatient, status: 'ACTIVE', expiresAt: { gt: new Date() } } });
    if (!rx) return; // ordonnance déjà utilisée par une démo en cours
    const items = rx.items as { medicationId: string; quantity: number }[];
    const before = await Promise.all(items.map((i) => stock(i.medicationId)));
    const o = await order({ prescriptionId: rx.id, mode: 'LIVRAISON', address: 'Godomey, maison bleue', payment: 'MOBILE_MONEY', operator: 'MTN' });
    await pharma(o.id, 'accept').expect(200);
    expect(await Promise.all(items.map((i) => stock(i.medicationId)))).toEqual(before.map((q, n) => q - items[n].quantity));
    await pharma(o.id, 'ready').expect(200);
    await pharma(o.id, 'dispatch', { courierName: 'Mathias', courierPhone: '0197112233' }).expect(200);
    await pharma(o.id, 'fail', { reason: 'Patient absent' }).expect(200);

    const failed = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(failed.status).toBe('ECHEC');
    expect(failed.paymentStatus).toBe('REMBOURSE');
    expect((await prisma.payment.findFirstOrThrow({ where: { ref: `order:${o.id}` } })).status).toBe('REMBOURSE');
    expect(await Promise.all(items.map((i) => stock(i.medicationId)))).toEqual(before);
    expect((await prisma.prescription.findUniqueOrThrow({ where: { id: rx.id } })).status).toBe('ACTIVE');
    const again = await as('koffi').get(`/me/orders/options?rx=${rx.id}`).expect(200);
    expect(again.body.activeOrderId).toBeNull();
    const mine = await as('koffi').get(`/me/orders/${o.id}`).expect(200);
    expect(mine.body.status).toBe('ECHEC');
    expect(mine.body.refusalReason).toBe('Patient absent');
  });

  it('délégation sans le volet « commandes » : ni commande ni lecture ; avec le volet : commande et suivi', async () => {
    if (!delegationId) return;
    await prisma.delegation.update({ where: { id: delegationId }, data: { scopes: ['summary', 'blood'] } });
    const o = await order({ items: [{ medicationId: paracetamol, quantity: 1 }], mode: 'RETRAIT', payment: 'ESPECES' });
    await as('afiavi')
      .post('/me/orders')
      .send({ patientId: koffiPatient, pharmacyId, items: [{ medicationId: paracetamol, quantity: 1 }], mode: 'RETRAIT', phone: '0190000002', payment: 'ESPECES' })
      .expect(403);
    await as('afiavi').get(`/me/orders/${o.id}`).expect(404);
    expect((await as('afiavi').get('/me/orders').expect(200)).body.some((x: { id: string }) => x.id === o.id)).toBe(false);

    await prisma.delegation.update({ where: { id: delegationId }, data: { scopes: ['summary', 'orders'] } });
    const r = await as('afiavi')
      .post('/me/orders')
      .send({ patientId: koffiPatient, pharmacyId, items: [{ medicationId: paracetamol, quantity: 1 }], mode: 'RETRAIT', phone: '0190000002', payment: 'ESPECES' })
      .expect(201);
    created.push(r.body.id);
    await as('afiavi').get(`/me/orders/${o.id}`).expect(200);
    // Ordonnance : le volet « commandes » seul ne suffit pas.
    const rx = await prisma.prescription.findFirst({ where: { patientId: koffiPatient, status: 'ACTIVE' } });
    if (rx) await as('afiavi').get(`/me/orders/options?rx=${rx.id}&patientId=${koffiPatient}`).expect(403);

    // Délégation révoquée : plus rien, même sur la commande qu'elle a passée.
    await prisma.delegation.update({ where: { id: delegationId }, data: { scopes: ['summary', 'blood'] } });
    await as('afiavi').get(`/me/orders/${r.body.id}`).expect(404);
    await as('afiavi').post(`/me/orders/${r.body.id}/cancel`).expect(404);
  });

  it('refuse un nom ou un numéro de livreur qui n’est pas un nom ou un numéro', async () => {
    const o = await order({ items: [{ medicationId: paracetamol, quantity: 1 }], mode: 'LIVRAISON', address: 'Godomey', payment: 'ESPECES' });
    await pharma(o.id, 'accept').expect(200);
    await pharma(o.id, 'ready').expect(200);
    await pharma(o.id, 'dispatch', { courierName: 'Payez sur http://x.bj', courierPhone: '0197112233' }).expect(400);
    await pharma(o.id, 'dispatch', { courierName: 'Mathias', courierPhone: '+229 01 97' }).expect(400);
    await pharma(o.id, 'dispatch', { courierName: 'Mathias', courierPhone: '01 97 11 22 33' }).expect(200);
  });

  it('inscrit au journal du patient, une seule fois, la lecture de la commande par l’officine', async () => {
    const o = await order({ items: [{ medicationId: paracetamol, quantity: 1 }], mode: 'RETRAIT', payment: 'ESPECES' });
    await as('pharmacie-cotonou').get('/pharmacy/orders').expect(200);
    await as('pharmacie-cotonou').get('/pharmacy/orders').expect(200);
    const ref = `C-${o.id.replace(/-/g, '').slice(0, 5).toUpperCase()}`;
    const reads = await prisma.auditEvent.count({ where: { patientId: koffiPatient, action: 'READ', resource: `Commande ${ref}` } });
    expect(reads).toBe(1);
  });
});
