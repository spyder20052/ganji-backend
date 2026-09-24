import { Injectable, NotFoundException } from '@nestjs/common';
import { BloodService } from '../blood/blood.service';
import { OutboxService } from '../common/outbox.service';
import { normalizePhone } from '../auth/auth.dto';
import { PrismaService } from '../prisma/prisma.service';
import { AlertsService } from '../alerts/alerts.service';

function fmt(d: Date) {
  return d.toLocaleString('fr-FR', { timeZone: 'Africa/Porto-Novo', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

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
  ) {}

  async outboxFor(rawPhone: string) {
    const to = normalizePhone(rawPhone);
    return this.prisma.outbox.findMany({ where: { to }, orderBy: { createdAt: 'desc' }, take: 40 });
  }

  async recent() {
    return this.prisma.outbox.findMany({ orderBy: { createdAt: 'desc' }, take: 60 });
  }

  /** Téléphones de démonstration (simulateur) : donneurs sans smartphone, patients, aidants. */
  async demoPhones() {
    const donors = await this.prisma.donor.findMany({
      where: { alerts: { some: {} } },
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
          await this.prisma.reminder.update({ where: { id: reminder.id }, data: { confirmedAt: new Date() } });
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

  private async pendingReminder(phone: string) {
    const user = await this.prisma.user.findUnique({ where: { phone }, include: { patient: true } });
    if (!user?.patient) return null;
    return this.prisma.reminder.findFirst({
      where: { patientId: user.patient.id, sentAt: { not: null }, confirmedAt: null },
      orderBy: { sentAt: 'desc' },
    });
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
   * ou déjà envoyés dans les prochaines 24 h sont reprogrammés à leur prochaine occurrence (même
   * heure), puis envoyés : la démonstration marche le jour du déploiement comme une semaine après.
   */
  async demoTick(horizonHours: number) {
    const now = Date.now();
    const stale = await this.prisma.reminder.findMany({
      where: {
        dueAt: { lte: new Date(now + 24 * 3600_000) },
        patient: { user: { is: { demoPersona: { not: null } } } },
        OR: [{ sentAt: { not: null } }, { dueAt: { lt: new Date(now) } }],
      },
    });
    for (const r of stale) {
      const next = new Date(r.dueAt);
      while (next.getTime() < now + 3600_000) next.setUTCDate(next.getUTCDate() + 1);
      await this.prisma.reminder.update({ where: { id: r.id }, data: { dueAt: next, sentAt: null, confirmedAt: null } });
    }
    return this.tick({ horizonHours: Math.max(horizonHours, 26) });
  }

  /**
   * Tâche planifiée : envoie les rappels des prochaines 24 h (SMS + voix),
   * expire les appels au don anciens, fait vivre les stocks et détecte les regroupements de cas.
   */
  async tick(opts: { horizonHours?: number } = {}) {
    const horizon = new Date(Date.now() + (opts.horizonHours ?? 24) * 3600_000);
    const due = await this.prisma.reminder.findMany({
      where: { sentAt: null, dueAt: { lte: horizon, gte: new Date(Date.now() - 3600_000) } },
      include: { patient: { include: { user: true, delegations: { where: { revokedAt: null }, include: { caregiver: true } } } } },
      take: 200,
    });
    let sent = 0;
    for (const r of due) {
      const recipients = [r.patient.user, ...r.patient.delegations.filter((d) => d.scopes.includes('reminders') || d.scopes.includes('all')).map((d) => d.caregiver)].filter(
        (u): u is NonNullable<typeof u> => Boolean(u?.phone),
      );
      const text = this.reminderText(r.kind, r.dueAt, r.place, r.patient.firstName, r.patient.discreetMode);
      for (const u of recipients) {
        if (r.channels.includes('SMS')) await this.outbox.send({ channel: 'SMS', to: u.phone!, lang: u.lang, body: text, ref: `reminder:${r.id}`, audioKey: `reminder.${r.kind.toLowerCase()}` });
        if (r.channels.includes('VOICE')) await this.outbox.send({ channel: 'VOICE', to: u.phone!, lang: u.lang, body: `Message vocal (${u.lang}) : ${text}`, ref: `reminder:${r.id}`, audioKey: `reminder.${r.kind.toLowerCase()}` });
        if (r.channels.includes('APP')) await this.outbox.send({ channel: 'PUSH', to: u.phone!, lang: u.lang, body: text, ref: `reminder:${r.id}` });
      }
      await this.prisma.reminder.update({ where: { id: r.id }, data: { sentAt: new Date() } });
      sent++;
    }
    const expired = await this.prisma.donorAlert.updateMany({
      where: { status: 'ENVOYEE', createdAt: { lt: new Date(Date.now() - 48 * 3600_000) } },
      data: { status: 'EXPIREE' },
    });
    const clusters = await this.alerts.detectClusters();
    return { remindersSent: sent, donorAlertsExpired: expired.count, clusterAlerts: clusters.created };
  }

  private reminderText(kind: string, dueAt: Date, place: string | null, firstName: string, discreet: boolean) {
    const when = fmt(dueAt);
    // Mode discret (téléphone partagé) : ni prénom, ni nature du soin, ni lieu.
    if (discreet) {
      return kind === 'MEDICATION'
        ? "Ganji : c'est l'heure de votre rappel. Répondez 1 quand c'est fait."
        : `Ganji : vous avez un rendez-vous ${when}. Répondez 1 pour confirmer.`;
    }
    switch (kind) {
      case 'CPN':
        return `Ganji : ${firstName}, votre consultation prénatale est prévue ${when}${place ? ` à ${place}` : ''}. Répondez 1 pour confirmer.`;
      case 'VACCINE':
        return `Ganji : vaccin prévu ${when}${place ? ` à ${place}` : ''} pour votre enfant. Apportez le carnet. Répondez 1 pour confirmer.`;
      case 'MEDICATION':
        return `Ganji : ${firstName}, c'est l'heure de votre traitement. Répondez 1 quand c'est fait.`;
      case 'LAB':
        return `Ganji : ${firstName}, analyse prévue ${when}${place ? ` à ${place}` : ''}. Répondez 1 pour confirmer.`;
      default:
        return `Ganji : ${firstName}, rendez-vous ${when}${place ? ` à ${place}` : ''}. Répondez 1 pour confirmer.`;
    }
  }

  async assertPhoneKnown(phone: string) {
    const u = await this.prisma.user.findUnique({ where: { phone: normalizePhone(phone) } });
    if (!u) throw new NotFoundException();
  }
}
