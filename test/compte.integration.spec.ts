/**
 * Profil et rendez-vous sur la base seedée (seed-ext profile + appointments) : groupe sanguin vérifié,
 * cycle complet d'une demande de rendez-vous (patient → établissement → rappel → annulation).
 * Ignorés sans DATABASE_URL.
 */
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadDotEnv } from '../src/common/env';

loadDotEnv();

type Agent = ReturnType<typeof request.agent>;
interface Appt { id: string; status: string; specialty: string; facility: { id: string; name: string }; own: boolean }

describe.skipIf(!process.env.DATABASE_URL)('Profil et rendez-vous', () => {
  let app: INestApplication;
  const as: Record<string, Agent> = {};
  let koffiPatientId = '';

  beforeAll(async () => {
    const { createApp } = await import('../src/app.factory');
    app = await createApp();
    await app.init();
    for (const p of ['koffi', 'afiavi', 'houngbedji', 'dr-sans-consentement']) {
      as[p] = request.agent(app.getHttpServer());
      const r = await as[p].post(`/auth/demo/${p}`).expect(200);
      if (p === 'koffi') koffiPatientId = r.body.patientId;
    }
    // Une demande « consultation » restée en attente d'un essai précédent bloquerait la nouvelle.
    const mine = (await as.koffi.get('/me/appointments').expect(200)).body as Appt[];
    for (const a of mine.filter((x) => x.status === 'DEMANDE' && x.specialty === 'GENERALE')) await as.koffi.post(`/me/appointments/${a.id}/cancel`).expect(200);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('la langue se choisit sans être connecté (rien à enregistrer côté compte)', async () => {
    const r = await request(app.getHttpServer()).post('/me/lang').send({ lang: 'fon' }).expect(200);
    expect(r.body).toEqual({ saved: false, lang: 'fon' });
  });

  it("le patient ne remplace pas un groupe vérifié ; un soignant avec accès le vérifie, sans accès il est refusé et journalisé", async () => {
    await as.houngbedji.patch(`/patients/${koffiPatientId}/vitals`).send({ bloodGroup: 'O+' }).expect(200);
    const p = await as.koffi.get('/me/profile').expect(200);
    expect(p.body.patient.bloodGroupSource).toBe('VERIFIE');
    const r = await as.koffi.patch('/me/profile').send({ bloodGroup: 'A+' }).expect(403);
    expect(r.body.code).toBe('BLOOD_GROUP_VERIFIED');
    await as['dr-sans-consentement'].patch(`/patients/${koffiPatientId}/vitals`).send({ bloodGroup: 'A+' }).expect(403);
    const log = await as.koffi.get('/me/access-log').expect(200);
    expect(log.body.some((e: { action: string; resource: string }) => e.action === 'DENIED' && e.resource === 'Groupe sanguin et allergies')).toBe(true);
  });

  it('demande → confirmation par l’établissement → rappel la veille → annulation', async () => {
    const facilities = await as.koffi.get('/appointments/facilities').query({ commune: 'Abomey-Calavi', specialty: 'GENERALE' }).expect(200);
    const cnhu = facilities.body.find((f: { shortName: string }) => f.shortName === 'CNHU-HKM');
    expect(cnhu).toBeTruthy();
    const preferredAt = new Date(Date.now() + 2 * 86_400_000);
    preferredAt.setUTCHours(8, 0, 0, 0);
    const created = await as.koffi.post('/me/appointments').send({ facilityId: cnhu.id, specialty: 'GENERALE', preferredAt: preferredAt.toISOString() }).expect(201);
    const id: string = created.body.id;
    try {
      expect(created.body.status).toBe('DEMANDE');
      const inbox = await as.houngbedji.get('/appointments/requests').expect(200);
      expect(inbox.body.pending.some((a: { id: string }) => a.id === id)).toBe(true);
      const scheduledAt = new Date(Date.now() + 3 * 86_400_000);
      await as['dr-sans-consentement'].post(`/appointments/${id}/confirm`).send({ scheduledAt: scheduledAt.toISOString() }).expect(403);
      await as.houngbedji.post(`/appointments/${id}/confirm`).send({ scheduledAt: scheduledAt.toISOString(), answer: 'Apportez le carnet.' }).expect(200);
      const after = await as.houngbedji.get('/appointments/requests').expect(200);
      expect(after.body.upcoming.find((a: { id: string }) => a.id === id)?.scheduledAt).toBe(scheduledAt.toISOString());

      // L'aidante avec le droit « rendez-vous » le voit aussi.
      const seen = (await as.afiavi.get('/me/appointments').expect(200)).body as Appt[];
      expect(seen.find((a) => a.id === id)?.own).toBe(false);
    } finally {
      // Toujours annulé : la base de démonstration reste propre, même si une vérification échoue.
      const cancelled = await as.koffi.post(`/me/appointments/${id}/cancel`);
      expect(cancelled.body.status).toBe('ANNULE');
    }
    await as.koffi.post(`/me/appointments/${id}/cancel`).expect(400);
  });
});
