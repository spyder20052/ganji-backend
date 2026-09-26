/**
 * Tests d'intégration de l'API sur une vraie base PostgreSQL seedée (`npm run db:setup`).
 * Chaque bloc rejoue un critère d'acceptation du cahier des charges ou une attaque d'autorisation
 * (IDOR, consentement, rôle, ordonnance falsifiée ou déjà servie). Ignorés sans DATABASE_URL.
 */
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadDotEnv } from '../src/common/env';

loadDotEnv();

const PERSONAS = [
  'koffi',
  'afiavi',
  'bio',
  'houngbedji',
  'dr-sans-consentement',
  'rachidatou',
  'pharmacie-cotonou',
  'pharmacie-parakou',
  'ministere',
  'mathieu',
  'rafiatou',
] as const;
type Persona = (typeof PERSONAS)[number];

/** Numéros de démonstration fixés par le seed (l'API ne renvoie que des numéros masqués). */
const PHONE = { afiavi: '0190000002', rafiatou: '0190000060', rodrigue: '0196000000' };

interface Me {
  id: string;
  patientId: string | null;
}
interface LogEntry {
  who: string;
  action: string;
  allowed: boolean;
  reason: string | null;
}

describe.skipIf(!process.env.DATABASE_URL)('API Ganji sur base seedée', () => {
  let app: INestApplication;
  const agents = {} as Record<Persona, ReturnType<typeof request.agent>>;
  const me = {} as Record<Persona, Me>;
  const as = (p: Persona) => agents[p];
  let publicApi: ReturnType<typeof request>;

  beforeAll(async () => {
    const { createApp } = await import('../src/app.factory');
    app = await createApp();
    await app.init();
    publicApi = request(app.getHttpServer());
    for (const p of PERSONAS) {
      agents[p] = request.agent(app.getHttpServer());
      const r = await agents[p].post(`/auth/demo/${p}`).expect(200);
      me[p] = r.body as Me;
    }
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  const koffi = () => me.koffi.patientId!;

  describe('M1 · consentement et journal d’accès', () => {
    it('refuse un soignant sans consentement et inscrit la tentative au journal du patient', async () => {
      const r = await as('dr-sans-consentement').get(`/patients/${koffi()}/summary`).expect(403);
      expect(r.body.code).toBe('CONSENT_REQUIRED');
      const log = await as('koffi').get('/me/access-log').expect(200);
      const entries = log.body as LogEntry[];
      expect(entries.some((e) => !e.allowed && e.who.includes('Dansou'))).toBe(true);
    });

    it('bloque l’accès d’un patient au dossier d’un autre (IDOR)', async () => {
      await as('koffi').get(`/patients/${me.bio.patientId}/summary`).expect(403);
      await as('koffi').get(`/patients/${me.bio.patientId}/timeline`).expect(403);
      await as('koffi').get(`/patients/${me.bio.patientId}/documents`).expect(403);
    });

    it('refuse toute lecture sans session', async () => {
      await publicApi.get(`/patients/${koffi()}/summary`).expect(401);
      await publicApi.get('/me/access-log').expect(401);
    });

    it('ouvre le dossier par code de partage, puis le referme quand le patient retire l’accès', async () => {
      const share = await as('koffi').post('/me/share').send({ scopes: ['summary', 'timeline'], hours: 24 }).expect(200);
      const redeem = await as('dr-sans-consentement').post('/share/redeem').send({ token: share.body.shareCode }).expect(200);
      expect(redeem.body.patientId).toBe(koffi());
      await as('dr-sans-consentement').get(`/patients/${koffi()}/summary`).expect(200);
      await as('koffi').delete(`/me/consents/${share.body.id}`).expect(200);
      await as('dr-sans-consentement').get(`/patients/${koffi()}/summary`).expect(403);
    });

    it('laisse l’aidante déléguée lire la fiche vitale de Koffi', async () => {
      const r = await as('afiavi').get(`/patients/${koffi()}/summary`).expect(200);
      expect(r.body.bloodGroup).toBe('O+');
    });

    it('ne montre pas le compartiment très sensible à l’équipe de soins par défaut', async () => {
      const r = await as('houngbedji').get(`/patients/${koffi()}/summary`).expect(200);
      const labels = (r.body.conditions as { label: string | null }[]).map((c) => c.label ?? '');
      expect(labels.some((l) => /psycholog/i.test(l))).toBe(false);
      expect(labels.some((l) => /Leucémie/.test(l))).toBe(true);
    });
  });

  describe('M7 · urgence', () => {
    it('la carte QR publique ne donne que l’essentiel vital, sans maladie', async () => {
      const summary = await as('koffi').get('/me/summary').expect(200);
      const card = await publicApi.get(`/emergency/card/${summary.body.qrToken}`).expect(200);
      expect(card.body.bloodGroup).toBe('O+');
      expect(JSON.stringify(card.body)).not.toMatch(/Leucémie|psycholog/i);
    });

    it('exige un motif précis pour le bris de glace, puis ouvre le dossier et prévient le contrôleur', async () => {
      await as('dr-sans-consentement').post('/emergency/break-glass').send({ patientId: me.bio.patientId, reason: 'urgence' }).expect(400);
      await as('dr-sans-consentement')
        .post('/emergency/break-glass')
        .send({ patientId: me.bio.patientId, reason: 'Patient inconscient aux urgences, besoin du groupe sanguin et des traitements.' })
        .expect(200);
      const r = await as('dr-sans-consentement').get(`/patients/${me.bio.patientId}/summary`).expect(200);
      expect(r.body.access.via).toBe('BREAK_GLASS');
      const outbox = await publicApi.get('/sms/outbox').expect(200);
      expect((outbox.body as { ref: string; body: string }[]).some((m) => m.ref?.startsWith('break-glass') && /Contrôle/.test(m.body))).toBe(true);
    });
  });

  describe('M4 · parcours héros : plaquettes pour Koffi', () => {
    it('stock insuffisant → donneurs alertés → « 1 » par SMS → donneur trouvé → transfusion au carnet', async () => {
      const created = await as('houngbedji')
        .post('/blood/requests')
        .send({ patientId: koffi(), product: 'PLAQUETTES', quantity: 2, urgency: 'URGENTE' })
        .expect(201);
      expect(created.body.stockCheck.nearbyUnits).toBeLessThan(2);
      expect(created.body.autoAlerted).toBeGreaterThan(0);

      await publicApi.post('/sms/inbound').send({ from: PHONE.rodrigue, body: '1' }).expect(200);
      const after = await as('houngbedji').get(`/blood/requests/${created.body.id}`).expect(200);
      expect(after.body.status).toBe('DONNEUR_TROUVE');
      const rodrigueAlert = (after.body.donors as { id: string; firstName: string; status: string }[]).find((d) => d.firstName === 'Rodrigue' && d.status === 'ACCEPTEE');
      expect(rodrigueAlert).toBeTruthy();

      // La famille est prévenue dans sa langue, sans rien qui révèle le soin (ni sang, ni donneur, ni hôpital).
      const family = (await publicApi.get(`/sms/outbox?to=${PHONE.afiavi}`).expect(200)).body as { channel: string; lang: string; body: string; ref: string }[];
      const news = family.filter((m) => m.ref === `blood-request:${created.body.id}`);
      expect(news.some((m) => m.channel === 'VOICE' && m.lang === 'fon')).toBe(true);
      expect(news.length).toBeGreaterThan(0);
      for (const m of news) expect(m.body).not.toMatch(/sang|donneur|CNHU|transfusion/i);

      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();
      const platelets = await prisma.bloodStock.findMany({ where: { product: 'PLAQUETTES', bloodGroup: { in: ['O+', 'O-'] } } });
      await as('houngbedji').post(`/blood/requests/${created.body.id}/served`).send({ donorAlertIds: [rodrigueAlert!.id] }).expect(200);
      const timeline = await as('koffi').get(`/patients/${koffi()}/timeline`).expect(200);
      expect(JSON.stringify(timeline.body)).toContain('Transfusion de 2 poches de plaquettes');

      // La transfusion inscrit le don de Rodrigue et puise le reste dans le stock : Rodrigue et le stock
      // sont remis dans leur état de démonstration pour le parcours suivant.
      for (const s of platelets) await prisma.bloodStock.update({ where: { id: s.id }, data: { units: s.units } });
      const rodrigue = await prisma.donor.findUniqueOrThrow({ where: { phone: PHONE.rodrigue } });
      expect(Date.now() - (rodrigue.lastDonationAt?.getTime() ?? 0)).toBeLessThan(120_000);
      await prisma.donor.update({ where: { phone: PHONE.rodrigue }, data: { lastDonationAt: new Date(Date.now() - 140 * 86_400_000), donations: { decrement: 1 } } });
      await prisma.$disconnect();
    });

    it('un patient ne peut pas créer de demande de sang', async () => {
      await as('koffi').post('/blood/requests').send({ patientId: koffi(), product: 'CGR', quantity: 1, urgency: 'URGENTE' }).expect(403);
    });
  });

  describe('M5 · ordonnance signée à usage unique', () => {
    it('délivre une fois, refuse la 2e pharmacie et rejette une signature modifiée', async () => {
      const found = await publicApi.get('/medications/search?q=imatinib').expect(200);
      const med = (found.body as { id: string }[])[0];
      const rx = await as('houngbedji')
        .post('/prescriptions')
        .send({ patientId: koffi(), items: [{ medicationId: med.id, dosage: '1 comprimé par jour', duration: '30 jours', quantity: 1 }] })
        .expect(201);
      const payload: string = rx.body.qrPayload;

      await as('pharmacie-cotonou').post('/prescriptions/dispense').send({ payload }).expect(200);
      const second = await as('pharmacie-parakou').post('/prescriptions/dispense').send({ payload });
      expect(second.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(second.body)).toMatch(/déjà délivrée/i);

      const forged = `${payload.slice(0, -4)}AAAA`;
      const bad = await as('pharmacie-parakou').post('/prescriptions/verify').send({ payload: forged }).expect(400);
      expect(bad.body.message).toMatch(/non authentique/);
    });

    it('seul un pharmacien peut délivrer', async () => {
      await as('koffi').post('/prescriptions/dispense').send({ payload: 'ganji:rx:00000000-0000-4000-8000-000000000000.x' }).expect(403);
    });
  });

  describe('M11 · orientation sans compte', () => {
    it('enfant de moins de 5 ans avec convulsions → urgence et lieu ouvert le plus proche', async () => {
      const r = await publicApi.post('/triage').send({ answers: [0, 0], lat: 6.4969, lng: 2.6289 }).expect(200);
      expect(r.body.outcome).toBe('URGENCE');
      expect(r.body.places.length).toBeGreaterThan(0);
      expect(r.body.places[0].distanceKm).toBeLessThan(10);
    });

    it('ne laisse pas le client imposer un résultat', async () => {
      const r = await publicApi.post('/triage').send({ answers: [99] }).expect(200);
      expect(r.body.complete).toBe(false);
    });
  });

  describe('M13 · signalements communautaires', () => {
    it('3 signalements dans une commune alertent le médecin chef de zone, pas le grand public', async () => {
      for (let i = 0; i < 3; i++) {
        await as('mathieu').post('/community-reports').send({ syndrome: 'TOUX', cases: 2, commune: 'Lokossa', village: `Village ${i}` }).expect(201);
      }
      const ministry = await as('ministere').get('/alerts?commune=Lokossa').expect(200);
      const publicList = await publicApi.get('/alerts?commune=Lokossa').expect(200);
      const titles = (list: { title: string }[]) => list.map((a) => a.title.toLowerCase());
      expect(titles(ministry.body).some((t) => t.startsWith('regroupement de cas') && t.includes('lokossa'))).toBe(true);
      expect(titles(publicList.body).some((t) => t.startsWith('regroupement de cas'))).toBe(false);
    });

    it('un patient ne peut pas publier d’alerte officielle', async () => {
      await as('koffi').post('/alerts').send({ kind: 'EPIDEMIE', severity: 'INFO', title: 'Fausse alerte', message: 'Message de test sans valeur.' }).expect(403);
    });
  });

  describe('M10 · rappels par SMS et par voix', () => {
    it('le rappel de consultation prénatale part en SMS et en message vocal bariba', async () => {
      await publicApi.post('/jobs/tick').send({}).expect(200);
      const r = await publicApi.get(`/sms/outbox?to=${PHONE.rafiatou}`).expect(200);
      const cpn = (r.body as { channel: string; lang: string; audioKey: string }[]).filter((m) => m.audioKey === 'reminder.cpn');
      expect(cpn.some((m) => m.channel === 'SMS')).toBe(true);
      expect(cpn.some((m) => m.channel === 'VOICE' && m.lang === 'bariba')).toBe(true);
    });

    it('la tâche planifiée refuse un appel sans secret', async () => {
      await publicApi.get('/jobs/tick').expect(401);
    });
  });

  describe('M6 · télé-expertise', () => {
    it('une question de Djougou reçoit une réponse inscrite au carnet', async () => {
      const patients = await as('rachidatou').get('/patients').expect(200);
      const patientId = (patients.body as { id: string }[])[0].id;
      const t = await as('rachidatou')
        .post('/tele-expertise')
        .send({ patientId, specialty: 'HEMATOLOGIE', urgency: 'NORMALE', question: 'Hb à 6,5 g/dL malgré le traitement : transfusion sur place ou transfert ?' })
        .expect(201);
      await as('pharmacie-cotonou').post(`/tele-expertise/${t.body.id}/answer`).send({ answer: 'Réponse sans qualité pour répondre.' }).expect(403);
      await as('houngbedji').post(`/tele-expertise/${t.body.id}/answer`).send({ answer: 'Transfusion sur place possible, transfert si fièvre ou détresse respiratoire.' }).expect(200);
      const timeline = await as('rachidatou').get(`/patients/${patientId}/timeline`).expect(200);
      expect(JSON.stringify(timeline.body)).toContain('Avis en hématologie');
    });
  });

  describe('M9 · pilotage national', () => {
    it('agrège sans jamais montrer une cellule de moins de 10 personnes', async () => {
      const r = await as('ministere').get('/dashboard/national').expect(200);
      const rows = r.body.departments as { patientsFollowed: number | string }[];
      expect(rows).toHaveLength(12);
      for (const row of rows) {
        if (typeof row.patientsFollowed === 'number') expect(row.patientsFollowed).toBeGreaterThanOrEqual(10);
        else expect(row.patientsFollowed).toBe('<10');
      }
    });

    it('est réservé au ministère', async () => {
      await as('koffi').get('/dashboard/national').expect(403);
      await as('houngbedji').get('/dashboard/national').expect(403);
    });
  });

  it('publie la documentation OpenAPI', async () => {
    const r = await publicApi.get('/docs/openapi.json').expect(200);
    expect(r.body.info.title).toBe('API Ganji');
  });
});
