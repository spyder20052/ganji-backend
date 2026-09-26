import { Injectable, NotFoundException } from '@nestjs/common';
import type { Lang } from '@prisma/client';
import { BloodService } from '../blood/blood.service';
import { OutboxService } from '../common/outbox.service';
import { defineSms, sms } from '../common/sms';
import { TickRegistry } from '../common/tick.registry';
import { normalizePhone } from '../auth/auth.dto';
import { PrismaService } from '../prisma/prisma.service';
import { AlertsService } from '../alerts/alerts.service';
import { CircleService } from '../circle/circle.service';

/**
 * Fenêtre du bouton de démo : « demain 9 h » peut être à 31 h si l'on appuie à 1 h du matin.
 * 48 h couvrent toujours le prochain rappel des personas, quelle que soit l'heure de la démo.
 */
const DEMO_HORIZON_HOURS = 48;

/** Rappels traités par lot, et temps maximal consacré à l'envoi par passage de la tâche planifiée. */
export const TICK_BATCH = 200;
export const TICK_BUDGET_MS = 20_000;

function fmt(d: Date, lang: Lang = 'fr') {
  return d.toLocaleString(lang === 'en' ? 'en-GB' : 'fr-FR', { timeZone: 'Africa/Porto-Novo', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/**
 * Rappels par SMS, dans la langue de chaque destinataire. La tâche planifiée peut partir plusieurs heures
 * avant : chaque texte donne donc le jour et l'heure (« ven. 26 sept., 13:00 »), jamais « c'est l'heure ».
 * Mode discret (téléphone partagé) : ni prénom, ni nature du soin, ni lieu.
 */
defineSms({
  'rappel.discret.prise': { fr: 'Ganji : rappel {quand}. Répondez 1 quand c’est fait.', en: 'Ganji: reminder {quand}. Reply 1 when done.' },
  'rappel.discret.rdv': { fr: 'Ganji : vous avez un rendez-vous {quand}. Répondez 1 pour confirmer.', en: 'Ganji: you have an appointment {quand}. Reply 1 to confirm.' },
  'rappel.cpn': { fr: 'Ganji : {prenom}, consultation prénatale {quand}{lieu}. Répondez 1 pour confirmer.', en: 'Ganji: {prenom}, antenatal visit {quand}{lieu}. Reply 1 to confirm.' },
  'rappel.vaccin': { fr: 'Ganji : vaccin de votre enfant {quand}{lieu}. Apportez le carnet. Répondez 1 pour confirmer.', en: 'Ganji: your child’s vaccine {quand}{lieu}. Bring the health book. Reply 1 to confirm.' },
  'rappel.prise': { fr: 'Ganji : {prenom}, prise de votre traitement {quand}. Répondez 1 quand c’est fait.', en: 'Ganji: {prenom}, time for your treatment {quand}. Reply 1 when done.' },
  'rappel.analyse': { fr: 'Ganji : {prenom}, analyse {quand}{lieu}. Répondez 1 pour confirmer.', en: 'Ganji: {prenom}, lab test {quand}{lieu}. Reply 1 to confirm.' },
  'rappel.rdv': { fr: 'Ganji : {prenom}, rendez-vous {quand}{lieu}. Répondez 1 pour confirmer.', en: 'Ganji: {prenom}, appointment {quand}{lieu}. Reply 1 to confirm.' },
});

/**
 * Canaux sans smartphone : SMS entrants, menu USSD et tâches planifiées.
 * Toutes les actions passent par les mêmes services métier que l'application.
 */
@Injectable()
export class ChannelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly blood: BloodService,
    private readonly alerts: AlertsService,
    private readonly ticks: TickRegistry,
    private readonly circle: CircleService,
  ) {}

  /**
   * Numéros que le simulateur (public en démo) peut afficher : comptes de démonstration (personas) et
   * donneurs simulés, sans compte. Jamais le numéro d'une vraie inscription : la boîte d'envoi contient
   * des codes (connexion, remise d'une commande) et relierait une personne à ses messages.
   */
  async simulatorPhones(phones: string[]): Promise<Set<string>> {
    const list = [...new Set(phones.filter(Boolean))];
    if (!list.length) return new Set();
    const [users, donors] = await Promise.all([
      this.prisma.user.findMany({ where: { phone: { in: list } }, select: { phone: true, demoPersona: true } }),
      this.prisma.donor.findMany({ where: { phone: { in: list }, userId: null }, select: { phone: true } }),
    ]);
    const real = new Set(users.filter((u) => !u.demoPersona).map((u) => u.phone));
    const ok = new Set<string>();
    for (const u of users) if (u.demoPersona && u.phone) ok.add(u.phone);
    for (const d of donors) if (!real.has(d.phone)) ok.add(d.phone);
    return ok;
  }

  async outboxFor(rawPhone: string) {
    const to = normalizePhone(rawPhone);
    if (!(await this.simulatorPhones([to])).has(to)) return [];
    return this.prisma.outbox.findMany({ where: { to }, orderBy: { createdAt: 'desc' }, take: 40 });
  }

  /** Fil du simulateur : derniers envois vers des numéros de démonstration seulement. */
  async recent() {
    const rows = await this.prisma.outbox.findMany({ orderBy: { createdAt: 'desc' }, take: 300 });
    const ok = await this.simulatorPhones(rows.map((r) => r.to));
    return rows.filter((r) => ok.has(r.to)).slice(0, 60);
  }

  /** Téléphones de démonstration (simulateur) : donneurs sans smartphone, patients, aidants. */
  async demoPhones() {
    const donors = await this.prisma.donor.findMany({
      // Donneurs simulés seulement (sans compte) : jamais le numéro d'une vraie inscription.
      where: { alerts: { some: {} }, userId: null },
      select: { firstName: true, phone: true, bloodGroup: true, hasSmartphone: true, city: true },
      take: 20,
    });
    const users = await this.prisma.user.findMany({
      where: { demoPersona: { not: null }, phone: { not: null } },
      select: { displayName: true, phone: true, role: true, demoPersona: true },
    });
    return {
      personas: users.map((u) => ({ label: u.displayName, phone: u.phone, role: u.role, persona: u.demoPersona })),
      donors: donors.map((d) => ({ label: `${d.firstName} (${d.bloodGroup}, ${d.city})`, phone: d.phone, smartphone: d.hasSmartphone })),
    };
  }

  async inboundSms(rawFrom: string, body: string) {
    const from = normalizePhone(rawFrom);
    const text = body.trim().toUpperCase();
    let handled = 'IGNORE';
    let reply: string | null = null;

    if (/^(1|OUI|YES|2|NON|NO)$/.test(text)) {
      const donor = await this.prisma.donor.findUnique({ where: { phone: from } });
      const alert = donor
        ? await this.prisma.donorAlert.findFirst({ where: { donorId: donor.id, status: 'ENVOYEE' }, orderBy: { createdAt: 'desc' } })
        : null;
      if (alert) {
        const accept = /^(1|OUI|YES)$/.test(text);
        await this.blood.respond(alert.id, accept, 'SMS');
        handled = accept ? 'DON_ACCEPTE' : 'DON_REFUSE';
      } else {
        const reminder = await this.pendingReminder(from);
        if (reminder && /^(1|OUI|YES)$/.test(text)) {
          // Même confirmation que dans l'application : le cercle de soins prévenu apprend que c'est fait.
          await this.circle.markConfirmed(reminder.id, { userId: reminder.byUserId });
          handled = 'RAPPEL_CONFIRME';
          reply = 'Ganji : merci, votre confirmation est bien enregistrée.';
        } else {
          reply = "Ganji : aucune demande en attente pour ce numéro. Tapez RDV pour votre prochain rendez-vous.";
        }
      }
    } else if (text === 'RDV') {
      handled = 'RDV';
      reply = await this.nextAppointmentText(from);
    } else if (text === 'STOP') {
      handled = 'STOP';
      await this.prisma.donor.updateMany({ where: { phone: from }, data: { available: false } });
      reply = 'Ganji : vous ne recevrez plus d’appels au don. Envoyez DON pour vous réinscrire.';
    } else if (text === 'DON') {
      handled = 'DON';
      await this.prisma.donor.updateMany({ where: { phone: from }, data: { available: true } });
      reply = 'Ganji : merci ! Vous êtes de nouveau disponible pour les appels au don.';
    } else {
      reply = 'Ganji : commandes possibles : 1 (oui), 2 (non), RDV, DON, STOP. Pour une urgence, appelez le 118.';
    }
    await this.prisma.inbound.create({ data: { channel: 'SMS', from, body, handled } });
    if (reply) await this.outbox.send({ channel: 'SMS', to: from, body: reply, ref: 'sms-reply' });
    return { handled };
  }

  /** Menu USSD *229*25# (simulé) : réponse texte, session sans état. */
  async ussd(rawFrom: string, input: string) {
    const from = normalizePhone(rawFrom);
    const steps = input.split('*').filter(Boolean);
    const menu = 'CON Ganji\n1. Mon prochain RDV\n2. Répondre à un appel au don\n3. Pharmacie de garde\n4. Urgence';
    if (steps.length === 0) return { text: menu };
    switch (steps[0]) {
      case '1':
        return { text: `END ${await this.nextAppointmentText(from)}` };
      case '2': {
        const donor = await this.prisma.donor.findUnique({ where: { phone: from } });
        const alert = donor ? await this.prisma.donorAlert.findFirst({ where: { donorId: donor.id, status: 'ENVOYEE' }, include: { request: { include: { facility: true } } } }) : null;
        if (!alert) return { text: 'END Aucun appel au don en attente.' };
        if (steps.length === 1) return { text: `CON Don de sang à ${alert.request.facility.shortName ?? alert.request.facility.name}\n1. Oui, je viens\n2. Non, pas cette fois` };
        const r = await this.blood.respond(alert.id, steps[1] === '1', 'USSD');
        return { text: r.status === 'ACCEPTEE' && 'appointment' in r && r.appointment ? `END Merci ! RDV ${fmt(r.appointment)}.` : 'END Merci pour votre réponse.' };
      }
      case '3': {
        const pharmacies = await this.prisma.facility.findMany({ where: { type: 'PHARMACIE', onDuty: true }, take: 3, include: { commune: true } });
        return { text: `END Pharmacies de garde :\n${pharmacies.map((p) => `- ${p.name} (${p.commune.name})`).join('\n')}` };
      }
      case '4':
        return { text: 'END Urgence : appelez le 118 (pompiers). Allez à l’hôpital le plus proche. Montrez votre carte QR Ganji.' };
      default:
        return { text: menu };
    }
  }

  /** Rappel en attente pour ce numéro : le sien, ou celui d'une personne accompagnée (l'aidant reçoit aussi les rappels). */
  private async pendingReminder(phone: string) {
    const user = await this.prisma.user.findUnique({
      where: { phone },
      include: { patient: true, delegationsGiven: { where: { revokedAt: null }, select: { patientId: true, scopes: true } } },
    });
    if (!user) return null;
    const patientIds = [
      ...(user.patient ? [user.patient.id] : []),
      ...user.delegationsGiven.filter((d) => d.scopes.includes('reminders') || d.scopes.includes('all')).map((d) => d.patientId),
    ];
    if (!patientIds.length) return null;
    const where = { patientId: { in: patientIds }, sentAt: { not: null }, confirmedAt: null };
    // D'abord le rappel dont l'heure est venue (celui que le cercle relance), sinon le dernier envoyé.
    const r =
      (await this.prisma.reminder.findFirst({ where: { ...where, dueAt: { lte: new Date(Date.now() + 2 * 3600_000) } }, orderBy: { dueAt: 'desc' } })) ??
      (await this.prisma.reminder.findFirst({ where, orderBy: { sentAt: 'desc' } }));
    return r ? { id: r.id, byUserId: user.id } : null;
  }

  private async nextAppointmentText(phone: string) {
    const user = await this.prisma.user.findUnique({ where: { phone }, include: { patient: true } });
    if (!user?.patient) return 'Ganji : aucun carnet lié à ce numéro.';
    const next = await this.prisma.reminder.findFirst({
      where: { patientId: user.patient.id, dueAt: { gte: new Date() }, kind: { in: ['APPOINTMENT', 'CPN', 'VACCINE', 'LAB'] } },
      orderBy: { dueAt: 'asc' },
    });
    return next ? `Ganji : prochain rendez-vous ${fmt(next.dueAt)}${next.place ? ` à ${next.place}` : ''}.` : 'Ganji : aucun rendez-vous prévu.';
  }

  /**
   * Bouton de démo : les rappels des personas sont datés au moment du seed. Ceux qui sont passés
   * ou déjà envoyés dans les prochaines 48 h sont reprogrammés à leur prochaine occurrence (même
   * heure), puis envoyés : la démonstration marche le jour du déploiement comme une semaine après.
   */
  async demoTick(horizonHours: number) {
    const now = Date.now();
    const stale = await this.prisma.reminder.findMany({
      where: {
        dueAt: { lte: new Date(now + DEMO_HORIZON_HOURS * 3600_000) },
        patient: { user: { is: { demoPersona: { not: null } } } },
        // Rappel déjà relancé par le cercle de soins (aidants, relais) : on garde son histoire.
        escalation: 0,
        // Prises d'un plan de l'assistant : datées depuis la création du plan, avec leur journal
        // d'observance ; les reprogrammer créerait des doublons et effacerait l'historique.
        prescriptionId: null,
        OR: [{ sentAt: { not: null } }, { dueAt: { lt: new Date(now) } }],
      },
    });
    for (const r of stale) {
      const next = new Date(r.dueAt);
      while (next.getTime() < now + 3600_000) next.setUTCDate(next.getUTCDate() + 1);
      await this.prisma.reminder.update({ where: { id: r.id }, data: { dueAt: next, sentAt: null, confirmedAt: null } });
    }
    return this.tick({ horizonHours: Math.max(horizonHours, DEMO_HORIZON_HOURS) });
  }

  /**
   * Tâche planifiée : envoie les rappels des prochaines 24 h (SMS + voix),
   * expire les appels au don anciens, fait vivre les stocks et détecte les regroupements de cas.
   */
  async tick(opts: { horizonHours?: number } = {}) {
    const horizon = new Date(Date.now() + (opts.horizonHours ?? 24) * 3600_000);
    const started = Date.now();
    let sent = 0;
    // Par lots de 200 jusqu'à épuisement (plans de prises, campagnes de vaccination…), borné dans le temps :
    // une fonction serverless ne doit pas dépasser son délai ; le reste part au passage suivant.
    for (;;) {
      if (Date.now() - started > TICK_BUDGET_MS) break;
      const due = await this.prisma.reminder.findMany({
        where: { sentAt: null, dueAt: { lte: horizon, gte: new Date(Date.now() - 3600_000) } },
        include: { patient: { include: { user: true, delegations: { where: { revokedAt: null }, include: { caregiver: true } } } } },
        orderBy: { dueAt: 'asc' },
        take: TICK_BATCH,
      });
      if (due.length === 0) break;
      for (const r of due) {
        if (Date.now() - started > TICK_BUDGET_MS) break;
        const recipients = [r.patient.user, ...r.patient.delegations.filter((d) => d.scopes.includes('reminders') || d.scopes.includes('all')).map((d) => d.caregiver)].filter(
          (u): u is NonNullable<typeof u> => Boolean(u?.phone),
        );
        for (const u of recipients) {
          const text = this.reminderText(r.kind, r.dueAt, r.place, r.patient.firstName, r.patient.discreetMode, u.lang);
          if (r.channels.includes('SMS')) await this.outbox.send({ channel: 'SMS', to: u.phone!, lang: u.lang, body: text, ref: `reminder:${r.id}`, audioKey: `reminder.${r.kind.toLowerCase()}` });
          if (r.channels.includes('VOICE')) await this.outbox.send({ channel: 'VOICE', to: u.phone!, lang: u.lang, body: `Message vocal (${u.lang}) : ${text}`, ref: `reminder:${r.id}`, audioKey: `reminder.${r.kind.toLowerCase()}` });
          if (r.channels.includes('APP')) await this.outbox.send({ channel: 'PUSH', to: u.phone!, lang: u.lang, body: text, ref: `reminder:${r.id}` });
        }
        await this.prisma.reminder.update({ where: { id: r.id }, data: { sentAt: new Date() } });
        sent++;
      }
      if (due.length < TICK_BATCH) break;
    }
    const expired = await this.prisma.donorAlert.updateMany({
      where: { status: 'ENVOYEE', createdAt: { lt: new Date(Date.now() - 48 * 3600_000) } },
      data: { status: 'EXPIREE' },
    });
    const clusters = await this.alerts.detectClusters();
    // Tâches des autres modules (rendez-vous, relances du cercle de soins, commandes…).
    const modules = await this.ticks.runAll();
    return { remindersSent: sent, donorAlertsExpired: expired.count, clusterAlerts: clusters.created, ...modules };
  }

  private reminderText(kind: string, dueAt: Date, place: string | null, firstName: string, discreet: boolean, lang: Lang) {
    const vars = { quand: fmt(dueAt, lang), prenom: firstName, lieu: place ? ` · ${place}` : '' };
    if (discreet) return sms(kind === 'MEDICATION' ? 'rappel.discret.prise' : 'rappel.discret.rdv', lang, vars);
    const key = { CPN: 'rappel.cpn', VACCINE: 'rappel.vaccin', MEDICATION: 'rappel.prise', LAB: 'rappel.analyse' }[kind] ?? 'rappel.rdv';
    return sms(key, lang, vars);
  }

  async assertPhoneKnown(phone: string) {
    const u = await this.prisma.user.findUnique({ where: { phone: normalizePhone(phone) } });
    if (!u) throw new NotFoundException();
  }
}
