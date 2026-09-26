import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessService } from '../common/access.service';
import { AuditService } from '../common/audit.service';
import { AuthUser, CLINICAL_ROLES } from '../common/auth-user';
import { OutboxService } from '../common/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { CircleService } from '../circle/circle.service';
import { SymptomDto, TeleAnswerDto, TeleRequestDto } from './care.dto';
import { specialtyLabel } from '../data/specialties';

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
function isAlert(symptom: string, severity: number) {
  return symptom === 'bleeding' || (symptom === 'fever' && severity >= 2) || (symptom === 'breath' && severity >= 2) || severity === 3;
}

@Injectable()
export class CareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly circle: CircleService,
  ) {}

  private async resolvePatient(user: AuthUser, patientId?: string) {
    const pid = patientId ?? user.patientId;
    if (!pid) throw new ForbiddenException('Aucun carnet associé');
    if (pid !== user.patientId) await this.access.assert(user, pid, 'summary', 'Plan de soins');
    return pid;
  }

  async plan(user: AuthUser, patientId?: string) {
    const pid = await this.resolvePatient(user, patientId);
    const [plans, reminders, team] = await Promise.all([
      this.prisma.carePlan.findMany({ where: { patientId: pid }, orderBy: { createdAt: 'desc' } }),
      this.prisma.reminder.findMany({ where: { patientId: pid, dueAt: { gte: new Date(Date.now() - 3 * 86_400_000) } }, orderBy: { dueAt: 'asc' }, take: 20 }),
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

  async logSymptom(user: AuthUser, dto: SymptomDto) {
    const pid = await this.resolvePatient(user, dto.patientId);
    const alert = isAlert(dto.symptom, dto.severity);
    const log = await this.prisma.symptomLog.create({ data: { patientId: pid, symptom: dto.symptom, severity: dto.severity, note: dto.note, alert } });
    let notified = 0;
    if (alert) {
      const team = await this.prisma.careTeamMember.findMany({ where: { patientId: pid }, include: { practitioner: { include: { user: true } } } });
      const patient = await this.prisma.patient.findUniqueOrThrow({ where: { id: pid } });
      for (const m of team) {
        if (!m.practitioner.user.phone) continue;
        await this.outbox.send({ channel: 'PUSH', to: m.practitioner.user.phone, body: `Ganji : ${patient.firstName} ${patient.lastName.charAt(0)}. a signalé un signe d'alerte. Ouvrez son carnet.`, ref: `symptom:${log.id}` });
        notified++;
      }
      await this.audit.log({ actor: user, patientId: pid, action: 'SYMPTOM_ALERT', resource: `Signe d'alerte : ${SYMPTOM_LABEL[dto.symptom]} (${dto.severity}/3)` });
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

  async symptoms(user: AuthUser, patientId?: string) {
    const pid = await this.resolvePatient(user, patientId);
    const rows = await this.prisma.symptomLog.findMany({ where: { patientId: pid }, orderBy: { at: 'desc' }, take: 50 });
    return rows.map((s) => ({ ...s, label: SYMPTOM_LABEL[s.symptom] }));
  }

  // ─── Télé-expertise ─────────────────────────────────────────────

  async requestTele(user: AuthUser, dto: TeleRequestDto, ip?: string) {
    if (!CLINICAL_ROLES.includes(user.role)) throw new ForbiddenException('Réservé aux soignants');
    await this.access.assert(user, dto.patientId, 'summary', 'Demande de télé-expertise', ip);
    for (const a of dto.attachments ?? []) {
      if (Buffer.from(a, 'base64').length > 300 * 1024) throw new BadRequestException('Chaque photo doit faire 300 Ko maximum');
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
    // Le spécialiste reçoit, pour la durée de l'avis, un accès en lecture au carnet (consentement d'équipe tracé).
    const specialists = await this.prisma.practitioner.findMany({ where: { specialty: dto.specialty, verifiedAt: { not: null } }, include: { user: true } });
    for (const s of specialists) {
      await this.prisma.consent.create({
        data: {
          patientId: dto.patientId,
          granteeId: s.userId,
          granteeName: s.user.displayName,
          scopes: ['summary', 'timeline', 'observations', 'documents'],
          source: 'TEAM',
          redeemedAt: new Date(),
          expiresAt: new Date(Date.now() + 7 * 86_400_000),
        },
      });
      if (s.user.phone) {
        await this.outbox.send({ channel: 'PUSH', to: s.user.phone, body: `Ganji : nouvelle demande d'avis ${dto.urgency === 'URGENTE' ? 'URGENTE ' : ''}de ${facility?.shortName ?? user.name}.`, ref: `tele:${t.id}` });
      }
    }
    await this.audit.log({ actor: user, patientId: dto.patientId, action: 'WRITE', resource: `Demande d'avis en ${specialtyLabel(dto.specialty)}`, ip });
    return { id: t.id, specialistsNotified: specialists.length };
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
      patient: `${t.patient.firstName} ${t.patient.lastName.charAt(0)}.`,
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
    if (!t) throw new NotFoundException();
    await this.access.assert(user, t.patientId, 'summary', "Dossier d'avis", ip);
    const { patient, ...rest } = t;
    return { ...rest, patientName: `${patient.firstName} ${patient.lastName}`, patientSex: patient.sex, patientBloodGroup: patient.bloodGroup, mine: t.requesterId === user.id };
  }

  async answerTele(user: AuthUser, id: string, dto: TeleAnswerDto, ip?: string) {
    const t = await this.prisma.teleExpertise.findUnique({ where: { id } });
    if (!t) throw new NotFoundException();
    const practitioner = user.practitionerId ? await this.prisma.practitioner.findUnique({ where: { id: user.practitionerId } }) : null;
    if (!practitioner || practitioner.specialty !== t.specialty) throw new ForbiddenException('Seul un spécialiste de la discipline peut répondre');
    if (t.status === 'REPONDUE') throw new BadRequestException('Avis déjà rendu');
    await this.access.assert(user, t.patientId, 'summary', "Réponse d'avis", ip);
    await this.prisma.teleExpertise.update({ where: { id }, data: { status: 'REPONDUE', answer: dto.answer, answeredAt: new Date(), answeredById: user.id, answeredByName: user.name } });
    const requester = await this.prisma.user.findUnique({ where: { id: t.requesterId } });
    if (requester?.phone) {
      await this.outbox.send({ channel: 'PUSH', to: requester.phone, body: `Ganji : ${user.name} a répondu à votre demande d'avis.`, ref: `tele:${id}` });
    }
    await this.audit.log({ actor: user, patientId: t.patientId, action: 'WRITE', resource: 'Avis de spécialiste ajouté au carnet', ip });
    return { ok: true };
  }
}
