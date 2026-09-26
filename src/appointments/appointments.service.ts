import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Appointment, Lang } from '@prisma/client';
import { AuditService } from '../common/audit.service';
import { AuthUser, CLINICAL_ROLES } from '../common/auth-user';
import { distanceKm } from '../common/geo';
import { NotificationsService } from '../common/notifications.service';
import { OutboxService } from '../common/outbox.service';
import { note, sms, type Localized } from '../common/i18n';
import { PrismaService } from '../prisma/prisma.service';
import { ConfirmDto, CreateAppointmentDto, FacilitiesQuery, RefuseDto } from './appointments.dto';
import { canMove, checkPreferred, partOfDay, preferredText, reminderTitle, serviceLabel, sortForPatient, staffFilter, when, type ServiceCode } from './appointments.logic';

const HOUR = 3600_000;
const DAY = 24 * HOUR;

interface Recipient {
  userId: string;
  phone: string | null;
  lang: Lang;
  owner: boolean;
}

@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly outbox: OutboxService,
  ) {}

  // ─── Côté patient ────────────────────────────────────────────────

  /** Établissements où un soignant inscrit sur Ganji reçoit ce service, du plus proche au plus loin. */
  async facilities(q: FacilitiesQuery) {
    const rows = await this.prisma.practitioner.findMany({
      where: staffFilter(q.specialty as ServiceCode | undefined, CLINICAL_ROLES as ('PRACTITIONER' | 'NURSE')[]),
      select: {
        specialty: true,
        facility: { select: { id: true, name: true, shortName: true, type: true, lat: true, lng: true, phone: true, commune: { select: { name: true } } } },
      },
    });
    const origin = q.commune ? await this.prisma.commune.findUnique({ where: { name: q.commune }, select: { lat: true, lng: true, name: true } }) : null;
    const byId = new Map<string, { facility: NonNullable<(typeof rows)[number]['facility']>; practitioners: number }>();
    for (const r of rows) {
      if (!r.facility) continue;
      const cur = byId.get(r.facility.id) ?? { facility: r.facility, practitioners: 0 };
      cur.practitioners++;
      byId.set(r.facility.id, cur);
    }
    const list = [...byId.values()].map(({ facility: f, practitioners }) => ({
      id: f.id,
      name: f.name,
      shortName: f.shortName,
      type: f.type,
      phone: f.phone,
      commune: f.commune.name,
      practitioners,
      sameCommune: origin ? f.commune.name === origin.name : false,
      distanceKm: origin ? distanceKm(origin.lat, origin.lng, f.lat, f.lng) : null,
    }));
    list.sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0) || a.name.localeCompare(b.name, 'fr'));
    return list.slice(0, 8);
  }

  async create(user: AuthUser, dto: CreateAppointmentDto, ip?: string) {
    const patientId = dto.patientId ?? user.patientId;
    if (!patientId) {
      throw new ForbiddenException('Pour prendre rendez-vous, il faut un carnet Ganji, ou être l’aidant d’une personne qui vous l’a permis.');
    }
    await this.assertCanManage(user, patientId, ip);
    const code = dto.specialty as ServiceCode;
    const facility = await this.prisma.facility.findUnique({ where: { id: dto.facilityId }, select: { id: true, name: true, shortName: true } });
    if (!facility) throw new NotFoundException('Établissement introuvable');
    const staff = await this.prisma.practitioner.count({
      where: { ...staffFilter(code, CLINICAL_ROLES as ('PRACTITIONER' | 'NURSE')[]), facilityId: facility.id },
    });
    if (!staff) throw new BadRequestException('Cet établissement ne reçoit pas encore ce type de consultation sur Ganji. Choisissez-en un autre.');
    const preferredAt = new Date(dto.preferredAt);
    const invalid = checkPreferred(preferredAt);
    if (invalid) throw new BadRequestException(invalid);
    const pending = await this.prisma.appointment.findFirst({ where: { patientId, facilityId: facility.id, specialty: code, status: 'DEMANDE' } });
    if (pending) throw new BadRequestException('Une demande est déjà en attente pour ce service dans cet établissement.');

    const a = await this.prisma.appointment.create({
      data: {
        patientId,
        facilityId: facility.id,
        facilityName: facility.shortName ?? facility.name,
        specialty: code,
        reason: dto.reason?.trim() || null,
        preferredAt,
        createdById: user.id,
      },
      include: { patient: { select: { firstName: true, lastName: true } } },
    });
    await this.audit.log({ actor: user, patientId, action: 'APPOINTMENT', resource: `Demande de rendez-vous (${a.facilityName})`, ip });

    const staffIds = await this.staffOf(facility.id);
    const who = `${a.patient.firstName} ${a.patient.lastName.charAt(0)}.`;
    await this.notifyEach(
      staffIds,
      note('rdv.n.request.title', 'rdv.n.request.body', { who, service: (l) => serviceLabel(code, l), preferred: (l) => preferredText(preferredAt, l) }),
      '/pro/rendez-vous',
    );
    return this.presentForPatient(a, user);
  }

  /** Rendez-vous de la personne, de ses enfants et des personnes qu'elle aide (droit « rendez-vous »). */
  async mine(user: AuthUser) {
    const patients = await this.managedPatients(user);
    if (!patients.length) return [];
    const rows = await this.prisma.appointment.findMany({
      where: { patientId: { in: patients.map((p) => p.id) } },
      include: { patient: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return sortForPatient(rows).map((a) => this.presentForPatient(a, user));
  }

  async cancel(user: AuthUser, id: string, ip?: string) {
    const a = await this.prisma.appointment.findUnique({ where: { id }, include: { patient: { select: { firstName: true, lastName: true } } } });
    if (!a) throw new NotFoundException('Rendez-vous introuvable');
    await this.assertCanManage(user, a.patientId, ip);
    if (!canMove(a.status, 'ANNULE')) throw new BadRequestException('Ce rendez-vous ne peut plus être annulé.');
    const updated = await this.prisma.appointment.update({ where: { id }, data: { status: 'ANNULE' }, include: { patient: { select: { firstName: true, lastName: true } } } });
    await this.prisma.reminder.deleteMany({ where: { appointmentId: id, sentAt: null } });
    await this.audit.log({ actor: user, patientId: a.patientId, action: 'APPOINTMENT', resource: `Rendez-vous annulé (${a.facilityName})`, ip });
    const who = `${a.patient.firstName} ${a.patient.lastName.charAt(0)}.`;
    const date = a.scheduledAt ?? a.preferredAt;
    await this.notifyEach(
      await this.staffOf(a.facilityId),
      note('rdv.n.cancelled.title', 'rdv.n.cancelled.body', { who, date: (l) => (a.scheduledAt ? when(date, l) : preferredText(date, l)) }),
      '/pro/rendez-vous',
    );
    return this.presentForPatient(updated, user);
  }

  // ─── Côté établissement ─────────────────────────────────────────

  /** Demandes de l'établissement du soignant : en attente d'abord, puis rendez-vous à venir, puis réponses récentes. */
  async requests(user: AuthUser) {
    const facilityId = this.ownFacility(user);
    const now = Date.now();
    const [facility, rows] = await Promise.all([
      this.prisma.facility.findUnique({ where: { id: facilityId }, select: { id: true, name: true, shortName: true } }),
      this.prisma.appointment.findMany({
        where: {
          facilityId,
          OR: [
            { status: 'DEMANDE' },
            { status: 'CONFIRME', scheduledAt: { gte: new Date(now - 12 * HOUR) } },
            { status: { in: ['CONFIRME', 'REFUSE', 'ANNULE', 'FAIT'] }, updatedAt: { gte: new Date(now - 7 * DAY) } },
          ],
        },
        include: { patient: { select: { id: true, firstName: true, lastName: true, birthDate: true, sex: true, userId: true, commune: { select: { name: true } } } } },
        take: 200,
      }),
    ]);
    const creators = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdById))] } }, select: { id: true, displayName: true } });
    const present = (a: (typeof rows)[number]) => ({
      id: a.id,
      status: a.status,
      specialty: a.specialty,
      reason: a.reason,
      preferredAt: a.preferredAt,
      part: partOfDay(a.preferredAt),
      scheduledAt: a.scheduledAt,
      answer: a.answer,
      answeredByName: a.answeredByName,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      patient: {
        name: `${a.patient.firstName} ${a.patient.lastName}`,
        age: age(a.patient.birthDate),
        sex: a.patient.sex,
        commune: a.patient.commune?.name ?? null,
      },
      requestedBy: a.createdById !== a.patient.userId ? (creators.find((c) => c.id === a.createdById)?.displayName ?? null) : null,
    });
    const upcoming = (a: (typeof rows)[number]) => a.status === 'CONFIRME' && a.scheduledAt && a.scheduledAt.getTime() >= now - 12 * HOUR;
    return {
      facility: facility ? { id: facility.id, name: facility.shortName ?? facility.name } : null,
      pending: rows.filter((a) => a.status === 'DEMANDE').sort((a, b) => +a.preferredAt - +b.preferredAt || +a.createdAt - +b.createdAt).map(present),
      upcoming: rows.filter(upcoming).sort((a, b) => +a.scheduledAt! - +b.scheduledAt!).map(present),
      recent: rows
        .filter((a) => a.status !== 'DEMANDE' && !upcoming(a))
        .sort((a, b) => +b.updatedAt - +a.updatedAt)
        .slice(0, 10)
        .map(present),
    };
  }

  /** Confirme (ou replace) un rendez-vous : rappel la veille par SMS et dans l'application, personne et aidants prévenus. */
  async confirm(user: AuthUser, id: string, dto: ConfirmDto, ip?: string) {
    const a = await this.facilityAppointment(user, id);
    if (!canMove(a.status, 'CONFIRME')) throw new BadRequestException('Cette demande est déjà close.');
    const scheduledAt = new Date(dto.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() < Date.now()) throw new BadRequestException('Choisissez une date et une heure à venir.');
    if (scheduledAt.getTime() > Date.now() + 180 * DAY) throw new BadRequestException('Choisissez une date dans les six prochains mois.');
    const updated = await this.prisma.appointment.update({
      where: { id },
      data: { status: 'CONFIRME', scheduledAt, answer: dto.answer?.trim() || null, answeredById: user.id, answeredByName: user.name },
    });
    // Un seul rappel par rendez-vous : la tâche planifiée l'envoie dans les 24 h qui précèdent.
    await this.prisma.reminder.deleteMany({ where: { appointmentId: id, sentAt: null } });
    await this.prisma.reminder.create({
      data: { patientId: a.patientId, kind: 'APPOINTMENT', title: reminderTitle(a.specialty), place: a.facilityName, dueAt: scheduledAt, channels: ['SMS', 'APP'], appointmentId: id },
    });
    await this.audit.log({ actor: user, patientId: a.patientId, action: 'WRITE', resource: 'Rendez-vous confirmé', ip });

    const place = a.facilityName;
    await this.tellPatientSide(
      a,
      note('rdv.n.confirmed.title', updated.answer ? 'rdv.n.confirmed.bodyAnswer' : 'rdv.n.confirmed.body', { place, when: (l) => when(scheduledAt, l), answer: updated.answer ?? '' }),
      (r, prenom) => sms(r.owner ? 'rdv.confirmed' : 'rdv.confirmed.other', r.lang, { when: (l) => when(scheduledAt, l), place, prenom }),
    );
    return updated;
  }

  async refuse(user: AuthUser, id: string, dto: RefuseDto, ip?: string) {
    const a = await this.facilityAppointment(user, id);
    if (!canMove(a.status, 'REFUSE')) throw new BadRequestException('Cette demande est déjà close.');
    const updated = await this.prisma.appointment.update({
      where: { id },
      data: { status: 'REFUSE', answer: dto.answer.trim(), answeredById: user.id, answeredByName: user.name },
    });
    await this.prisma.reminder.deleteMany({ where: { appointmentId: id, sentAt: null } });
    await this.audit.log({ actor: user, patientId: a.patientId, action: 'APPOINTMENT', resource: 'Réponse à une demande de rendez-vous', ip });
    const place = a.facilityName;
    await this.tellPatientSide(
      a,
      note('rdv.n.refused.title', 'rdv.n.refused.body', { place, answer: updated.answer ?? '' }),
      (r, prenom) => sms(r.owner ? 'rdv.refused' : 'rdv.refused.other', r.lang, { place, prenom }),
    );
    return updated;
  }

  async done(user: AuthUser, id: string, ip?: string) {
    const a = await this.facilityAppointment(user, id);
    if (!canMove(a.status, 'FAIT')) throw new BadRequestException('Seul un rendez-vous confirmé peut être marqué comme fait.');
    const updated = await this.prisma.appointment.update({ where: { id }, data: { status: 'FAIT' } });
    await this.prisma.reminder.deleteMany({ where: { appointmentId: id, sentAt: null } });
    await this.audit.log({ actor: user, patientId: a.patientId, action: 'APPOINTMENT', resource: 'Rendez-vous honoré', ip });
    return updated;
  }

  // ─── Interne ─────────────────────────────────────────────────────

  private presentForPatient(a: Appointment & { patient: { firstName: string; lastName: string } }, user: AuthUser) {
    return {
      id: a.id,
      status: a.status,
      specialty: a.specialty,
      facility: { id: a.facilityId, name: a.facilityName },
      reason: a.reason,
      preferredAt: a.preferredAt,
      part: partOfDay(a.preferredAt),
      scheduledAt: a.scheduledAt,
      answer: a.answer,
      answeredByName: a.answeredByName,
      createdAt: a.createdAt,
      patient: { id: a.patientId, firstName: a.patient.firstName },
      own: a.patientId === user.patientId,
      canCancel: canMove(a.status, 'ANNULE') && (!a.scheduledAt || a.scheduledAt.getTime() > Date.now()),
    };
  }

  /** La personne elle-même, ses enfants, et les personnes qui lui ont confié leurs rendez-vous. */
  private async managedPatients(user: AuthUser) {
    const [children, delegations] = await Promise.all([
      user.patientId ? this.prisma.patient.findMany({ where: { parentId: user.patientId }, select: { id: true } }) : [],
      this.prisma.delegation.findMany({
        where: { caregiverId: user.id, revokedAt: null, OR: [{ scopes: { has: 'appointments' } }, { scopes: { has: 'all' } }] },
        select: { patientId: true },
      }),
    ]);
    const ids = [...(user.patientId ? [user.patientId] : []), ...children.map((c) => c.id), ...delegations.map((d) => d.patientId)];
    return [...new Set(ids)].map((id) => ({ id }));
  }

  private async assertCanManage(user: AuthUser, patientId: string, ip?: string) {
    if (user.patientId === patientId) return;
    const allowed = (await this.managedPatients(user)).some((p) => p.id === patientId);
    if (allowed) return;
    const exists = await this.prisma.patient.findUnique({ where: { id: patientId }, select: { id: true } });
    if (!exists) throw new NotFoundException('Patient introuvable');
    await this.audit.log({ actor: user, patientId, action: 'DENIED', resource: 'Rendez-vous', reason: 'Aucune délégation « rendez-vous »', allowed: false, ip });
    throw new ForbiddenException('Cette personne ne vous a pas confié ses rendez-vous. Elle peut vous l’autoriser dans « Mes aidants ».');
  }

  private ownFacility(user: AuthUser): string {
    if (!CLINICAL_ROLES.includes(user.role)) throw new ForbiddenException('Réservé aux soignants');
    if (!user.facilityId) throw new ForbiddenException('Aucun établissement n’est rattaché à votre compte.');
    return user.facilityId;
  }

  private async facilityAppointment(user: AuthUser, id: string) {
    const facilityId = this.ownFacility(user);
    const a = await this.prisma.appointment.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Rendez-vous introuvable');
    if (a.facilityId !== facilityId) throw new ForbiddenException('Cette demande concerne un autre établissement.');
    return a;
  }

  private async staffOf(facilityId: string) {
    const [doctors, nurses] = await Promise.all([
      this.notifications.usersWithRole('PRACTITIONER', facilityId),
      this.notifications.usersWithRole('NURSE', facilityId),
    ]);
    return [...doctors, ...nurses];
  }

  /** Notification dans la langue de chacun. */
  private async notifyEach(userIds: string[], text: Localized, href: string) {
    await this.notifications.notify(userIds, { kind: 'RDV', href, text });
  }

  /** La personne (ou le parent d'un enfant) et ses aidants « rendez-vous » : notification + SMS (neutre en mode discret). */
  private async tellPatientSide(a: Appointment, text: Localized, smsText: (r: Recipient, prenom: string) => string) {
    const patient = await this.prisma.patient.findUniqueOrThrow({
      where: { id: a.patientId },
      select: {
        firstName: true,
        discreetMode: true,
        user: { select: { id: true, phone: true, lang: true } },
        parent: { select: { user: { select: { id: true, phone: true, lang: true } } } },
        delegations: {
          where: { revokedAt: null, OR: [{ scopes: { has: 'appointments' } }, { scopes: { has: 'all' } }] },
          select: { caregiver: { select: { id: true, phone: true, lang: true } } },
        },
      },
    });
    const recipients: Recipient[] = [];
    const add = (u: { id: string; phone: string | null; lang: Lang } | null | undefined, owner: boolean) => {
      if (u && !recipients.some((r) => r.userId === u.id)) recipients.push({ userId: u.id, phone: u.phone, lang: u.lang, owner });
    };
    add(patient.user, true);
    add(patient.parent?.user, false);
    for (const d of patient.delegations) add(d.caregiver, false);

    await this.notifyEach(recipients.map((r) => r.userId), text, '/app/rendez-vous');
    for (const r of recipients) {
      if (!r.phone) continue;
      const body = patient.discreetMode ? sms('rdv.discreet', r.lang) : smsText(r, patient.firstName);
      try {
        await this.outbox.send({ channel: 'SMS', to: r.phone, lang: r.lang, body, ref: `appointment:${a.id}` });
      } catch (e) {
        // Un nom d'établissement refusé par le filtre médical : message neutre plutôt que rien.
        this.logger.warn(`SMS de rendez-vous remplacé par un message neutre : ${(e as Error).message}`);
        await this.outbox.send({ channel: 'SMS', to: r.phone, lang: r.lang, body: sms('rdv.discreet', r.lang), ref: `appointment:${a.id}` });
      }
    }
  }
}

function age(birth: Date) {
  const d = new Date();
  let a = d.getFullYear() - birth.getFullYear();
  if (d < new Date(d.getFullYear(), birth.getMonth(), birth.getDate())) a--;
  return a;
}
