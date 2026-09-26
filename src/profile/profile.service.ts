import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { normalizePhone } from '../auth/auth.dto';
import { AccessService } from '../common/access.service';
import { AuditService } from '../common/audit.service';
import { AuthUser, CLINICAL_ROLES } from '../common/auth-user';
import { CryptoService } from '../common/crypto.service';
import { NotificationsService } from '../common/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto, VitalsDto } from './profile.dto';
import { cleanList, DECLARED, joinAddress, missingFields, patientBloodGroup, splitAddress, toLang, toUiLang, type UiLang } from './profile.logic';

/** Libellés des champs modifiés, pour le journal d'accès de la personne. */
const FIELD_LABEL: Record<string, string> = {
  identity: 'identité',
  commune: 'commune',
  address: 'adresse',
  bloodGroup: 'groupe sanguin',
  allergies: 'allergies',
  treatments: 'traitements',
  emergency: 'personne à prévenir',
  conditions: 'maladies suivies',
};

@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Profil de la personne connectée : compte (nom, téléphone, langue) et, si elle a un carnet, sa fiche. */
  async get(user: AuthUser) {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { displayName: true, phone: true, lang: true, role: true },
    });
    const p = user.patientId
      ? await this.prisma.patient.findUnique({
          where: { id: user.patientId },
          include: { commune: { select: { name: true, department: { select: { name: true } } } }, conditions: { orderBy: { createdAt: 'asc' } } },
        })
      : null;
    return {
      account: { displayName: u.displayName, phone: u.phone, lang: toUiLang(u.lang), role: u.role },
      patient: p
        ? {
            id: p.id,
            firstName: p.firstName,
            lastName: p.lastName,
            birthDate: p.birthDate,
            sex: p.sex,
            commune: p.commune?.name ?? null,
            department: p.commune?.department.name ?? null,
            ...splitAddress(p.address),
            bloodGroup: p.bloodGroup,
            bloodGroupSource: p.bloodGroupSource,
            allergies: p.allergies,
            treatments: this.crypto.decrypt(p.treatmentsEnc) ?? '',
            conditions: p.conditions.map((c) => ({
              id: c.id,
              label: this.crypto.decrypt(c.labelEnc) ?? c.code ?? '',
              sensitive: c.sensitive,
              declared: c.code === DECLARED,
            })),
            emergencyName: p.emergencyName ?? '',
            emergencyPhone: p.emergencyPhone ?? '',
            profileDoneAt: p.profileDoneAt,
            missing: missingFields(p),
          }
        : null,
    };
  }

  async update(user: AuthUser, dto: UpdateProfileDto, ip?: string) {
    const changed = new Set<string>();
    const userData: Prisma.UserUpdateInput = {};
    if (dto.lang) userData.lang = toLang(dto.lang as UiLang);

    if (!user.patientId) {
      // Aidant sans carnet : seul le compte (nom affiché, langue) se modifie ici.
      const name = [dto.firstName, dto.lastName].filter(Boolean).join(' ').trim();
      if (name) userData.displayName = name;
      if (Object.keys(userData).length) await this.prisma.user.update({ where: { id: user.id }, data: userData });
      return this.get(user);
    }

    const p = await this.prisma.patient.findUniqueOrThrow({ where: { id: user.patientId } });
    const data: Prisma.PatientUncheckedUpdateInput = {};

    if (dto.firstName !== undefined || dto.lastName !== undefined || dto.birthDate !== undefined || dto.sex !== undefined) {
      const firstName = dto.firstName?.trim() || p.firstName;
      const lastName = dto.lastName?.trim() || p.lastName;
      if (dto.birthDate) {
        const d = new Date(dto.birthDate);
        if (Number.isNaN(d.getTime()) || d > new Date() || d.getFullYear() < 1900) throw new BadRequestException('Date de naissance invalide');
        data.birthDate = d;
      }
      if (dto.sex) data.sex = dto.sex;
      data.firstName = firstName;
      data.lastName = lastName;
      userData.displayName = `${firstName} ${lastName}`;
      changed.add('identity');
    }

    if (dto.commune !== undefined) {
      if (dto.commune === null || dto.commune === '') data.communeId = null;
      else {
        const c = await this.prisma.commune.findUnique({ where: { name: dto.commune } });
        if (!c) throw new BadRequestException('Commune inconnue : choisissez-la dans la liste.');
        data.communeId = c.id;
      }
      changed.add('commune');
    }

    if (dto.quartier !== undefined || dto.repere !== undefined) {
      const cur = splitAddress(p.address);
      data.address = joinAddress(dto.quartier ?? cur.quartier, dto.repere ?? cur.repere);
      changed.add('address');
    }

    if (dto.bloodGroup !== undefined) {
      const decision = patientBloodGroup(p.bloodGroup, p.bloodGroupSource, dto.bloodGroup);
      if ('refused' in decision) {
        throw new ForbiddenException({
          code: 'BLOOD_GROUP_VERIFIED',
          message: 'Votre groupe sanguin a été vérifié par un soignant. Seul un soignant peut le changer.',
        });
      }
      if (decision.change) {
        data.bloodGroup = decision.bloodGroup;
        data.bloodGroupSource = decision.bloodGroupSource;
        changed.add('bloodGroup');
      }
    }

    if (dto.allergies !== undefined) {
      data.allergies = cleanList(dto.allergies);
      changed.add('allergies');
    }

    if (dto.treatments !== undefined) {
      const text = dto.treatments.trim();
      data.treatmentsEnc = text ? this.crypto.encrypt(text) : null;
      changed.add('treatments');
    }

    if (dto.emergencyName !== undefined || dto.emergencyPhone !== undefined) {
      const name = dto.emergencyName !== undefined ? dto.emergencyName.trim() : (p.emergencyName ?? '');
      const phone = dto.emergencyPhone !== undefined ? (dto.emergencyPhone ? normalizePhone(dto.emergencyPhone) : '') : (p.emergencyPhone ?? '');
      if (phone && phone === (await this.ownPhone(user.id))) throw new BadRequestException('Indiquez le numéro d’un proche, pas le vôtre.');
      if (phone && !name) throw new BadRequestException('Indiquez le nom de la personne à prévenir.');
      data.emergencyName = name || null;
      data.emergencyPhone = phone || null;
      changed.add('emergency');
    }

    await this.prisma.$transaction(async (tx) => {
      if (Object.keys(data).length) await tx.patient.update({ where: { id: p.id }, data });
      if (Object.keys(userData).length) await tx.user.update({ where: { id: user.id }, data: userData });
      if (dto.conditionsRemove?.length) {
        // La personne ne retire que ce qu'elle a déclaré : un diagnostic posé par un soignant reste.
        const r = await tx.condition.deleteMany({ where: { id: { in: dto.conditionsRemove }, patientId: p.id, code: DECLARED } });
        if (r.count) changed.add('conditions');
      }
      const labels = cleanList(dto.conditionsAdd, 10);
      if (labels.length) {
        const existing = await tx.condition.findMany({ where: { patientId: p.id }, select: { labelEnc: true } });
        const known = new Set(existing.map((c) => (this.crypto.decrypt(c.labelEnc) ?? '').toLocaleLowerCase('fr')));
        const fresh = labels.filter((l) => !known.has(l.toLocaleLowerCase('fr')));
        if (fresh.length) {
          await tx.condition.createMany({ data: fresh.map((l) => ({ patientId: p.id, code: DECLARED, labelEnc: this.crypto.encrypt(l)!, sensitive: false })) });
          changed.add('conditions');
        }
      }
    });

    if (changed.size) {
      await this.audit.log({
        actor: user,
        patientId: p.id,
        action: 'PROFILE',
        resource: `Profil mis à jour : ${[...changed].map((k) => FIELD_LABEL[k]).join(', ')}`,
        ip,
      });
    }
    return this.get(user);
  }

  /** Langue de la personne (SMS, voix). Sans session : rien à enregistrer, la langue reste dans le cookie. */
  async setLang(user: AuthUser | undefined, lang: string) {
    if (!user) return { saved: false, lang };
    await this.prisma.user.update({ where: { id: user.id }, data: { lang: toLang(lang as UiLang) } });
    return { saved: true, lang };
  }

  /** Fin de l'accueil après inscription (même si des étapes ont été passées). */
  async done(user: AuthUser) {
    if (!user.patientId) return { done: true };
    const p = await this.prisma.patient.update({ where: { id: user.patientId }, data: { profileDoneAt: new Date() }, select: { profileDoneAt: true } });
    return { done: true, profileDoneAt: p.profileDoneAt };
  }

  /**
   * Groupe sanguin et allergies vérifiés par un soignant (consentement ou équipe de soins) :
   * la source devient « VERIFIE », la personne ne peut plus remplacer ce groupe par une déclaration.
   */
  async verifyVitals(user: AuthUser, patientId: string, dto: VitalsDto, ip?: string) {
    if (!CLINICAL_ROLES.includes(user.role)) throw new ForbiddenException('Réservé aux soignants');
    if (!dto.bloodGroup && !dto.allergies) throw new BadRequestException('Indiquez le groupe sanguin ou les allergies.');
    await this.access.assert(user, patientId, 'summary', 'Groupe sanguin et allergies', ip);
    const before = await this.prisma.patient.findUniqueOrThrow({ where: { id: patientId }, select: { userId: true, bloodGroup: true } });
    const data: Prisma.PatientUpdateInput = {};
    const what: string[] = [];
    if (dto.bloodGroup) {
      data.bloodGroup = dto.bloodGroup;
      data.bloodGroupSource = 'VERIFIE';
      what.push(`groupe sanguin vérifié (${dto.bloodGroup})`);
    }
    if (dto.allergies) {
      data.allergies = cleanList(dto.allergies);
      what.push('allergies vérifiées');
    }
    const p = await this.prisma.patient.update({
      where: { id: patientId },
      data,
      select: { bloodGroup: true, bloodGroupSource: true, allergies: true },
    });
    await this.audit.log({ actor: user, patientId, action: 'WRITE', resource: what.join(', ').replace(/^./, (c) => c.toUpperCase()), ip });
    if (before.userId && dto.bloodGroup) {
      const owner = await this.prisma.user.findUnique({ where: { id: before.userId }, select: { lang: true } });
      const en = owner?.lang === 'en';
      await this.notifications.notify(before.userId, {
        kind: 'PROFIL',
        title: en ? 'Blood group verified' : 'Groupe sanguin vérifié',
        body: en ? `${user.name} confirmed your blood group: ${dto.bloodGroup}.` : `${user.name} a confirmé votre groupe sanguin : ${dto.bloodGroup}.`,
        href: '/app/profil',
      });
    }
    return p;
  }

  private async ownPhone(userId: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { phone: true } });
    return u?.phone ?? null;
  }
}
