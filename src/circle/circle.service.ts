import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import type { Reminder } from '@prisma/client';
import { AccessService } from '../common/access.service';
import { AuditService } from '../common/audit.service';
import type { AuthUser } from '../common/auth-user';
import { NotificationsService } from '../common/notifications.service';
import { note, sms } from '../common/i18n';
import { TickRegistry } from '../common/tick.registry';
import { PrismaService } from '../prisma/prisma.service';
import type { CircleSettingsDto } from './circle.dto';
import {
  beninDay,
  CAREGIVERS_AFTER_HOURS,
  canConfirm,
  ESCALATED_KINDS,
  escalationLevel,
  MAX_AGE_HOURS,
  nextVisitDue,
  RELAY_AFTER_HOURS,
  reminderState,
  waitingSince,
} from './escalation';

const HOUR = 3_600_000;
/** Motif d'une visite du relais : jamais de détail médical (phrase française = clé, traduite à l'affichage). */
export const VISIT_REASON = 'Rappel resté sans réponse : passer prendre des nouvelles.';
/** Relais prévenus au plus, quand la commune n'en a pas (même repli que les secours de proximité). */
const MAX_RELAYS = 3;

/** « Mathieu Gounou (relais) » → « Mathieu Gounou ». */
function shortName(displayName: string) {
  return displayName.replace(/\s*\([^)]*\)\s*$/, '').trim();
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Lien de la notification « rappel sans réponse » : il sert aussi à retrouver qui a été prévenu. */
const missedHref = (patientId: string, reminderId: string) => `/app/cercle?p=${patientId}&r=${reminderId}`;
const receivesReminders = (scopes: string[]) => scopes.includes('reminders') || scopes.includes('all');

type Channel = 'APP' | 'SMS';

/** Intitulé sans détail médical (ni médicament ni spécialité), pour un aidant qui n'a que le droit « rappels ». */
const GENERIC_TITLE: Record<string, string> = {
  MEDICATION: 'Prise de traitement',
  APPOINTMENT: 'Rendez-vous de soins',
  LAB: 'Analyse',
  CPN: 'Consultation prénatale',
  VACCINE: 'Vaccin',
  DONATION: 'Don de sang',
};
export const genericTitle = (kind: string) => GENERIC_TITLE[kind] ?? 'Rappel';

/**
 * Cercle de soins : aidants, relais communautaire et équipe de soins autour d'un patient.
 * Quand un rappel reste sans réponse, le cercle prend le relais (voir escalation.ts) ;
 * chacun est prévenu dans sa langue, les SMS restent neutres.
 */
@Injectable()
export class CircleService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly ticks: TickRegistry,
  ) {}

  onModuleInit() {
    this.ticks.register('cercle', () => this.tick());
  }

  // ─── Qui est dans le cercle ──────────────────────────────────────

  /**
   * Relais de la commune du patient. Simplification assumée (comme les secours de proximité) : un relais
   * est rattaché à sa commune par son propre carnet (Patient.communeId) ; si la commune n'en a pas encore,
   * les premiers relais inscrits sont sollicités. En production : table d'affectation relais ↔ villages.
   */
  async relaysFor(communeId: string | null) {
    const select = { id: true, displayName: true, phone: true, patient: { select: { commune: { select: { name: true } } } } } as const;
    let rows = communeId ? await this.prisma.user.findMany({ where: { role: 'RELAY', patient: { is: { communeId } } }, select, orderBy: { createdAt: 'asc' }, take: MAX_RELAYS }) : [];
    const local = rows.length > 0;
    if (!local) rows = await this.prisma.user.findMany({ where: { role: 'RELAY' }, select, orderBy: { createdAt: 'asc' }, take: MAX_RELAYS });
    return rows.map((u) => ({ id: u.id, name: shortName(u.displayName), hasPhone: Boolean(u.phone), commune: u.patient?.commune?.name ?? null, local }));
  }

  private async relayCommune(userId: string) {
    const p = await this.prisma.patient.findUnique({ where: { userId }, select: { communeId: true } });
    return p?.communeId ?? null;
  }

  /** Patient concerné : le sien, ou pour un aidant celui qu'il accompagne (droit « rappels » requis). */
  private async resolve(user: AuthUser, patientId?: string) {
    if (patientId && !UUID.test(patientId)) throw new BadRequestException('Identifiant invalide');
    let pid = patientId;
    if (!pid) {
      if (user.role === 'CAREGIVER') {
        const d = await this.prisma.delegation.findFirst({ where: { caregiverId: user.id, revokedAt: null }, orderBy: { createdAt: 'asc' }, select: { patientId: true } });
        pid = d?.patientId ?? user.patientId ?? undefined;
      } else {
        pid = user.patientId ?? undefined;
      }
    }
    if (!pid) throw new ForbiddenException('Aucun carnet associé');
    const owner = pid === user.patientId;
    let details = true;
    if (!owner) {
      const decision = await this.access.assert(user, pid, 'reminders', 'Cercle de soins');
      // Un aidant qui n'a que le droit « rappels » ne voit ni le nom des médicaments ni le lieu des soins.
      if (decision.via === 'DELEGATION') {
        const d = await this.prisma.delegation.findFirst({ where: { patientId: pid, caregiverId: user.id, revokedAt: null }, select: { scopes: true } });
        details = Boolean(d && (d.scopes.includes('prescriptions') || d.scopes.includes('all')));
      }
    }
    return { pid, owner, details };
  }

  async circle(user: AuthUser, patientId?: string) {
    const { pid, owner, details } = await this.resolve(user, patientId);
    const now = new Date();
    const patient = await this.prisma.patient.findUniqueOrThrow({
      where: { id: pid },
      select: { id: true, firstName: true, communeId: true, commune: { select: { name: true } }, user: { select: { phone: true } } },
    });
    const [delegations, relays, team] = await Promise.all([
      this.prisma.delegation.findMany({
        where: { patientId: pid, revokedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { id: true, relation: true, scopes: true, caregiver: { select: { id: true, displayName: true, phone: true } } },
      }),
      this.relaysFor(patient.communeId),
      this.prisma.careTeamMember.findMany({
        where: { patientId: pid },
        select: { id: true, role: true, practitioner: { select: { user: { select: { displayName: true } }, facility: { select: { shortName: true, name: true } } } } },
      }),
    ]);
    const channels = (phone: unknown): Channel[] => (phone ? ['APP', 'SMS'] : ['APP']);
    const members = [
      ...delegations.map((d) => ({
        type: 'CAREGIVER' as const,
        id: d.id,
        name: d.caregiver.displayName,
        relation: d.relation,
        escalations: receivesReminders(d.scopes),
        // « all » vaut tous les droits, rappels compris : le réglage se fait alors dans « Aidants ».
        fullAccess: d.scopes.includes('all'),
        channels: channels(d.caregiver.phone),
      })),
      ...relays.map((r) => ({ type: 'RELAY' as const, id: r.id, name: r.name, local: r.local, channels: channels(r.hasPhone) })),
      ...team.map((m) => ({
        type: 'CARE_TEAM' as const,
        id: m.id,
        name: m.practitioner.user.displayName,
        role: m.role,
        facility: m.practitioner.facility?.shortName ?? m.practitioner.facility?.name ?? null,
        channels: ['APP'] as Channel[],
      })),
    ];

    const day = beninDay(now);
    const reminders = await this.prisma.reminder.findMany({
      where: {
        patientId: pid,
        OR: [
          { dueAt: { gte: day.start, lt: day.end } },
          // Rappel d'hier soir resté sans réponse : il reste à confirmer (et s'affiche « fait » une fois confirmé aujourd'hui).
          { sentAt: { not: null }, dueAt: { gte: new Date(now.getTime() - 24 * HOUR), lt: day.start }, OR: [{ confirmedAt: null }, { confirmedAt: { gte: day.start } }] },
        ],
      },
      orderBy: { dueAt: 'asc' },
      take: 20,
    });
    const today = reminders.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: details ? r.title : genericTitle(r.kind),
      place: details ? r.place : null,
      dueAt: r.dueAt,
      confirmedAt: r.confirmedAt,
      escalation: r.escalation,
      state: reminderState(r, now),
      canConfirm: canConfirm(r, now),
    }));

    return {
      patient: { id: patient.id, firstName: patient.firstName, commune: patient.commune?.name ?? null },
      viewer: owner ? ('OWNER' as const) : ('CAREGIVER' as const),
      canEdit: owner,
      patientChannels: channels(patient.user?.phone),
      rules: { caregiversAfterHours: CAREGIVERS_AFTER_HOURS, relayAfterHours: RELAY_AFTER_HOURS },
      members,
      today,
      events: await this.events(pid, now, details),
    };
  }

  /** Ce qui s'est passé sur 14 jours : rappels confirmés ou manqués, qui a été prévenu, visites du relais. */
  private async events(pid: string, now: Date, details: boolean) {
    const since = new Date(now.getTime() - 14 * 24 * HOUR);
    const [reminders, visits] = await Promise.all([
      this.prisma.reminder.findMany({
        where: { patientId: pid, OR: [{ confirmedAt: { gte: since } }, { escalation: { gt: 0 }, dueAt: { gte: since } }] },
        orderBy: { dueAt: 'desc' },
        take: 30,
      }),
      this.prisma.relayVisit.findMany({ where: { patientId: pid, OR: [{ createdAt: { gte: since } }, { doneAt: { gte: since } }] }, orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);
    const missed = reminders.filter((r) => r.escalation > 0);
    const notices = missed.length
      ? await this.prisma.notification.findMany({
          where: { kind: 'CERCLE', href: { in: missed.map((r) => missedHref(pid, r.id)) } },
          select: { href: true, createdAt: true, user: { select: { displayName: true, phone: true } } },
          orderBy: { createdAt: 'asc' },
        })
      : [];

    type Event = { id: string; type: string; at: Date; title?: string; kind?: string; people?: { name: string; channels: Channel[] }[]; relayName?: string | null; dueAt?: Date; note?: string | null };
    const events: Event[] = [];
    for (const r of reminders) {
      if (r.escalation > 0) {
        const mine = notices.filter((n) => n.href === missedHref(pid, r.id));
        const at = mine[0]?.createdAt ?? new Date((waitingSince(r) ?? r.dueAt).getTime() + CAREGIVERS_AFTER_HOURS * HOUR);
        events.push({
          id: `missed-${r.id}`,
          type: 'MISSED',
          at,
          title: details ? r.title : genericTitle(r.kind),
          kind: r.kind,
          people: mine.map((n) => ({ name: n.user.displayName, channels: n.user.phone ? ['APP', 'SMS'] : ['APP'] })),
        });
      }
      if (r.confirmedAt && r.confirmedAt >= since) events.push({ id: `done-${r.id}`, type: 'CONFIRMED', at: r.confirmedAt, title: details ? r.title : genericTitle(r.kind), kind: r.kind });
    }
    for (const v of visits) {
      events.push({ id: `visit-${v.id}`, type: 'VISIT_PLANNED', at: v.createdAt, relayName: v.relayName, dueAt: v.dueAt });
      if (v.status === 'FAITE' && v.doneAt) events.push({ id: `visit-done-${v.id}`, type: 'VISIT_DONE', at: v.doneAt, relayName: v.relayName, note: v.note });
      if (v.status === 'ANNULEE') events.push({ id: `visit-off-${v.id}`, type: 'VISIT_CANCELLED', at: v.doneAt ?? v.createdAt, relayName: v.relayName });
    }
    return events.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 30);
  }

  /** Le patient choisit quels aidants reçoivent les rappels et sont prévenus (droit « reminders » de la délégation). */
  async updateSettings(user: AuthUser, dto: CircleSettingsDto) {
    if (!user.patientId) throw new ForbiddenException('Réservé au titulaire du carnet');
    const d = await this.prisma.delegation.findUnique({ where: { id: dto.delegationId }, include: { caregiver: { select: { displayName: true } } } });
    if (!d || d.patientId !== user.patientId || d.revokedAt) throw new NotFoundException('Aidant introuvable');
    // On n'ajoute ou ne retire que « reminders », sans toucher aux autres droits. « all » vaut tous les droits,
    // rappels compris : il reste tel quel (le retirer se fait dans « Aidants », droit par droit).
    if (d.scopes.includes('all')) {
      if (!dto.escalations) throw new BadRequestException('Cet aidant a tous les droits, rappels compris : modifiez ses droits dans « Aidants ».');
      return this.circle(user);
    }
    const scopes = dto.escalations ? [...new Set([...d.scopes, 'reminders'])] : d.scopes.filter((x) => x !== 'reminders');
    await this.prisma.delegation.update({ where: { id: d.id }, data: { scopes } });
    await this.audit.log({
      actor: user,
      patientId: user.patientId,
      action: dto.escalations ? 'CONSENT_GRANT' : 'CONSENT_REVOKE',
      resource: `Cercle de soins : ${d.caregiver.displayName} ${dto.escalations ? 'reçoit' : 'ne reçoit plus'} les rappels`,
    });
    return this.circle(user);
  }

  // ─── Confirmation d'un rappel (application, SMS « 1 », plan de soins) ───

  /**
   * « C'est fait » (application, plan de soins) : le patient, son parent ou un aidant qui a le droit « rappels »,
   * à partir de 2 h avant l'heure prévue. Écriture journalisée dans le carnet du patient.
   */
  async confirm(user: AuthUser, reminderId: string) {
    if (user.role !== 'PATIENT' && user.role !== 'CAREGIVER') throw new ForbiddenException('Réservé au patient et à ses aidants');
    const r = await this.prisma.reminder.findUnique({ where: { id: reminderId }, select: { id: true, patientId: true, kind: true, dueAt: true, sentAt: true, confirmedAt: true } });
    if (!r) throw new NotFoundException('Rappel introuvable');
    if (r.patientId !== user.patientId) await this.access.assert(user, r.patientId, 'reminders', 'Confirmation d’un rappel');
    if (r.confirmedAt) return { id: r.id, confirmedAt: r.confirmedAt, state: 'FAIT' as const };
    if (!canConfirm(r, new Date())) throw new BadRequestException('Trop tôt : un rappel se confirme à partir de 2 h avant son heure.');
    const done = await this.markConfirmed(reminderId, { userId: user.id });
    await this.audit.log({ actor: user, patientId: r.patientId, action: 'WRITE', resource: 'Rappel confirmé (« C’est fait »)' });
    return { id: done.id, confirmedAt: done.confirmedAt, state: 'FAIT' as const };
  }

  /**
   * Point unique de confirmation (application, réponse « 1 » par SMS, plan de soins) : pose confirmedAt une
   * seule fois ; si le cercle avait été prévenu, les aidants alertés apprennent que c'est fait et la visite
   * du relais encore à faire est annulée.
   */
  async markConfirmed(reminderId: string, by: { userId?: string } = {}): Promise<Reminder> {
    const r = await this.prisma.reminder.findUnique({ where: { id: reminderId }, include: { patient: { select: { firstName: true } } } });
    if (!r) throw new NotFoundException('Rappel introuvable');
    if (r.confirmedAt) return r;
    const claim = await this.prisma.reminder.updateMany({ where: { id: r.id, confirmedAt: null }, data: { confirmedAt: new Date() } });
    const updated = await this.prisma.reminder.findUniqueOrThrow({ where: { id: r.id } });
    if (claim.count === 0 || r.escalation < 1) return updated;

    const alerted = await this.prisma.notification.findMany({ where: { kind: 'CERCLE', href: missedHref(r.patientId, r.id) }, select: { userId: true } });
    await this.notifications.notify(
      alerted.map((n) => n.userId).filter((id) => id !== by.userId),
      { kind: 'CERCLE', text: note('circle.n.done.title', 'circle.n.done.body', { name: r.patient.firstName }), href: `/app/cercle?p=${r.patientId}` },
    );
    await this.cancelPendingVisits([r.id], 'confirmed');
    return updated;
  }

  /**
   * Visites du relais encore à faire pour ces rappels : annulées, relais prévenus. Appelé quand le rappel
   * est confirmé, quand la personne a répondu sans confirmer (report, oubli signalé dans l'assistant) ou
   * quand le rappel disparaît (plan de prises remplacé) : jamais de visite rattachée à un rappel supprimé.
   */
  async cancelPendingVisits(reminderIds: string[], why: 'confirmed' | 'answered' = 'answered'): Promise<number> {
    if (!reminderIds.length) return 0;
    const visits = await this.prisma.relayVisit.findMany({
      where: { reminderId: { in: reminderIds }, status: 'A_FAIRE' },
      include: { patient: { select: { firstName: true } } },
    });
    for (const v of visits) {
      const claim = await this.prisma.relayVisit.updateMany({ where: { id: v.id, status: 'A_FAIRE' }, data: { status: 'ANNULEE', doneAt: new Date() } });
      if (claim.count === 0) continue;
      const relays = v.relayId ? [v.relayId] : (await this.relaysFor(v.communeId)).map((x) => x.id);
      await this.notifications.notify(relays, {
        kind: 'CERCLE',
        text: note('circle.n.visitCancelled.title', why === 'confirmed' ? 'circle.n.visitCancelled.body' : 'circle.n.visitCancelled.answered', { name: v.patient.firstName }),
        href: '/relais#visites',
      });
    }
    return visits.length;
  }

  // ─── Relances (tâche planifiée) ──────────────────────────────────

  async tick(now = new Date()) {
    // Rappel reprogrammé (report, bouton de démo) : il repart de zéro.
    const reset = await this.prisma.reminder.updateMany({ where: { sentAt: null, escalation: { gt: 0 } }, data: { escalation: 0 } });
    const candidates = await this.prisma.reminder.findMany({
      where: {
        kind: { in: ESCALATED_KINDS },
        sentAt: { not: null },
        confirmedAt: null,
        escalation: { lt: 2 },
        dueAt: { gte: new Date(now.getTime() - MAX_AGE_HOURS * HOUR), lte: new Date(now.getTime() - CAREGIVERS_AFTER_HOURS * HOUR) },
      },
      include: { patient: { select: { id: true, firstName: true, discreetMode: true, communeId: true, userId: true, commune: { select: { name: true } } } } },
      take: 200,
    });
    let caregivers = 0;
    let visits = 0;
    for (const r of candidates) {
      const level = escalationLevel(r, now);
      if (level <= r.escalation) continue;
      // Réservation optimiste : deux tâches simultanées ne préviennent pas deux fois.
      const claim = await this.prisma.reminder.updateMany({ where: { id: r.id, escalation: r.escalation, confirmedAt: null }, data: { escalation: level } });
      if (claim.count === 0) continue;
      if (r.escalation < 1) {
        await this.alertCaregivers(r);
        caregivers++;
      }
      if (level >= 2 && (await this.requestVisit(r, now))) visits++;
    }
    return { cercleAidantsPrevenus: caregivers, cercleVisitesDemandees: visits, cercleRemisAZero: reset.count };
  }

  private async alertCaregivers(r: Reminder & { patient: { id: string; firstName: string; discreetMode: boolean; userId: string | null } }) {
    const delegations = await this.prisma.delegation.findMany({ where: { patientId: r.patientId, revokedAt: null }, select: { caregiverId: true, scopes: true } });
    const ids = delegations.filter((d) => receivesReminders(d.scopes)).map((d) => d.caregiverId);
    const vars = { name: r.patient.firstName };
    await this.notifications.notify(ids, {
      kind: 'CERCLE',
      text: note('circle.n.missed.title', 'circle.n.missed.body', vars),
      href: missedHref(r.patientId, r.id),
      sms: (lang) => sms(r.patient.discreetMode ? 'circle.sms.missed.discreet' : 'circle.sms.missed', lang, vars),
      ref: `circle:${r.id}:1`,
    });
    // Le patient aussi, dans l'application : il sait que son cercle est prévenu.
    if (r.patient.userId) {
      await this.notifications.notify(r.patient.userId, { kind: 'CERCLE', text: note('circle.n.missed.title', 'circle.n.self.body'), href: '/app/cercle' });
    }
    return ids.length;
  }

  /** Visite du relais pour le lendemain 10 h (une seule visite en attente par patient). */
  private async requestVisit(r: Reminder & { patient: { id: string; firstName: string; communeId: string | null; userId: string | null; commune: { name: string } | null } }, now: Date) {
    const pending = await this.prisma.relayVisit.findFirst({ where: { patientId: r.patientId, status: 'A_FAIRE' } });
    if (pending) return false;
    const relays = await this.relaysFor(r.patient.communeId);
    const first = relays[0];
    const visit = await this.prisma.relayVisit.create({
      data: { patientId: r.patientId, communeId: r.patient.communeId, relayId: first?.id ?? null, relayName: first?.name ?? null, reason: VISIT_REASON, reminderId: r.id, dueAt: nextVisitDue(now) },
    });
    await this.notifications.notify(
      relays.map((x) => x.id),
      {
        kind: 'CERCLE',
        text: note('circle.n.visit.title', 'circle.n.visit.body', { name: r.patient.firstName, commune: r.patient.commune?.name ?? '' }),
        href: '/relais#visites',
        sms: (lang) => sms('circle.sms.visit', lang),
        ref: `relay-visit:${visit.id}`,
      },
    );
    if (r.patient.userId && first) {
      await this.notifications.notify(r.patient.userId, {
        kind: 'CERCLE',
        text: note('circle.n.visitPlanned.title', 'circle.n.visitPlanned.body', { relay: first.name }),
        href: '/app/cercle',
      });
    }
    return true;
  }

  // ─── Relais : visites à faire ────────────────────────────────────

  private async relayScope(user: AuthUser) {
    const communeId = await this.relayCommune(user.id);
    return { OR: [{ relayId: user.id }, ...(communeId ? [{ communeId }] : [])] };
  }

  private visitView(v: {
    id: string;
    reason: string;
    dueAt: Date;
    status: string;
    doneAt: Date | null;
    note: string | null;
    relayName: string | null;
    patient: { firstName: string; address: string | null; commune: { name: string } | null };
  }) {
    return {
      id: v.id,
      firstName: v.patient.firstName,
      commune: v.patient.commune?.name ?? null,
      address: v.patient.address,
      reason: v.reason,
      dueAt: v.dueAt,
      status: v.status,
      doneAt: v.doneAt,
      note: v.note,
      relayName: v.relayName,
    };
  }

  /** Visites du relais : prénom, quartier et motif seulement (aucun détail médical). */
  async relayVisits(user: AuthUser) {
    const scope = await this.relayScope(user);
    const include = { patient: { select: { firstName: true, address: true, commune: { select: { name: true } } } } } as const;
    const [todo, done] = await Promise.all([
      this.prisma.relayVisit.findMany({ where: { ...scope, status: 'A_FAIRE' }, orderBy: { dueAt: 'asc' }, include, take: 50 }),
      this.prisma.relayVisit.findMany({ where: { ...scope, status: 'FAITE', doneAt: { gte: new Date(Date.now() - 7 * 24 * HOUR) } }, orderBy: { doneAt: 'desc' }, include, take: 5 }),
    ]);
    return { todo: todo.map((v) => this.visitView(v)), done: done.map((v) => this.visitView(v)) };
  }

  async visitDone(user: AuthUser, id: string, relayNote?: string) {
    const v = await this.prisma.relayVisit.findUnique({ where: { id }, include: { patient: { select: { id: true, firstName: true, discreetMode: true, userId: true } } } });
    if (!v) throw new NotFoundException('Visite introuvable');
    const communeId = await this.relayCommune(user.id);
    if (v.relayId !== user.id && !(communeId && v.communeId === communeId)) throw new ForbiddenException('Cette visite ne vous est pas confiée');
    if (v.status !== 'A_FAIRE') throw new BadRequestException(v.status === 'FAITE' ? 'Visite déjà faite' : 'Visite annulée');
    const relay = shortName(user.name);
    const updated = await this.prisma.relayVisit.update({
      where: { id },
      data: { status: 'FAITE', doneAt: new Date(), note: relayNote?.trim() || null, relayId: user.id, relayName: relay },
      include: { patient: { select: { firstName: true, address: true, commune: { select: { name: true } } } } },
    });
    await this.audit.log({ actor: user, patientId: v.patientId, action: 'WRITE', resource: 'Visite du relais communautaire (cercle de soins)' });

    if (v.patient.userId) {
      await this.notifications.notify(v.patient.userId, {
        kind: 'CERCLE',
        text: note('circle.n.visitDone.title', 'circle.n.visitDone.body', { relay }),
        href: '/app/cercle',
      });
    }
    const delegations = await this.prisma.delegation.findMany({ where: { patientId: v.patientId, revokedAt: null }, select: { caregiverId: true, scopes: true } });
    await this.notifications.notify(
      delegations.filter((d) => receivesReminders(d.scopes)).map((d) => d.caregiverId),
      {
        kind: 'CERCLE',
        text: note('circle.n.visitDone.title', 'circle.n.visitDoneCg.body', { relay, name: v.patient.firstName }),
        href: `/app/cercle?p=${v.patientId}`,
        sms: (lang) => sms(v.patient.discreetMode ? 'circle.sms.visitDone.discreet' : 'circle.sms.visitDone', lang, { name: v.patient.firstName }),
        ref: `relay-visit:${v.id}:done`,
      },
    );
    return this.visitView(updated);
  }
}
