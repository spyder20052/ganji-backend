import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { User } from '@prisma/client';
import { AuditService } from '../common/audit.service';
import { AuthUser, CLINICAL_ROLES } from '../common/auth-user';
import { CryptoService } from '../common/crypto.service';
import { OutboxService } from '../common/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { normalizePhone, RegisterDto } from './auth.dto';

const OTP_TTL_MS = 5 * 60_000;
const OTP_MAX_ATTEMPTS = 5;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly crypto: CryptoService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  get demoMode() {
    return process.env.DEMO_MODE === 'true';
  }

  /** Envoie un code à usage unique. Réponse identique que le numéro existe ou non (pas d'énumération). */
  async requestOtp(rawPhone: string) {
    const phone = normalizePhone(rawPhone);
    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (user) {
      const recent = await this.prisma.otpCode.count({
        where: { userId: user.id, createdAt: { gt: new Date(Date.now() - 10 * 60_000) } },
      });
      if (recent >= 3) throw new BadRequestException('Trop de codes demandés. Réessayez dans 10 minutes.');
      const code = this.crypto.otp();
      await this.prisma.otpCode.create({
        data: { userId: user.id, codeHash: this.crypto.hmac(`otp:${code}`), expiresAt: new Date(Date.now() + OTP_TTL_MS) },
      });
      await this.outbox.send({
        channel: 'SMS',
        to: phone,
        lang: user.lang,
        body: `Ganji : votre code de connexion est ${code}. Il expire dans 5 minutes. Ne le communiquez à personne.`,
        ref: 'otp',
      });
    }
    return { sent: true, expiresInSeconds: OTP_TTL_MS / 1000, simulator: this.demoMode };
  }

  async verifyOtp(rawPhone: string, code: string, ip?: string) {
    const phone = normalizePhone(rawPhone);
    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user) throw new UnauthorizedException('Code invalide ou expiré');
    const otp = await this.prisma.otpCode.findFirst({
      where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp || otp.attempts >= OTP_MAX_ATTEMPTS) throw new UnauthorizedException('Code invalide ou expiré');
    if (!this.crypto.safeEqual(otp.codeHash, this.crypto.hmac(`otp:${code}`))) {
      await this.prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      throw new UnauthorizedException(`Code incorrect (${OTP_MAX_ATTEMPTS - otp.attempts - 1} essai(s) restant(s))`);
    }
    await this.prisma.otpCode.update({ where: { id: otp.id }, data: { usedAt: new Date() } });
    if (!user.demoPersona) {
      await this.outbox.send({
        channel: 'SMS',
        to: phone,
        body: "Ganji : nouvelle connexion à votre compte. Si ce n'est pas vous, appelez le relais de votre commune.",
        ref: 'login-alert',
      });
    }
    return this.openSession(user, ip);
  }

  async register(dto: RegisterDto) {
    const phone = normalizePhone(dto.phone);
    const npiHash = this.crypto.hashNpi(dto.npi);
    const existing = await this.prisma.user.findFirst({ where: { OR: [{ phone }, { npiHash }] } });
    if (existing) throw new BadRequestException('Un compte existe déjà pour ce NPI ou ce numéro. Connectez-vous.');
    const commune = dto.commune ? await this.prisma.commune.findUnique({ where: { name: dto.commune } }) : null;
    await this.prisma.user.create({
      data: {
        role: 'PATIENT',
        displayName: `${dto.firstName} ${dto.lastName}`,
        phone,
        npiHash,
        npiLast4: dto.npi.slice(-4),
        patient: {
          create: {
            firstName: dto.firstName,
            lastName: dto.lastName,
            birthDate: new Date(dto.birthDate),
            sex: dto.sex,
            communeId: commune?.id,
          },
        },
      },
    });
    return this.requestOtp(phone);
  }

  async demoLogin(persona: string, ip?: string) {
    if (!this.demoMode) throw new NotFoundException();
    const user = await this.prisma.user.findUnique({ where: { demoPersona: persona } });
    if (!user) throw new NotFoundException('Persona inconnue');
    return this.openSession(user, ip);
  }

  async listPersonas() {
    if (!this.demoMode) return [];
    return this.prisma.user.findMany({
      where: { demoPersona: { not: null } },
      select: { demoPersona: true, displayName: true, role: true, lang: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async toAuthUser(user: User): Promise<AuthUser> {
    const [patient, practitioner] = await Promise.all([
      this.prisma.patient.findUnique({ where: { userId: user.id }, select: { id: true } }),
      this.prisma.practitioner.findUnique({ where: { userId: user.id }, select: { id: true, facilityId: true } }),
    ]);
    return {
      id: user.id,
      role: user.role,
      name: user.displayName,
      patientId: patient?.id ?? null,
      practitionerId: practitioner?.id ?? null,
      facilityId: practitioner?.facilityId ?? null,
    };
  }

  private async openSession(user: User, ip?: string) {
    const auth = await this.toAuthUser(user);
    const clinical = CLINICAL_ROLES.includes(user.role) || user.role === 'PHARMACIST';
    const ttlSeconds = clinical ? 30 * 60 : 7 * 24 * 3600;
    const { id, ...rest } = auth;
    const token = await this.jwt.signAsync({ sub: id, ...rest }, { expiresIn: ttlSeconds });
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.log({ actor: auth, action: 'LOGIN', resource: 'session', ip });
    return { token, ttlSeconds, user: await this.me(auth) };
  }

  async me(auth: AuthUser) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: auth.id },
      select: { id: true, role: true, displayName: true, lang: true, simpleMode: true, npiLast4: true, phone: true, demoPersona: true },
    });
    const practitioner = auth.practitionerId
      ? await this.prisma.practitioner.findUnique({
          where: { id: auth.practitionerId },
          select: { title: true, specialty: true, verifiedAt: true, facility: { select: { id: true, name: true, shortName: true } } },
        })
      : null;
    const delegations = await this.prisma.delegation.findMany({
      where: { caregiverId: auth.id, revokedAt: null },
      select: { relation: true, scopes: true, patient: { select: { id: true, firstName: true, lastName: true } } },
    });
    return {
      ...user,
      phone: user.phone ? `${user.phone.slice(0, 4)}••••${user.phone.slice(-2)}` : null,
      patientId: auth.patientId,
      practitioner,
      facilityId: auth.facilityId,
      delegations,
    };
  }
}
