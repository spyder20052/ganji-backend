import { VISIT_REASON } from '../../src/circle/circle.service';
import { nextVisitDue } from '../../src/circle/escalation';
import { sms } from '../../src/common/sms';
import type { SeedCtx } from './context';

/** Identifiants fixes : le seed se rejoue sans doublon. */
const ID = {
  // Ancien rappel « confirmé » (retiré : le bouton de démo reprogramme les rappels passés non relancés) : effacé au rejeu.
  legacyDone: 'c1c10000-0000-4000-8000-000000000001',
  koffiYesterday: 'c1c10000-0000-4000-8000-000000000002', // hier : sans réponse → Afiavi, puis visite du relais
  koffiToday: 'c1c10000-0000-4000-8000-000000000003', // il y a 3 h : sans réponse → Afiavi prévenue
  djougou: 'c1c10000-0000-4000-8000-000000000004', // Djougou : rendez-vous sans réponse, pas de téléphone
  visitKoffi: 'c1c1a000-0000-4000-8000-000000000001',
  visitDjougou: 'c1c1a000-0000-4000-8000-000000000002',
};
const REMINDERS = [ID.legacyDone, ID.koffiYesterday, ID.koffiToday, ID.djougou];
const VISITS = [ID.visitKoffi, ID.visitDjougou];
const HOUR = 3_600_000;

/**
 * Cercle de soins :
 * - Koffi : prise d'hier restée sans réponse (Afiavi prévenue à 2 h, visite du
 *   relais demandée à 6 h, encore à faire) ; prise d'il y a 3 h sans réponse (Afiavi prévenue il y a 1 h) ;
 * - Djougou : une patiente sans téléphone dont le rendez-vous est resté sans réponse → visite de Mathieu.
 * Koffi habite Abomey-Calavi, où aucun relais n'est encore inscrit : comme pour les secours de proximité,
 * le premier relais inscrit (Mathieu) est sollicité (voir CircleService.relaysFor).
 */
export async function seedCircle(ctx: SeedCtx) {
  const { prisma, users, communeId } = ctx;
  const koffi = users.koffi && (await prisma.patient.findUnique({ where: { userId: users.koffi.id }, select: { id: true, communeId: true } }));
  const mathieu = users.mathieu && (await prisma.user.findUnique({ where: { id: users.mathieu.id }, select: { id: true, displayName: true, phone: true } }));
  if (!koffi || !mathieu) return;
  const afiavi = users.afiavi && (await prisma.user.findUnique({ where: { id: users.afiavi.id }, select: { id: true, phone: true, lang: true } }));
  const relayName = mathieu.displayName.replace(/\s*\([^)]*\)\s*$/, '');

  // Rejouable : nos rappels, visites, notifications du cercle et SMS, puis on recrée.
  await prisma.relayVisit.deleteMany({ where: { OR: [{ id: { in: VISITS } }, { patientId: koffi.id }] } });
  await prisma.reminder.deleteMany({ where: { id: { in: REMINDERS } } });
  const people = [users.koffi?.id, users.afiavi?.id, mathieu.id].filter((x): x is string => Boolean(x));
  await prisma.notification.deleteMany({ where: { kind: 'CERCLE', userId: { in: people } } });
  await prisma.outbox.deleteMany({ where: { ref: { in: [...REMINDERS.map((r) => `circle:${r}:1`), ...VISITS.map((v) => `relay-visit:${v}`), ...VISITS.map((v) => `relay-visit:${v}:done`)] } } });
  // Afiavi reçoit les rappels de Koffi (réglage du cercle remis à l'état initial).
  if (afiavi) {
    const d = await prisma.delegation.findUnique({ where: { patientId_caregiverId: { patientId: koffi.id, caregiverId: afiavi.id } } });
    if (d && !d.scopes.includes('reminders')) await prisma.delegation.update({ where: { id: d.id }, data: { scopes: [...d.scopes, 'reminders'] } });
  }

  const now = Date.now();
  const ago = (h: number) => new Date(now - h * HOUR);
  const title = 'Prise du traitement';
  await prisma.reminder.createMany({
    data: [
      { id: ID.koffiYesterday, patientId: koffi.id, kind: 'MEDICATION', title, dueAt: ago(27), sentAt: ago(27), channels: ['APP', 'SMS'], escalation: 2 },
      { id: ID.koffiToday, patientId: koffi.id, kind: 'MEDICATION', title, dueAt: ago(3), sentAt: ago(3), channels: ['APP', 'SMS'], escalation: 1 },
    ],
  });

  const missedHref = (reminderId: string) => `/app/cercle?p=${koffi.id}&r=${reminderId}`;
  const notif = (userId: string, key: string, bodyKey: string, vars: Record<string, string>, href: string, createdAt: Date, read = false) => ({
    userId,
    kind: 'CERCLE',
    title: sms(key, 'fr', vars),
    body: sms(bodyKey, 'fr', vars),
    href,
    createdAt,
    readAt: read ? createdAt : null,
  });
  const notifications = [];
  const outbox = [];
  for (const [rid, h, read] of [[ID.koffiYesterday, 25, true], [ID.koffiToday, 1, false]] as const) {
    if (afiavi) {
      // Afiavi parle fon : ses textes retombent sur le français tant que la traduction n'est pas validée.
      notifications.push(notif(afiavi.id, 'circle.n.missed.title', 'circle.n.missed.body', { name: 'Koffi' }, missedHref(rid), ago(h), read));
      if (afiavi.phone) outbox.push({ channel: 'SMS', to: afiavi.phone, lang: afiavi.lang, body: sms('circle.sms.missed', afiavi.lang, { name: 'Koffi' }), ref: `circle:${rid}:1`, status: 'SENT', createdAt: ago(h), sentAt: ago(h) });
    }
    if (users.koffi) notifications.push(notif(users.koffi.id, 'circle.n.missed.title', 'circle.n.self.body', {}, '/app/cercle', ago(h), read));
  }

  // Visite du relais pour Koffi : demandée 6 h après la prise d'hier, pour le lendemain 10 h.
  const visitAsked = ago(21);
  await prisma.relayVisit.create({
    data: {
      id: ID.visitKoffi,
      patientId: koffi.id,
      communeId: koffi.communeId,
      relayId: mathieu.id,
      relayName,
      reason: VISIT_REASON,
      reminderId: ID.koffiYesterday,
      dueAt: nextVisitDue(visitAsked),
      createdAt: visitAsked,
    },
  });
  notifications.push(notif(mathieu.id, 'circle.n.visit.title', 'circle.n.visit.body', { name: 'Koffi', commune: 'Abomey-Calavi' }, '/relais#visites', visitAsked));
  if (mathieu.phone) outbox.push({ channel: 'SMS', to: mathieu.phone, lang: 'fr' as const, body: sms('circle.sms.visit', 'fr'), ref: `relay-visit:${ID.visitKoffi}`, status: 'SENT', createdAt: visitAsked, sentAt: visitAsked });
  if (users.koffi) notifications.push(notif(users.koffi.id, 'circle.n.visitPlanned.title', 'circle.n.visitPlanned.body', { relay: relayName }, '/app/cercle', visitAsked, true));

  // Djougou (commune de Mathieu) : patiente sans téléphone, le relais est son seul lien.
  const djougou = await prisma.patient.findFirst({
    where: { communeId: communeId('Djougou'), userId: null, parentId: null, birthDate: { lt: new Date(now - 18 * 365 * 24 * HOUR) } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, firstName: true, address: true },
  });
  if (djougou) {
    if (!djougou.address) await prisma.patient.update({ where: { id: djougou.id }, data: { address: 'Kolokondé, maison près du forage' } });
    await prisma.reminder.create({
      data: { id: ID.djougou, patientId: djougou.id, kind: 'APPOINTMENT', title: 'Consultation de suivi', place: 'CSC Djougou', dueAt: ago(9), sentAt: ago(9), channels: ['SMS'], escalation: 2 },
    });
    const asked = ago(3);
    await prisma.relayVisit.create({
      data: {
        id: ID.visitDjougou,
        patientId: djougou.id,
        communeId: communeId('Djougou'),
        relayId: mathieu.id,
        relayName,
        reason: VISIT_REASON,
        reminderId: ID.djougou,
        dueAt: nextVisitDue(asked),
        createdAt: asked,
      },
    });
    notifications.push(notif(mathieu.id, 'circle.n.visit.title', 'circle.n.visit.body', { name: djougou.firstName, commune: 'Djougou' }, '/relais#visites', asked));
  }

  await prisma.notification.createMany({ data: notifications });
  if (outbox.length) await prisma.outbox.createMany({ data: outbox });
}
