import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessService } from '../common/access.service';
import { AuditService } from '../common/audit.service';
import { AuthUser, CLINICAL_ROLES } from '../common/auth-user';
import { note, sms } from '../common/i18n';
import { shortName } from '../common/names';
import { NotificationsService } from '../common/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { CircleService } from '../circle/circle.service';
import { SymptomDto, TeleAnswerDto, TeleRequestDto } from './care.dto';
import { specialtyLabel } from '../data/specialties';

/** Photos jointes à une demande d'avis : compressées côté téléphone, 300 Ko chacune au plus. */
const MAX_ATTACHMENT_BYTES = 300 * 1024;
/** Accès au carnet accordé au spécialiste qui ouvre une demande d'avis : le temps de l'étudier et d'y répondre. */
const TELE_ACCESS_HOURS = 72;
const TELE_SCOPES = ['summary', 'timeline', 'observations', 'documents'];
/** Journal de symptômes : rappels des trois derniers jours affichés avec le plan de soins. */
const PLAN_REMINDERS_DAYS = 3;

const SYMPTOM_LABEL: Record<string, string> = {
  fever: 'Fièvre',
  pain: 'Douleur',
  bleeding: 'Saignement',
  fatigue: 'Grande fatigue',
  vomiting: 'Vomissements',
  breath: 'Essoufflement',
  bruise: 'Bleus inhabituels',
  other: 'Autre',
};
/** Signes d'alerte pour un patient sous traitement hématologique : message immédiat à l'équipe. */
export function isAlert(symptom: string, severity: number) {
  return symptom === 'bleeding' || (symptom === 'fever' && severity >= 2) || (symptom === 'breath' && severity >= 2) || severity === 3;
}

@Injectable()
export class CareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly circle: CircleService,
  ) {}

  private async resolvePatient(user: AuthUser, patientId: string | undefined, resource: string, ip?: string) {
    const pid = patientId ?? user.patientId;
    if (!pid) throw new ForbiddenException('Aucun carnet associé');
    if (pid !== user.patientId) await this.access.assert(user, pid, 'summary', resource, ip);
    return pid;
  }

  async plan(user: AuthUser, patientId?: string, ip?: string) {
    const pid = await this.resolvePatient(user, patientId, 'Plan de soins', ip);
    const [plans, reminders, team] = await Promise.all([
      this.prisma.carePlan.findMany({ where: { patientId: pid }, orderBy: { createdAt: 'desc' } }),
      this.prisma.reminder.findMany({ where: { patientId: pid, dueAt: { gte: new Date(Date.now() - PLAN_REMINDERS_DAYS * 86_400_000) } }, orderBy: { dueAt: 'asc' }, take: 20 }),
      this.prisma.careTeamMember.findMany({
        where: { patientId: pid },
        include: { practitioner: { include: { user: { select: { displayName: true } }, facility: { select: { shortName: true, name: true } } } } },
      }),
    ]);
    return {
      plans,
      reminders,
      team: team.map((m) => ({ role: m.role, name: m.practitioner.user.displayName, specialty: m.practitioner.specialty, facility: m.practitioner.facility?.shortName ?? m.practitioner.facility?.name })),
    };
  }

  /**
   * Même règle que « C'est fait » du cercle de soins (point unique) : patient ou aidant ayant le droit
   * « rappels », dans la fenêtre de confirmation, écriture journalisée.
   */
  confirmReminder(user: AuthUser, id: string) {
    return this.circle.confirm(user, id);
  }

  async logSymptom(user: AuthUser, dto: SymptomDto, ip?: string) {
    const pid = await this.resolvePatient(user, dto.patientId, 'Journal de symptômes', ip);
    const alert = isAlert(dto.symptom, dto.severity);
    const log = await this.prisma.symptomLog.create({ data: { patientId: pid, symptom: dto.symptom, severity: dto.severity, note: dto.note, alert } });
    let notified = 0;
    if (alert) {
      // L'équipe de soins est prévenue dans l'application et par SMS (un nom, jamais le symptôme).
      const team = await this.prisma.careTeamMember.findMany({ where: { patientId: pid }, select: { practitioner: { select: { userId: true } } } });
      const patient = await this.prisma.patient.findUniqueOrThrow({ where: { id: pid }, select: { firstName: true, lastName: true } });
      const name = shortName(patient);
      notified = await this.notifications.notify(
        team.map((m) => m.practitioner.userId),
        { kind: 'TRAITEMENT', text: note('care.n.symptom.title', 'care.n.symptom.body', { name }), href: `/pro/patients/${pid}`, sms: (lang) => sms('care.symptomAlert', lang, { name }), ref: `symptom:${log.id}` },
      );
      await this.audit.log({ actor: user, patientId: pid, action: 'SYMPTOM_ALERT', resource: `Signe d'alerte : ${SYMPTOM_LABEL[dto.symptom]} (${dto.severity}/3)`, ip });
    }
    return {
      id: log.id,
      alert,
      notified,
      advice: alert
        ? ["Votre équipe de soins est prévenue. Si c'est grave ou si ça empire, allez aux urgences sans attendre.", 'Gardez votre carte QR Ganji sur vous.']
        : ['Symptôme noté dans votre carnet. Votre équipe le verra à la prochaine consultation.'],
    };
  }

  async symptoms(user: AuthUser, patientId?: string, ip?: string) {
    const pid = await this.resolvePatient(user, patientId, 'Journal de symptômes', ip);
    const rows = await this.prisma.symptomLog.findMany({ where: { patientId: pid }, orderBy: { at: 'desc' }, take: 50 });
    return rows.map((s) => ({ ...s, label: SYMPTOM_LABEL[s.symptom] }));
  }

  // ─── Télé-expertise ─────────────────────────────────────────────

  async requestTele(user: AuthUser, dto: TeleRequestDto, ip?: string) {
    if (!CLINICAL_ROLES.includes(user.role)) throw new ForbiddenException('Réservé aux soignants');
    await this.access.assert(user, dto.patientId, 'summary', 'Demande de télé-expertise', ip);
    for (const a of dto.attachments ?? []) {
      if (Buffer.from(a, 'base64').length > MAX_ATTACHMENT_BYTES) throw new BadRequestException('Chaque photo doit faire 300 Ko maximum');
    }
    const facility = user.facilityId ? await this.prisma.facility.findUnique({ where: { id: user.facilityId } }) : null;
    const t = await this.prisma.teleExpertise.create({
      data: {
        patientId: dto.patientId,
        requesterId: user.id,
        requesterName: user.name,
        requesterSite: facility?.shortName ?? facility?.name,
        specialty: dto.specialty,
        question: dto.question,
        urgency: dto.urgency,
        attachments: dto.attachments ?? [],
      },
    });
    // Les spécialistes vérifiés de la discipline sont prévenus ; l'accès au carnet n'est accordé qu'à celui qui
    // ouvre la demande (teleDetail), pas à tous les spécialistes du pays.
    const specialists = await this.prisma.practitioner.findMany({ where: { specialty: dto.specialty, verifiedAt: { not: null } }, select: { userId: true } });
    const from = facility?.shortName ?? user.name;
    const urgent = dto.urgency === 'URGENTE';
    const specialty = specialtyLabel(dto.specialty);
    const specialistsNotified = await this.notifications.notify(
      specialists.map((s) => s.userId).filter((id) => id !== user.id),
      {
        kind: 'AVIS',
        text: note(urgent ? 'care.n.tele.urgent.title' : 'care.n.tele.new.title', 'care.n.tele.new.body', { from, specialty }),
        href: `/pro/tele-expertise/${t.id}`,
        sms: (lang) => sms(urgent ? 'care.tele.newUrgent' : 'care.tele.new', lang, { from }),
        ref: `tele:${t.id}`,
      },
    );
    await this.audit.log({ actor: user, patientId: dto.patientId, action: 'WRITE', resource: `Demande d'avis en ${specialty}`, ip });
    return { id: t.id, specialistsNotified };
  }

  async teleInbox(user: AuthUser) {
    if (!CLINICAL_ROLES.includes(user.role)) throw new ForbiddenException('Réservé aux soignants');
    const practitioner = user.practitionerId ? await this.prisma.practitioner.findUnique({ where: { id: user.practitionerId } }) : null;
    const rows = await this.prisma.teleExpertise.findMany({
      where: { OR: [{ requesterId: user.id }, ...(practitioner ? [{ specialty: practitioner.specialty }] : [])] },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 40,
      include: { patient: { select: { firstName: true, lastName: true, birthDate: true, sex: true, bloodGroup: true } } },
    });
    return rows.map((t) => ({
      id: t.id,
      patientId: t.patientId,
      patient: shortName(t.patient),
      specialty: t.specialty,
      question: t.question,
      urgency: t.urgency,
      status: t.status,
      requester: t.requesterName,
      site: t.requesterSite,
      attachments: (t.attachments as string[]).length,
      answer: t.answer,
      answeredBy: t.answeredByName,
      createdAt: t.createdAt,
      answeredAt: t.answeredAt,
      mine: t.requesterId === user.id,
      hoursWaiting: Math.round((+(t.answeredAt ?? new Date()) - +t.createdAt) / 3600_000),
    }));
  }

  async teleDetail(user: AuthUser, id: string, ip?: string) {
    const t = await this.prisma.teleExpertise.findUnique({
      where: { id },
      include: { patient: { select: { firstName: true, lastName: true, birthDate: true, sex: true, bloodGroup: true } } },
    });
    if (!t) throw new NotFoundException("Demande d'avis introuvable");
    if (t.requesterId !== user.id && !(await this.access.decide(user, t.patientId, 'summary')).allowed) await this.grantSpecialistAccess(user, t);
    await this.access.assert(user, t.patientId, 'summary', "Dossier d'avis", ip);
    const { patient, ...rest } = t;
    return { ...rest, patientName: `${patient.firstName} ${patient.lastName}`, patientSex: patient.sex, patientBloodGroup: patient.bloodGroup, mine: t.requesterId === user.id };
  }

  async answerTele(user: AuthUser, id: string, dto: TeleAnswerDto, ip?: string) {
    const t = await this.prisma.teleExpertise.findUnique({ where: { id } });
    if (!t) throw new NotFoundException("Demande d'avis introuvable");
    const practitioner = user.practitionerId ? await this.prisma.practitioner.findUnique({ where: { id: user.practitionerId } }) : null;
    if (!practitioner || practitioner.specialty !== t.specialty) throw new ForbiddenException('Seul un spécialiste de la discipline peut répondre');
    if (t.status === 'REPONDUE') throw new BadRequestException('Avis déjà rendu');
    if (!(await this.access.decide(user, t.patientId, 'summary')).allowed) await this.grantSpecialistAccess(user, t);
    await this.access.assert(user, t.patientId, 'summary', "Réponse d'avis", ip);
    // Une seule réponse, même si deux spécialistes répondent en même temps.
    const { count } = await this.prisma.teleExpertise.updateMany({
      where: { id, status: 'EN_ATTENTE' },
      data: { status: 'REPONDUE', answer: dto.answer, answeredAt: new Date(), answeredById: user.id, answeredByName: user.name },
    });
    if (!count) throw new BadRequestException('Avis déjà rendu');
    await this.notifications.notify(t.requesterId, {
      kind: 'AVIS',
      text: note('care.n.tele.answered.title', 'care.n.tele.answered.body', { name: user.name }),
      href: `/pro/tele-expertise/${id}`,
      sms: (lang) => sms('care.tele.answered', lang, { name: user.name }),
      ref: `tele:${id}`,
    });
    await this.audit.log({ actor: user, patientId: t.patientId, action: 'WRITE', resource: 'Avis de spécialiste ajouté au carnet', ip });
    return { ok: true };
  }

  /**
   * Un spécialiste vérifié de la discipline ouvre une demande en attente : il reçoit un accès en lecture au
   * carnet pour 72 h (consentement d'équipe tracé, prolongé s'il existe déjà). Personne d'autre : la demande
   * reste visible dans la boîte, le carnet non.
   */
  private async grantSpecialistAccess(user: AuthUser, t: { id: string; patientId: string; specialty: string; status: string; requesterId: string }) {
    if (t.status !== 'EN_ATTENTE' || t.requesterId === user.id || !user.practitionerId) return;
    const p = await this.prisma.practitioner.findUnique({ where: { id: user.practitionerId }, select: { specialty: true, verifiedAt: true } });
    if (!p?.verifiedAt || p.specialty !== t.specialty) return;
    const expiresAt = new Date(Date.now() + TELE_ACCESS_HOURS * 3600_000);
    const existing = await this.prisma.consent.findFirst({ where: { patientId: t.patientId, granteeId: user.id, source: 'TEAM', revokedAt: null }, orderBy: { expiresAt: 'desc' } });
    if (existing) await this.prisma.consent.update({ where: { id: existing.id }, data: { expiresAt, scopes: TELE_SCOPES } });
    else {
      await this.prisma.consent.create({
        data: { patientId: t.patientId, granteeId: user.id, granteeName: user.name, scopes: TELE_SCOPES, source: 'TEAM', durationHours: TELE_ACCESS_HOURS, redeemedAt: new Date(), expiresAt },
      });
    }
    await this.audit.log({ actor: user, patientId: t.patientId, action: 'CONSENT_GRANT', resource: `Accès ${TELE_SCOPES.join(', ')}`, reason: `Demande d'avis en ${specialtyLabel(t.specialty)} ouverte, ${TELE_ACCESS_HOURS} h` });
  }
}
