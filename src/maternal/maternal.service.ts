import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Role } from '@prisma/client';
import { AccessService } from '../common/access.service';
import { AuditService } from '../common/audit.service';
import { AuthUser } from '../common/auth-user';
import { CryptoService } from '../common/crypto.service';
import { ANC_SCHEDULE, DANGER_SIGNS_PREGNANCY, VACCINE_SCHEDULE } from '../data/vaccines';
import { RespondersService } from '../emergency/responders.service';
import { PrismaService } from '../prisma/prisma.service';
import { ImmunizationGivenDto } from './maternal.dto';

const DAY_MS = 86_400_000;
/** Un vaccin non fait est « en retard » 14 jours après la date prévue. */
const OVERDUE_GRACE_MS = 14 * DAY_MS;
const VAX_PAYLOAD = /^(?:alafia:vax:)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{16,64})$/i;

const VACCINE_BY_CODE = new Map(VACCINE_SCHEDULE.map((v) => [v.code, v]));
const ANC_BY_CODE = new Map(ANC_SCHEDULE.map((v) => [v.code as string, v]));
const DANGER_BY_CODE = new Map(DANGER_SIGNS_PREGNANCY.map((s) => [s.code, s]));

/** Signe de danger tel qu'enregistré dans Pregnancy.dangerSigns (JSON). */
type RecordedDangerSign = { code: string; at: string; reportedBy: string; reportedByRole: Role };

type ImmunizationStatus = 'fait' | 'à faire' | 'en retard';
type AncStatus = 'faite' | 'à venir' | 'en retard';

function immunizationStatus(i: { dueAt: Date; givenAt: Date | null }, now: Date): ImmunizationStatus {
  if (i.givenAt) return 'fait';
  return i.dueAt.getTime() < now.getTime() - OVERDUE_GRACE_MS ? 'en retard' : 'à faire';
}

function ageLabel(birth: Date, now = new Date()): string {
  const days = Math.floor((now.getTime() - birth.getTime()) / DAY_MS);
  if (days < 14) return `${Math.max(days, 0)} jour${days > 1 ? 's' : ''}`;
  if (days < 60) return `${Math.floor(days / 7)} semaines`;
  const months =
    (now.getFullYear() - birth.getFullYear()) * 12 + now.getMonth() - birth.getMonth() - (now.getDate() < birth.getDate() ? 1 : 0);
  if (months < 24) return `${months} mois`;
  return `${Math.floor(months / 12)} ans`;
}

/** Codes des vaccins faits, triés : c'est ce que couvre la preuve signée. */
function givenCodes(rows: { vaccineCode: string; givenAt: Date | null }[]): string[] {
  return [...new Set(rows.filter((r) => r.givenAt).map((r) => r.vaccineCode))].sort();
}

function proofString(childId: string, codes: string[]): string {
  return `vax|${childId}|${codes.join(',')}`;
}

function fmtDate(d: Date) {
  return d.toLocaleDateString('fr-FR', { timeZone: 'Africa/Porto-Novo', day: 'numeric', month: 'long', year: 'numeric' });
}

@Injectable()
export class MaternalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
    private readonly responders: RespondersService,
  ) {}

  schedules() {
    return { vaccines: VACCINE_SCHEDULE, anc: ANC_SCHEDULE, dangerSigns: DANGER_SIGNS_PREGNANCY };
  }

  // ─── Grossesse ───────────────────────────────────────────────────

  /** Grossesse en cours (null si aucune) : terme, trimestre, CPN et signes de danger. */
  async pregnancy(user: AuthUser, patientId: string | undefined, ip?: string) {
    const pid = await this.resolvePatient(user, patientId, 'Suivi de grossesse', ip);
    const p = await this.prisma.pregnancy.findFirst({
      where: { patientId: pid, status: 'EN_COURS' },
      include: { visits: { orderBy: { dueFrom: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
    if (!p) return null;

    const now = new Date();
    const days = Math.max(0, Math.floor((now.getTime() - p.lmp.getTime()) / DAY_MS));
    const weeks = Math.floor(days / 7);
    const visits = p.visits.map((v) => {
      const ref = ANC_BY_CODE.get(v.code);
      const status: AncStatus = v.doneAt ? 'faite' : v.dueTo < now ? 'en retard' : 'à venir';
      return {
        id: v.id,
        code: v.code,
        label: ref?.label ?? v.code,
        content: ref?.content ?? [],
        dueFrom: v.dueFrom,
        dueTo: v.dueTo,
        doneAt: v.doneAt,
        place: v.place,
        status,
      };
    });
    const recorded = this.recordedSigns(p.dangerSigns)
      .map((s) => ({ ...s, label: DANGER_BY_CODE.get(s.code)?.label ?? s.code, urgency: DANGER_BY_CODE.get(s.code)?.urgency ?? null }))
      .sort((a, b) => b.at.localeCompare(a.at));

    return {
      id: p.id,
      lmp: p.lmp,
      edd: p.edd,
      maternity: p.maternity,
      weeksAmenorrhea: weeks,
      daysAmenorrhea: days % 7,
      termLabel: `${weeks} SA${days % 7 ? ` + ${days % 7} j` : ''}`,
      trimester: weeks < 14 ? 1 : weeks < 28 ? 2 : 3,
      daysToTerm: Math.ceil((p.edd.getTime() - now.getTime()) / DAY_MS),
      visits,
      nextVisit: visits.find((v) => v.status !== 'faite') ?? null,
      dangerSignsCatalogue: DANGER_SIGNS_PREGNANCY,
      recordedDangerSigns: recorded,
    };
  }

  /**
   * Signalement de signes de danger par la femme enceinte, son aidant, un
   * relais communautaire ou un soignant. En cas d'urgence, les relais et les
   * aidants sont prévenus (sans nommer le signe) et les maternités ouvertes sont proposées.
   */
  async reportDangerSigns(user: AuthUser, pregnancyId: string, codes: string[], ip?: string) {
    const pregnancy = await this.prisma.pregnancy.findUnique({
      where: { id: pregnancyId },
      include: { patient: { select: { id: true, firstName: true, communeId: true, commune: { select: { lat: true, lng: true } } } } },
    });
    if (!pregnancy) throw new NotFoundException('Grossesse introuvable');
    if (pregnancy.status !== 'EN_COURS') throw new BadRequestException('Ce suivi de grossesse est clôturé');
    const patient = pregnancy.patient;
    // Les relais communautaires signalent pour les femmes qu'ils accompagnent, sans accès au dossier.
    if (user.role !== 'RELAY') await this.access.assert(user, patient.id, 'summary', 'Signalement de signe de danger', ip);

    const signs = codes.map((code) => {
      const sign = DANGER_BY_CODE.get(code);
      if (!sign) throw new BadRequestException(`Signe de danger inconnu : ${code}`);
      return sign;
    });
    const at = new Date().toISOString();
    const recorded: RecordedDangerSign[] = [
      ...this.recordedSigns(pregnancy.dangerSigns),
      ...signs.map((s) => ({ code: s.code, at, reportedBy: user.name, reportedByRole: user.role })),
    ];
    await this.prisma.pregnancy.update({ where: { id: pregnancy.id }, data: { dangerSigns: recorded } });

    const urgent = signs.some((s) => s.urgency === 'urgence');
    await this.audit.log({
      actor: user,
      patientId: patient.id,
      action: 'WRITE',
      resource: 'Signes de danger (grossesse)',
      reason: urgent ? 'Urgence signalée' : `${signs.length} signe(s) à surveiller`,
      ip,
    });

    let notified = 0;
    if (urgent) {
      const recipients = [...(await this.responders.relays(patient.communeId)), ...(await this.responders.caregivers(patient.id))];
      notified = await this.responders.notify(
        recipients,
        `Alafia : ${patient.firstName} signale un signe de danger de grossesse. Merci de l'appeler et de l'accompagner à la maternité.`,
        `danger-sign:${pregnancy.id}`,
      );
    }
    const places = await this.responders.nearestOpen('maternite', patient.commune);

    const advice = urgent
      ? [
          'Allez immédiatement à la maternité la plus proche, sans attendre le prochain rendez-vous.',
          'Faites-vous accompagner et emportez votre carnet de grossesse.',
          ...(notified ? ['Votre relais communautaire et vos proches ont été prévenus.'] : []),
        ]
      : [
          'Consultez une sage-femme ou un centre de santé dans les 24 heures.',
          "Si le signe s'aggrave ou si un autre signe apparaît, allez tout de suite à la maternité.",
        ];

    return {
      urgent,
      advice,
      places,
      notified,
      recorded: signs.map((s) => ({ code: s.code, label: s.label, urgency: s.urgency })),
    };
  }

  // ─── Enfants et vaccination ──────────────────────────────────────

  async children(user: AuthUser, patientId: string | undefined, ip?: string) {
    const pid = await this.resolvePatient(user, patientId, 'Enfants', ip);
    const now = new Date();
    const kids = await this.prisma.patient.findMany({
      where: { parentId: pid },
      select: { id: true, firstName: true, lastName: true, birthDate: true, sex: true, immunizations: { select: { dueAt: true, givenAt: true } } },
      orderBy: { birthDate: 'desc' },
    });
    return kids.map((k) => {
      const statuses = k.immunizations.map((i) => immunizationStatus(i, now));
      return {
        id: k.id,
        firstName: k.firstName,
        lastName: k.lastName,
        birthDate: k.birthDate,
        sex: k.sex,
        age: ageLabel(k.birthDate, now),
        vaccination: {
          done: statuses.filter((s) => s === 'fait').length,
          toDo: statuses.filter((s) => s === 'à faire').length,
          overdue: statuses.filter((s) => s === 'en retard').length,
        },
      };
    });
  }

  /** Carnet de vaccination d'un enfant, avec une preuve signée vérifiable hors ligne par QR. */
  async immunizations(user: AuthUser, childId: string, ip?: string) {
    await this.access.assert(user, childId, 'summary', 'Carnet de vaccination', ip);
    const child = await this.prisma.patient.findUniqueOrThrow({
      where: { id: childId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        birthDate: true,
        sex: true,
        immunizations: { orderBy: [{ dueAt: 'asc' }, { vaccineCode: 'asc' }] },
      },
    });
    const now = new Date();
    const immunizations = child.immunizations.map((i) => {
      const ref = VACCINE_BY_CODE.get(i.vaccineCode);
      return {
        id: i.id,
        code: i.vaccineCode,
        name: i.vaccineName,
        dose: i.dose,
        disease: ref?.disease ?? null,
        ageLabel: ref?.ageLabel ?? null,
        dueAt: i.dueAt,
        givenAt: i.givenAt,
        lot: i.lot,
        place: i.place,
        status: immunizationStatus(i, now),
      };
    });
    const given = givenCodes(child.immunizations);
    return {
      child: {
        id: child.id,
        firstName: child.firstName,
        lastName: child.lastName,
        birthDate: child.birthDate,
        sex: child.sex,
        age: ageLabel(child.birthDate, now),
      },
      immunizations,
      next: immunizations.find((i) => i.status !== 'fait') ?? null,
      proof: {
        qrPayload: `alafia:vax:${child.id}.${this.crypto.sign(proofString(child.id, given))}`,
        given,
        issuedAt: now,
      },
    };
  }

  async markGiven(user: AuthUser, immunizationId: string, dto: ImmunizationGivenDto, ip?: string) {
    const imm = await this.prisma.immunization.findUnique({ where: { id: immunizationId } });
    if (!imm) throw new NotFoundException('Vaccination introuvable');
    await this.access.assert(user, imm.patientId, 'summary', 'Vaccination', ip);

    const facility = user.facilityId
      ? await this.prisma.facility.findUnique({ where: { id: user.facilityId }, select: { name: true, shortName: true } })
      : null;
    const place = dto.place ?? facility?.shortName ?? facility?.name ?? null;
    const givenAt = new Date();

    const recorded = await this.prisma.$transaction(async (tx) => {
      // Garde atomique : une dose ne peut être enregistrée qu'une fois.
      const { count } = await tx.immunization.updateMany({
        where: { id: imm.id, givenAt: null },
        data: { givenAt, lot: dto.lot ?? null, place },
      });
      if (count === 0) return false;
      await tx.encounter.create({
        data: {
          patientId: imm.patientId,
          type: 'VACCINATION',
          date: givenAt,
          facilityName: place,
          authorName: user.name,
          summaryEnc: this.crypto.encrypt(`${imm.vaccineName} (dose ${imm.dose})${dto.lot ? `, lot ${dto.lot}` : ''}`),
        },
      });
      return true;
    });
    if (!recorded) {
      const current = await this.prisma.immunization.findUniqueOrThrow({ where: { id: imm.id } });
      throw new ConflictException(`Vaccin déjà enregistré le ${fmtDate(current.givenAt ?? givenAt)}${current.place ? ` (${current.place})` : ''}.`);
    }

    await this.audit.log({ actor: user, patientId: imm.patientId, action: 'WRITE', resource: `Vaccination ${imm.vaccineCode}`, ip });
    return { id: imm.id, vaccineCode: imm.vaccineCode, dose: imm.dose, givenAt, lot: dto.lot ?? null, place };
  }

  /**
   * Vérification publique d'une preuve de vaccination (école, frontière…).
   * La signature couvre la liste des vaccins faits : un QR émis avant une
   * nouvelle dose n'est plus valable, il faut en présenter un récent.
   */
  async verifyProof(payload: string, ip?: string) {
    const match = VAX_PAYLOAD.exec(payload.trim());
    const child = match
      ? await this.prisma.patient.findUnique({
          where: { id: match[1].toLowerCase() },
          select: { id: true, firstName: true, lastName: true, immunizations: { select: { vaccineCode: true, givenAt: true } } },
        })
      : null;
    const given = child ? givenCodes(child.immunizations) : [];
    if (!match || !child || !this.crypto.verify(proofString(child.id, given), match[2])) {
      return { valid: false, reason: 'Preuve invalide ou périmée : demandez à la famille de présenter un QR récent.' };
    }
    await this.audit.log({ patientId: child.id, action: 'PROOF_CHECK', resource: 'Preuve de vaccination', reason: 'QR vérifié', ip });
    return {
      valid: true,
      child: `${child.firstName} ${child.lastName.charAt(0)}.`,
      given,
      vaccines: given.map((code) => ({ code, name: VACCINE_BY_CODE.get(code)?.name ?? code })),
      checkedAt: new Date(),
    };
  }

  // ─── Interne ─────────────────────────────────────────────────────

  /** Patient visé : soi-même par défaut, sinon un tiers avec contrôle d'accès journalisé. */
  private async resolvePatient(user: AuthUser, patientId: string | undefined, resource: string, ip?: string): Promise<string> {
    const pid = patientId ?? user.patientId;
    if (!pid) throw new ForbiddenException('Réservé au titulaire du carnet : précisez le patient');
    if (pid !== user.patientId) await this.access.assert(user, pid, 'summary', resource, ip);
    return pid;
  }

  private recordedSigns(value: unknown): RecordedDangerSign[] {
    return Array.isArray(value) ? (value as RecordedDangerSign[]) : [];
  }
}
