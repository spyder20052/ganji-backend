import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes, randomInt } from 'node:crypto';
import { AccessService, Scope } from '../common/access.service';
import { AuditService } from '../common/audit.service';
import { AuthUser, CLINICAL_ROLES } from '../common/auth-user';
import { CryptoService } from '../common/crypto.service';
import { OutboxService } from '../common/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { normalizePhone } from '../auth/auth.dto';
import { DelegationDto, DocumentDto, EncounterDto, ObservationDto, ShareDto } from './patients.dto';
import { specialtyLabel } from '../data/specialties';
import { LISTEN_AUDIT_PREFIX } from '../listen/listen.constants';

export const OBS_META: Record<string, { label: string; unit: string; low?: number; high?: number }> = {
  HB: { label: 'Hémoglobine', unit: 'g/dL', low: 12, high: 17 },
  PLT: { label: 'Plaquettes', unit: 'G/L', low: 150, high: 400 },
  WBC: { label: 'Globules blancs', unit: 'G/L', low: 4, high: 10 },
  GLY: { label: 'Glycémie à jeun', unit: 'g/L', low: 0.7, high: 1.1 },
  TA_SYS: { label: 'Tension systolique', unit: 'mmHg', low: 90, high: 140 },
  TA_DIA: { label: 'Tension diastolique', unit: 'mmHg', low: 60, high: 90 },
  WEIGHT: { label: 'Poids', unit: 'kg' },
  HEIGHT: { label: 'Taille', unit: 'cm' },
};

function age(birth: Date) {
  const d = new Date();
  let a = d.getFullYear() - birth.getFullYear();
  if (d < new Date(d.getFullYear(), birth.getMonth(), birth.getDate())) a--;
  return a;
}

@Injectable()
export class PatientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
    private readonly outbox: OutboxService,
  ) {}

  ownPatientId(user: AuthUser): string {
    if (!user.patientId) throw new ForbiddenException('Réservé au titulaire du carnet');
    return user.patientId;
  }

  // ─── Lecture du carnet ──────────────────────────────────────────

  async summary(user: AuthUser, patientId: string, ip?: string) {
    const decision = await this.access.assert(user, patientId, 'summary', 'Fiche vitale', ip);
    const withSensitive = (await this.access.decide(user, patientId, 'sensitive')).allowed;
    const p = await this.prisma.patient.findUniqueOrThrow({
      where: { id: patientId },
      include: {
        commune: { select: { name: true, departmentCode: true } },
        conditions: { orderBy: { onsetAt: 'desc' } },
        reminders: { where: { dueAt: { gte: new Date() } }, orderBy: { dueAt: 'asc' }, take: 3 },
        careTeam: { include: { practitioner: { include: { user: { select: { displayName: true } }, facility: { select: { shortName: true, name: true } } } } } },
        pregnancies: { where: { status: 'EN_COURS' }, select: { id: true, edd: true } },
        children: { select: { id: true, firstName: true, birthDate: true } },
      },
    });
    return {
      id: p.id,
      firstName: p.firstName,
      lastName: p.lastName,
      age: age(p.birthDate),
      birthDate: p.birthDate,
      sex: p.sex,
      bloodGroup: p.bloodGroup,
      bloodGroupSource: p.bloodGroupSource,
      allergies: p.allergies,
      treatments: this.crypto.decrypt(p.treatmentsEnc),
      conditions: p.conditions
        .filter((c) => !c.sensitive || withSensitive)
        .map((c) => ({ id: c.id, code: c.code, label: this.crypto.decrypt(c.labelEnc), since: c.onsetAt })),
      hiddenSensitive: p.conditions.some((c) => c.sensitive) && !withSensitive,
      emergencyContact: p.emergencyName ? { name: p.emergencyName, phone: p.emergencyPhone } : null,
      commune: p.commune?.name ?? null,
      department: p.commune?.departmentCode ?? null,
      qrToken: decision.via === 'OWNER' ? p.qrToken : undefined,
      nextReminders: p.reminders.map((r) => ({ id: r.id, kind: r.kind, title: r.title, dueAt: r.dueAt, place: r.place })),
      careTeam: p.careTeam.map((m) => ({
        role: m.role,
        name: m.practitioner.user.displayName,
        specialty: m.practitioner.specialty,
        facility: m.practitioner.facility?.shortName ?? m.practitioner.facility?.name,
      })),
      pregnancy: p.pregnancies[0] ?? null,
      children: p.children.map((c) => ({ id: c.id, firstName: c.firstName, age: age(c.birthDate) })),
      discreetMode: p.discreetMode,
      access: { via: decision.via, expiresAt: decision.consentExpiresAt ?? null },
    };
  }

  async timeline(user: AuthUser, patientId: string, ip?: string) {
    await this.access.assert(user, patientId, 'timeline', 'Chronologie de soins', ip);
    // Les ordonnances ont leur propre volet de partage : sans lui, elles n'apparaissent pas dans la chronologie.
    const withRx = (await this.access.decide(user, patientId, 'prescriptions')).allowed;
    const [encounters, tele, rx] = await Promise.all([
      this.prisma.encounter.findMany({ where: { patientId }, orderBy: { date: 'desc' }, take: 60 }),
      this.prisma.teleExpertise.findMany({ where: { patientId, status: 'REPONDUE' }, orderBy: { answeredAt: 'desc' }, take: 20 }),
      withRx ? this.prisma.prescription.findMany({ where: { patientId }, orderBy: { issuedAt: 'desc' }, take: 20 }) : Promise.resolve([]),
    ]);
    const items = [
      ...encounters.map((e) => ({
        id: e.id,
        kind: e.type,
        date: e.date,
        title: labelEncounter(e.type),
        place: e.facilityName,
        author: e.authorName,
        detail: this.crypto.decrypt(e.summaryEnc),
      })),
      ...tele.map((t) => ({
        id: t.id,
        kind: 'TELE_EXPERTISE',
        date: t.answeredAt ?? t.createdAt,
        title: `Avis en ${specialtyLabel(t.specialty)}`,
        place: t.requesterSite,
        author: t.answeredByName,
        detail: t.answer,
      })),
      ...rx.map((r) => ({
        id: r.id,
        kind: 'ORDONNANCE',
        date: r.issuedAt,
        title: r.status === 'DISPENSED' ? 'Ordonnance délivrée' : 'Ordonnance',
        place: r.dispensedByName,
        author: r.prescriberName,
        detail: (r.items as { dci: string; dosage: string }[]).map((i) => `${i.dci} · ${i.dosage}`).join(' ; '),
      })),
    ];
    return items.sort((a, b) => +new Date(b.date) - +new Date(a.date));
  }

  async observations(user: AuthUser, patientId: string, code?: string, ip?: string) {
    await this.access.assert(user, patientId, 'observations', "Résultats d'analyses", ip);
    const rows = await this.prisma.observation.findMany({
      where: { patientId, ...(code ? { code } : {}) },
      orderBy: { date: 'asc' },
    });
    const series: Record<string, { code: string; label: string; unit: string; refLow?: number | null; refHigh?: number | null; points: { date: Date; value: number }[] }> = {};
    for (const o of rows) {
      series[o.code] ??= { code: o.code, label: o.label, unit: o.unit, refLow: o.refLow, refHigh: o.refHigh, points: [] };
      series[o.code].points.push({ date: o.date, value: o.value });
    }
    return Object.values(series);
  }

  async addObservation(user: AuthUser, patientId: string, dto: ObservationDto, ip?: string) {
    this.requireClinical(user);
    await this.access.assert(user, patientId, 'observations', 'Ajout de résultat', ip);
    const meta = OBS_META[dto.code];
    const obs = await this.prisma.observation.create({
      data: {
        patientId,
        code: dto.code,
        label: meta.label,
        unit: meta.unit,
        refLow: meta.low,
        refHigh: meta.high,
        value: dto.value,
        date: dto.date ? new Date(dto.date) : new Date(),
        source: user.name,
      },
    });
    await this.audit.log({ actor: user, patientId, action: 'WRITE', resource: `Résultat ${meta.label}`, ip });
    return obs;
  }

  async addEncounter(user: AuthUser, patientId: string, dto: EncounterDto, ip?: string) {
    this.requireClinical(user);
    await this.access.assert(user, patientId, 'timeline', 'Ajout de compte rendu', ip);
    const facility = user.facilityId ? await this.prisma.facility.findUnique({ where: { id: user.facilityId } }) : null;
    const e = await this.prisma.encounter.create({
      data: {
        patientId,
        type: dto.type,
        date: new Date(),
        facilityName: facility?.shortName ?? facility?.name,
        authorName: user.name,
        summaryEnc: this.crypto.encrypt(dto.summary),
      },
    });
    await this.audit.log({ actor: user, patientId, action: 'WRITE', resource: 'Compte rendu', ip });
    return { id: e.id };
  }

  async documents(user: AuthUser, patientId: string, ip?: string) {
    await this.access.assert(user, patientId, 'documents', 'Documents', ip);
    return this.prisma.documentRef.findMany({
      where: { patientId },
      select: { id: true, kind: true, title: true, mime: true, size: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Un document, pour l'ouvrir ou le télécharger : volet « documents » exigé, chaque ouverture est journalisée avec son titre. */
  async document(user: AuthUser, patientId: string, docId: string, ip?: string) {
    const d = await this.prisma.documentRef.findFirst({ where: { id: docId, patientId } });
    // Le titre n'entre au journal que si le document existe ; le refus est journalisé dans tous les cas.
    await this.access.assert(user, patientId, 'documents', d ? `Document « ${d.title} »` : 'Ouverture de document', ip);
    if (!d) throw new NotFoundException('Document introuvable');
    return d;
  }

  async addDocument(user: AuthUser, patientId: string, dto: DocumentDto, ip?: string) {
    await this.access.assert(user, patientId, 'documents', 'Ajout de document', ip);
    const buf = Buffer.from(dto.dataB64, 'base64');
    if (buf.length > 300 * 1024) throw new BadRequestException('Fichier trop lourd : 300 Ko maximum');
    const magic = buf.subarray(0, 4).toString('hex');
    const ok =
      (dto.mime === 'image/jpeg' && magic.startsWith('ffd8')) ||
      (dto.mime === 'image/png' && magic === '89504e47') ||
      (dto.mime === 'image/webp' && buf.subarray(8, 12).toString() === 'WEBP') ||
      (dto.mime === 'application/pdf' && buf.subarray(0, 4).toString() === '%PDF');
    if (!ok) throw new BadRequestException('Le contenu ne correspond pas au type de fichier annoncé');
    const doc = await this.prisma.documentRef.create({
      data: { patientId, kind: dto.kind, title: dto.title, mime: dto.mime, size: buf.length, dataB64: dto.dataB64 },
      select: { id: true, title: true, size: true },
    });
    await this.audit.log({ actor: user, patientId, action: 'WRITE', resource: `Document « ${dto.title} »`, ip });
    return doc;
  }

  /** Patients auxquels le soignant a accès (équipe de soins ou consentement actif). */
  async myPatients(user: AuthUser) {
    this.requireClinical(user);
    const [team, consents] = await Promise.all([
      user.practitionerId
        ? this.prisma.careTeamMember.findMany({ where: { practitionerId: user.practitionerId }, select: { patientId: true } })
        : [],
      this.prisma.consent.findMany({
        where: { granteeId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
        select: { patientId: true, expiresAt: true, source: true },
      }),
    ]);
    const ids = [...new Set([...team.map((t) => t.patientId), ...consents.map((c) => c.patientId)])];
    const patients = await this.prisma.patient.findMany({
      where: { id: { in: ids } },
      select: { id: true, firstName: true, lastName: true, birthDate: true, sex: true, bloodGroup: true, commune: { select: { name: true } } },
    });
    return patients.map((p) => {
      const c = consents.find((x) => x.patientId === p.id);
      return {
        ...p,
        age: age(p.birthDate),
        commune: p.commune?.name,
        via: team.some((t) => t.patientId === p.id) ? 'CARE_TEAM' : c?.source === 'BREAK_GLASS' ? 'BREAK_GLASS' : 'CONSENT',
        expiresAt: c?.expiresAt ?? null,
      };
    });
  }

  // ─── Consentement et partage ─────────────────────────────────────

  async share(user: AuthUser, dto: ShareDto) {
    const patientId = this.ownPatientId(user);
    const hours = dto.hours ?? 24;
    let shareCode = '';
    for (let i = 0; i < 5; i++) {
      shareCode = randomInt(0, 1_000_000).toString().padStart(6, '0');
      const clash = await this.prisma.consent.findUnique({ where: { shareCode } });
      if (!clash) break;
    }
    const consent = await this.prisma.consent.create({
      data: {
        patientId,
        scopes: dto.scopes,
        source: 'QR',
        shareCode,
        shareToken: randomBytes(24).toString('base64url'),
        expiresAt: new Date(Date.now() + 15 * 60_000), // le QR doit être scanné dans les 15 min
      },
    });
    await this.audit.log({ actor: user, patientId, action: 'CONSENT_OFFER', resource: `Partage (${dto.scopes.join(', ')})`, reason: `${hours} h` });
    return {
      id: consent.id,
      shareToken: consent.shareToken,
      shareCode: consent.shareCode,
      scanBefore: consent.expiresAt,
      hours,
      qrPayload: `ganji:share:${consent.shareToken}:${hours}`,
    };
  }

  async redeem(user: AuthUser, token: string, ip?: string) {
    if (!CLINICAL_ROLES.includes(user.role) && user.role !== 'PHARMACIST') {
      throw new ForbiddenException('Seul un professionnel de santé vérifié peut ouvrir un carnet partagé');
    }
    let raw = token.trim();
    let hours = 24;
    const m = raw.match(/^ganji:share:([A-Za-z0-9_-]+):(\d+)$/);
    if (m) {
      raw = m[1];
      hours = Math.min(168, Math.max(1, Number(m[2])));
    }
    const consent = await this.prisma.consent.findFirst({
      where: {
        OR: [{ shareToken: raw }, { shareCode: raw }],
        revokedAt: null,
        redeemedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (!consent) {
      await this.audit.log({ actor: user, action: 'DENIED', resource: 'Code de partage invalide ou expiré', allowed: false, ip });
      throw new BadRequestException('Code invalide, expiré ou déjà utilisé. Demandez au patient de générer un nouveau QR.');
    }
    const updated = await this.prisma.consent.update({
      where: { id: consent.id },
      data: {
        granteeId: user.id,
        granteeName: user.name,
        redeemedAt: new Date(),
        expiresAt: new Date(Date.now() + hours * 3600_000),
        shareCode: null,
        shareToken: null,
      },
    });
    await this.audit.log({
      actor: user,
      patientId: consent.patientId,
      action: 'CONSENT_GRANT',
      resource: `Accès ${updated.scopes.join(', ')}`,
      reason: `QR scanné, valable ${hours} h`,
      ip,
    });
    return { patientId: consent.patientId, expiresAt: updated.expiresAt, scopes: updated.scopes };
  }

  async consents(user: AuthUser) {
    const patientId = this.ownPatientId(user);
    const rows = await this.prisma.consent.findMany({
      where: { patientId, granteeId: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const now = new Date();
    return rows.map((c) => ({
      id: c.id,
      grantee: c.granteeName,
      scopes: c.scopes,
      source: c.source,
      since: c.redeemedAt ?? c.createdAt,
      expiresAt: c.expiresAt,
      active: !c.revokedAt && c.expiresAt > now,
      revokedAt: c.revokedAt,
    }));
  }

  async revoke(user: AuthUser, consentId: string) {
    const patientId = this.ownPatientId(user);
    const c = await this.prisma.consent.findFirst({ where: { id: consentId, patientId } });
    if (!c) throw new NotFoundException('Consentement introuvable');
    await this.prisma.consent.update({ where: { id: c.id }, data: { revokedAt: new Date() } });
    await this.audit.log({ actor: user, patientId, action: 'CONSENT_REVOKE', resource: `Accès de ${c.granteeName ?? 'inconnu'}` });
    return { ok: true };
  }

  async accessLog(user: AuthUser, patientIdParam?: string) {
    const patientId = patientIdParam ?? this.ownPatientId(user);
    if (patientIdParam) await this.access.assert(user, patientIdParam, 'summary', "Journal d'accès");
    // Écoute psychologique (compartiment sensible) : visible du titulaire seulement, jamais d'un aidant.
    const owner = patientId === user.patientId;
    const rows = await this.prisma.auditEvent.findMany({
      where: {
        patientId,
        action: { notIn: ['LOGIN'] },
        NOT: [{ actorId: user.id, action: 'READ' }, ...(owner ? [] : [{ resource: { startsWith: LISTEN_AUDIT_PREFIX } }])],
      },
      orderBy: { at: 'desc' },
      take: 100,
    });
    return rows.map((r) => ({
      id: r.id,
      at: r.at,
      who: r.actorName ?? 'Système',
      role: r.actorRole,
      action: r.action,
      resource: r.resource,
      reason: r.reason,
      allowed: r.allowed,
    }));
  }

  async setDiscreet(user: AuthUser, on: boolean) {
    const patientId = this.ownPatientId(user);
    await this.prisma.patient.update({ where: { id: patientId }, data: { discreetMode: on } });
    return { discreetMode: on };
  }

  // ─── Aidants ─────────────────────────────────────────────────────

  async delegations(user: AuthUser) {
    const patientId = this.ownPatientId(user);
    return this.prisma.delegation.findMany({
      where: { patientId, revokedAt: null },
      select: { id: true, relation: true, scopes: true, createdAt: true, caregiver: { select: { displayName: true } } },
    });
  }

  async addDelegation(user: AuthUser, dto: DelegationDto) {
    const patientId = this.ownPatientId(user);
    const caregiver = await this.prisma.user.findUnique({ where: { phone: normalizePhone(dto.phone) } });
    if (!caregiver) throw new NotFoundException("Ce numéro n'a pas encore de compte Ganji. Invitez l'aidant à s'inscrire.");
    const d = await this.prisma.delegation.upsert({
      where: { patientId_caregiverId: { patientId, caregiverId: caregiver.id } },
      update: { relation: dto.relation, scopes: dto.scopes, revokedAt: null },
      create: { patientId, caregiverId: caregiver.id, relation: dto.relation, scopes: dto.scopes },
    });
    await this.audit.log({ actor: user, patientId, action: 'CONSENT_GRANT', resource: `Aidant : ${caregiver.displayName} (${dto.relation})` });
    if (caregiver.phone) {
      await this.outbox.send({
        channel: 'SMS',
        to: caregiver.phone,
        lang: caregiver.lang,
        body: `Ganji : ${user.name} vous a désigné comme aidant. Ouvrez Ganji pour voir ce que vous pouvez faire pour lui.`,
        ref: `delegation:${d.id}`,
      });
    }
    return { id: d.id };
  }

  async revokeDelegation(user: AuthUser, id: string) {
    const patientId = this.ownPatientId(user);
    const d = await this.prisma.delegation.findFirst({ where: { id, patientId } });
    if (!d) throw new NotFoundException();
    await this.prisma.delegation.update({ where: { id }, data: { revokedAt: new Date() } });
    await this.audit.log({ actor: user, patientId, action: 'CONSENT_REVOKE', resource: 'Aidant retiré' });
    return { ok: true };
  }

  requireClinical(user: AuthUser) {
    if (!CLINICAL_ROLES.includes(user.role)) throw new ForbiddenException('Réservé aux soignants');
  }

  assertScope(s: string): Scope {
    return s as Scope;
  }
}

function labelEncounter(t: string) {
  return (
    {
      CONSULTATION: 'Consultation',
      HOSPITALISATION: 'Hospitalisation',
      TRANSFUSION: 'Transfusion',
      CHIMIOTHERAPIE: 'Cure de chimiothérapie',
      URGENCE: 'Passage aux urgences',
      CPN: 'Consultation prénatale',
      VACCINATION: 'Vaccination',
      TELE_EXPERTISE: 'Télé-expertise',
    } as Record<string, string>
  )[t] ?? t;
}
