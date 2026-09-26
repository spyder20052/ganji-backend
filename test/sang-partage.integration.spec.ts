/**
 * Don de sang de bout en bout (devenir donneur, se proposer, banque de sang prévenue, poches réservées)
 * et partage des documents (volet « documents », ordonnances masquées sans leur volet, journal d'accès).
 * Sur la base de démonstration seedée ; chaque test remet la base dans son état initial.
 */
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadDotEnv } from '../src/common/env';

loadDotEnv();

const PERSONAS = ['koffi', 'serge', 'bio', 'rafiatou', 'houngbedji', 'ants', 'rachidatou', 'dr-sans-consentement', 'ministere'] as const;
type Persona = (typeof PERSONAS)[number];
/** PNG 1×1 : ce que le téléphone envoie après compression d'une photo. */
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe.skipIf(!process.env.DATABASE_URL)('M4 et M1 · don de sang et partage des documents', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const agents = {} as Record<Persona, ReturnType<typeof request.agent>>;
  const me = {} as Record<Persona, { id: string; patientId: string | null }>;
  const as = (p: Persona) => agents[p];

  beforeAll(async () => {
    const { createApp } = await import('../src/app.factory');
    app = await createApp();
    await app.init();
    prisma = new PrismaClient();
    for (const p of PERSONAS) {
      agents[p] = request.agent(app.getHttpServer());
      me[p] = (await agents[p].post(`/auth/demo/${p}`).expect(200)).body;
    }
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await app?.close();
  });

  describe('M4 · devenir donneur et se proposer', () => {
    it('refuse l’inscription quand le don n’est pas possible (âge, grossesse, maladie)', async () => {
      expect((await as('bio').put('/blood/donor/me').send({ hasSmartphone: false }).expect(400)).body.message).toMatch(/60 ans/);
      expect((await as('rafiatou').put('/blood/donor/me').send({}).expect(400)).body.message).toMatch(/grossesse/);
      expect((await as('koffi').put('/blood/donor/me').send({}).expect(400)).body.message).toMatch(/proches/);
      const koffi = await as('koffi').get('/blood/donor/me').expect(200);
      expect(koffi.body.prefill.contraindication).toBe('CONDITION');
      await as('houngbedji').get('/blood/donor/me').expect(403);
    });

    it('Serge s’inscrit, voit une demande proche, se propose : le médecin et la banque de sang sont prévenus', async () => {
      await prisma.donor.deleteMany({ where: { userId: me.serge.id } });
      const before = await as('serge').get('/blood/donor/me').expect(200);
      expect(before.body.donor).toBeNull();
      expect(before.body.prefill).toMatchObject({ bloodGroup: 'O+', commune: 'Porto-Novo', sex: 'M' });

      const saved = await as('serge').put('/blood/donor/me').send({ hasSmartphone: true, weightOk: true }).expect(200);
      expect(saved.body.donor).toMatchObject({ bloodGroup: 'O+', city: 'Porto-Novo', available: true, eligible: true, lang: 'fr' });

      // Demande du CNHU (plasma B+, 2 poches, stock suffisant : aucun donneur alerté d'office, Rodrigue reste libre).
      const naf = await prisma.patient.findFirstOrThrow({ where: { firstName: 'Nafissatou', lastName: 'Worou' } });
      const created = await as('houngbedji').post('/blood/requests').send({ patientId: naf.id, product: 'PLASMA', bloodGroup: 'B+', quantity: 2, urgency: 'URGENTE' }).expect(201);
      const id = created.body.id as string;
      try {
        expect(created.body.dispatch.antsNotified).toBeGreaterThan(0);
        const antsBell = await as('ants').get('/me/notifications').expect(200);
        expect((antsBell.body as { href: string }[]).some((n) => n.href === `/ants#demande-${id}`)).toBe(true);

        const nearby = await as('serge').get('/blood/nearby').expect(200);
        const hit = (nearby.body.requests as { id: string }[]).find((r) => r.id === id);
        expect(hit).toMatchObject({ facility: 'CNHU-HKM', bloodGroup: 'B+', urgency: 'URGENTE' });
        expect(JSON.stringify(hit)).not.toContain('Nafissatou');

        const vol = await as('serge').post(`/blood/requests/${id}/volunteer`).expect(200);
        expect(vol.body.status).toBe('ACCEPTEE');
        const view = await as('houngbedji').get(`/blood/requests/${id}`).expect(200);
        expect(view.body.status).toBe('DONNEUR_TROUVE');
        expect(view.body.coverage).toMatchObject({ accepted: 1, missing: 1 });
        expect(view.body.donors[0]).toMatchObject({ firstName: 'Serge', volunteer: true, status: 'ACCEPTEE' });
        const bell = await as('houngbedji').get('/me/notifications').expect(200);
        expect((bell.body as { href: string; title: string }[]).some((n) => n.href === `/pro/sang/${id}` && /Donneur trouvé/.test(n.title))).toBe(true);
        const sms = await request(app.getHttpServer()).get('/sms/outbox?to=0190000010').expect(200);
        expect((sms.body as { ref: string }[]).some((m) => m.ref === `blood-request:${id}`)).toBe(true);

        // La banque de sang complète avec une poche de son stock, remis ensuite à l'identique.
        const stockBefore = await prisma.bloodStock.findMany({ where: { site: { shortName: 'ANTS' }, product: 'PLASMA' } });
        const reserved = await as('ants').post(`/blood/requests/${id}/reserve`).send({ units: 1 }).expect(200);
        expect(reserved.body.coverage).toMatchObject({ reserved: 1, complete: true });
        await as('ants').post(`/blood/requests/${id}/reserve`).send({ units: 1 }).expect(400);
        await as('serge').post(`/blood/requests/${id}/volunteer`).expect(200);
        for (const s of stockBefore) await prisma.bloodStock.update({ where: { id: s.id }, data: { units: s.units } });
      } finally {
        await prisma.notification.deleteMany({ where: { href: { in: [`/ants#demande-${id}`, `/pro/sang/${id}`] } } });
        await prisma.bloodRequest.delete({ where: { id } });
        await prisma.donor.deleteMany({ where: { userId: me.serge.id } });
      }
    });
  });

  describe('M4 · sûreté : réponses en double, réservations concurrentes, clôture, confidentialité', () => {
    it('ne compte qu’une fois un « 1 » renvoyé, ne dépasse pas le besoin, n’inscrit que les dons confirmés', async () => {
      const naf = await prisma.patient.findFirstOrThrow({ where: { firstName: 'Nafissatou', lastName: 'Worou' } });
      const start = new Date();
      // Serge, aidant (volet « sang ») de l'enfant en mode discret, le temps du test.
      await prisma.patient.update({ where: { id: naf.id }, data: { discreetMode: true } });
      const delegation = await prisma.delegation.upsert({
        where: { patientId_caregiverId: { patientId: naf.id, caregiverId: me.serge.id } },
        update: { scopes: ['blood'], revokedAt: null },
        create: { patientId: naf.id, caregiverId: me.serge.id, relation: 'oncle', scopes: ['blood'] },
      });
      // Plaquettes AB− : donneurs O−, A−, B−, AB− (jamais Rodrigue, O+, réservé au parcours héros).
      // Stock maîtrisé : rien à moins de 60 km, sauf 3 poches A− à l'ANTS ; tout est remis à la fin.
      const NEG = ['O-', 'A-', 'B-', 'AB-'];
      const stock = await prisma.bloodStock.findMany({ where: { product: 'PLAQUETTES', bloodGroup: { in: NEG } }, include: { site: true } });
      const southIds = stock.filter((r) => ['ANTS', 'SDTS Atlantique-Littoral', 'SDTS Ouémé-Plateau'].includes(r.site.shortName ?? '')).map((r) => r.id);
      await prisma.bloodStock.updateMany({ where: { id: { in: southIds } }, data: { units: 0 } });
      await prisma.bloodStock.updateMany({ where: { site: { shortName: 'ANTS' }, product: 'PLAQUETTES', bloodGroup: 'A-' }, data: { units: 3 } });
      const created = await as('houngbedji').post('/blood/requests').send({ patientId: naf.id, product: 'PLAQUETTES', bloodGroup: 'AB-', quantity: 10, urgency: 'URGENTE' }).expect(201);
      const id = created.body.id as string;
      try {
        expect(created.body.dispatch.donorsAlerted).toBeGreaterThan(0);
        const first = (created.body.donors as { id: string }[])[0];
        const alert = await prisma.donorAlert.findUniqueOrThrow({ where: { id: first.id }, include: { donor: true } });

        // Le même « 1 » arrive deux fois en même temps : une seule acceptation, un seul SMS de rendez-vous.
        const sms = request(app.getHttpServer());
        await Promise.all([sms.post('/sms/inbound').send({ from: alert.donor.phone, body: '1' }), sms.post('/sms/inbound').send({ from: alert.donor.phone, body: '1' })]);
        expect((await prisma.donorAlert.findUniqueOrThrow({ where: { id: alert.id } })).status).toBe('ACCEPTEE');
        const rdv = await prisma.outbox.count({ where: { to: alert.donor.phone, ref: `blood-request:${id}`, body: { contains: 'Rendez-vous' } } });
        expect(rdv).toBe(1);

        // Famille en mode discret : ni prénom, ni sang, ni hôpital, ni message vocal.
        const family = await prisma.outbox.findMany({ where: { to: '0190000070', ref: `blood-request:${id}` } });
        expect(family.length).toBe(1);
        expect(family[0].channel).toBe('SMS');
        expect(family[0].body).not.toMatch(/Nafissatou|sang|donneur|CNHU/i);

        // Deux réservations simultanées : au plus le besoin restant.
        const both = await Promise.all([1, 2].map(() => as('ants').post(`/blood/requests/${id}/reserve`).send({ units: 3 })));
        expect(both.filter((r) => r.status === 200)).toHaveLength(1);
        expect(both.filter((r) => r.status !== 200).every((r) => r.status === 400 || r.status === 409)).toBe(true);
        expect((await prisma.bloodRequest.findUniqueOrThrow({ where: { id } })).reservedUnits).toBe(3);

        // Contrôle d'accès journalisé ; le ministère ne voit que des demandes anonymes.
        await as('dr-sans-consentement').get(`/blood/requests/${id}`).expect(403);
        expect(await prisma.auditEvent.count({ where: { patientId: naf.id, action: 'DENIED', resource: 'Demande de sang', at: { gte: start } } })).toBeGreaterThan(0);
        const min = await as('ministere').get(`/blood/requests/${id}`).expect(200);
        expect(min.body).toMatchObject({ patient: null, patientId: null, donors: [] });
        const minList = (await as('ministere').get('/blood/requests').expect(200)).body as { patient: string | null }[];
        expect(minList.every((r) => r.patient === null)).toBe(true);

        // Clôture : réservée au prescripteur, à son établissement et à la banque de sang ; une seule fois ;
        // le donneur non coché (absent) n'est pas inscrit ; le stock ne vient que de sites à moins de 60 km.
        await as('dr-sans-consentement').post(`/blood/requests/${id}/served`).send({}).expect(403);
        await as('houngbedji').post(`/blood/requests/${id}/served`).send({ donorAlertIds: ['00000000-0000-4000-8000-000000000000'] }).expect(400);
        const served = await as('houngbedji').post(`/blood/requests/${id}/served`).send({ donorAlertIds: [] }).expect(200);
        expect(served.body.donorsRecorded).toBe(0);
        // 10 − 3 réservées = 7 poches : aucune à moins de 60 km, et rien n'est pris à Parakou ou ailleurs.
        expect(served.body).toMatchObject({ stockUsed: [], stockMissing: 7 });
        expect((await as('houngbedji').post(`/blood/requests/${id}/served`).send({}).expect(200)).body.already).toBe(true);
        expect((await prisma.donor.findUniqueOrThrow({ where: { id: alert.donorId } })).lastDonationAt?.getTime()).toBe(alert.donor.lastDonationAt?.getTime());
        expect(await prisma.encounter.count({ where: { patientId: naf.id, type: 'TRANSFUSION', date: { gte: start } } })).toBe(1);
      } finally {
        for (const r of stock) await prisma.bloodStock.update({ where: { id: r.id }, data: { units: r.units } });
        await prisma.encounter.deleteMany({ where: { patientId: naf.id, type: 'TRANSFUSION', date: { gte: start } } });
        await prisma.notification.deleteMany({ where: { href: { in: [`/ants#demande-${id}`, `/pro/sang/${id}`] } } });
        await prisma.bloodRequest.delete({ where: { id } });
        await prisma.delegation.delete({ where: { id: delegation.id } });
        await prisma.patient.update({ where: { id: naf.id }, data: { discreetMode: false } });
      }
    });
  });

  describe('M1 · partage des documents et des ordonnances', () => {
    it('le document ajouté par Koffi s’ouvre chez la soignante qui a le volet « documents », puis se referme', async () => {
      const koffi = me.koffi.patientId!;
      const doc = await as('koffi').post(`/patients/${koffi}/documents`).send({ title: 'Photo du bilan', kind: 'RESULTAT', mime: 'image/png', dataB64: PNG_1PX }).expect(201);
      const share = await as('koffi').post('/me/share').send({ scopes: ['summary', 'documents'], hours: 1 }).expect(200);
      try {
        await as('rachidatou').get(`/patients/${koffi}/documents`).expect(403);
        await as('rachidatou').post('/share/redeem').send({ token: share.body.shareCode }).expect(200);

        const list = await as('rachidatou').get(`/patients/${koffi}/documents`).expect(200);
        expect((list.body as { id: string }[]).some((d) => d.id === doc.body.id)).toBe(true);
        const file = await as('rachidatou').get(`/patients/${koffi}/documents/${doc.body.id}`).buffer(true).expect(200);
        expect(file.headers['content-type']).toBe('image/png');
        expect(file.headers['content-disposition']).toMatch(/^inline/);
        expect((file.body as Buffer).subarray(1, 4).toString()).toBe('PNG');
        const dl = await as('rachidatou').get(`/patients/${koffi}/documents/${doc.body.id}?download=1`).buffer(true).expect(200);
        expect(dl.headers['content-disposition']).toMatch(/^attachment/);
        const json = await as('rachidatou').get(`/patients/${koffi}/documents/${doc.body.id}`).set('Accept', 'application/json').expect(200);
        expect(json.body.mime).toBe('image/png');

        // Volets non partagés : ordonnances et chronologie restent fermées.
        await as('rachidatou').get(`/patients/${koffi}/prescriptions`).expect(403);
        await as('rachidatou').get(`/patients/${koffi}/timeline`).expect(403);

        const log = (await as('koffi').get('/me/access-log').expect(200)).body as { who: string; action: string; resource: string }[];
        expect(log.some((e) => e.who === 'Rachidatou Salifou' && e.action === 'READ' && e.resource === 'Document « Photo du bilan »')).toBe(true);

        await as('koffi').delete(`/me/consents/${share.body.id}`).expect(200);
        await as('rachidatou').get(`/patients/${koffi}/documents/${doc.body.id}`).expect(403);
        const after = (await as('koffi').get('/me/access-log').expect(200)).body as { who: string; action: string }[];
        expect(after.some((e) => e.who === 'Rachidatou Salifou' && e.action === 'DENIED')).toBe(true);
      } finally {
        await as('koffi').delete(`/me/consents/${share.body.id}`);
        await prisma.documentRef.delete({ where: { id: doc.body.id } });
      }
    });

    it('la chronologie ne montre les ordonnances qu’avec leur volet', async () => {
      const koffi = me.koffi.patientId!;
      const kinds = async (scopes: string[]) => {
        const share = await as('koffi').post('/me/share').send({ scopes, hours: 1 }).expect(200);
        await as('rachidatou').post('/share/redeem').send({ token: share.body.shareCode }).expect(200);
        const tl = await as('rachidatou').get(`/patients/${koffi}/timeline`).expect(200);
        await as('koffi').delete(`/me/consents/${share.body.id}`).expect(200);
        return (tl.body as { kind: string }[]).map((i) => i.kind);
      };
      expect(await kinds(['summary', 'timeline'])).not.toContain('ORDONNANCE');
      expect(await kinds(['summary', 'timeline', 'prescriptions'])).toContain('ORDONNANCE');
    });
  });
});
