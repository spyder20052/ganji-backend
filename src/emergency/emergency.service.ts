import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import { AuthUser } from '../common/auth-user';
import { CryptoService } from '../common/crypto.service';
import { sms } from '../common/i18n';
import { PrismaService } from '../prisma/prisma.service';
import { BreakGlassDto, SosDto } from './emergency.dto';
import { Origin, Recipient, RespondersService } from './responders.service';

/** Durée d'un accès en bris de glace. */
const BREAK_GLASS_HOURS = 12;
const BREAK_GLASS_SCOPES = ['summary', 'timeline', 'observations', 'documents', 'prescriptions'];
/** Le patient est prévenu au plus une fois par heure qu'on a lu sa carte d'urgence. */
const CARD_NOTICE_INTERVAL_MS = 3600_000;

function age(birth: Date, now = new Date()) {
  let a = now.getFullYear() - birth.getFullYear();
  if (now < new Date(now.getFullYear(), birth.getMonth(), birth.getDate())) a--;
  return a;
}

/** Numéro et langue du titulaire du carnet, ou de son parent pour un enfant. */
type Contact = { phone: string | null; lang: Recipient['lang'] } | null;
function holderContact(p: { user: Contact; parent: { user: Contact } | null }): Recipient | null {
  const holder = p.user?.phone ? p.user : (p.parent?.user ?? null);
  return holder?.phone ? { to: holder.phone, lang: holder.lang } : null;
}

const HOLDER_SELECT = {
  user: { select: { phone: true, lang: true } },
  parent: { select: { user: { select: { phone: true, lang: true } } } },
} as const;

@Injectable()
export class EmergencyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
    private readonly responders: RespondersService,
  ) {}

  /**
   * Carte d'urgence lue par QR, sans compte : le strict nécessaire pour les
   * secours. Aucune pathologie n'est exposée (ni sensible, ni autre). Les
   * traitements en cours sont ceux que le patient a choisi d'inscrire sur sa carte.
   */
  async card(qrToken: string, viewer: AuthUser | undefined, ip?: string) {
    const patient = qrToken.length <= 100
      ? await this.prisma.patient.findUnique({
          where: { qrToken },
          include: { commune: { select: { name: true } }, ...HOLDER_SELECT },
        })
      : null;
    if (!patient) throw new NotFoundException("Carte d'urgence introuvable");

    await this.audit.log({
      actor: viewer ?? null,
      patientId: patient.id,
      action: 'EMERGENCY_CARD',
      resource: "Carte d'urgence",
      reason: "Carte d'urgence scannée",
      ip,
    });

    const ref = `emergency-card:${patient.id}`;
    const recentNotice = await this.prisma.outbox.findFirst({
      where: { ref, createdAt: { gte: new Date(Date.now() - CARD_NOTICE_INTERVAL_MS) } },
      select: { id: true },
    });
    const holder = holderContact(patient);
    if (!recentNotice && holder) {
      await this.responders.notify([holder], (lang) => sms('emergency.cardRead', lang), ref);
    }

    return {
      name: `${patient.firstName} ${patient.lastName.charAt(0)}.`,
      firstName: patient.firstName,
      lastNameInitial: patient.lastName.charAt(0),
      age: age(patient.birthDate),
      sex: patient.sex,
      bloodGroup: patient.bloodGroup,
      allergies: patient.allergies,
      treatments: this.crypto.decrypt(patient.treatmentsEnc),
      emergencyContact: patient.emergencyName || patient.emergencyPhone ? { name: patient.emergencyName, phone: patient.emergencyPhone } : null,
      commune: patient.commune?.name ?? null,
      notice: "Informations vitales partagées par le patient pour les secours. Cette consultation est enregistrée et le patient en est informé.",
    };
  }

  /**
   * Bris de glace : accès exceptionnel de 12 h au dossier (hors compartiment
   * sensible), motivé, journalisé, notifié au patient, à ses aidants et au contrôle.
   */
  async breakGlass(user: AuthUser, dto: BreakGlassDto, ip?: string) {
    if (!dto.patientId && !dto.qrToken) throw new BadRequestException('Indiquez le patient : identifiant ou QR de sa carte');
    const patient = await this.prisma.patient.findFirst({
      where: dto.patientId ? { id: dto.patientId } : { qrToken: dto.qrToken },
      select: { id: true, ...HOLDER_SELECT },
    });
    if (!patient) throw new NotFoundException('Patient introuvable');

    const now = new Date();
    const consent = await this.prisma.consent.create({
      data: {
        patientId: patient.id,
        granteeId: user.id,
        granteeName: user.name,
        source: 'BREAK_GLASS',
        scopes: BREAK_GLASS_SCOPES,
        expiresAt: new Date(now.getTime() + BREAK_GLASS_HOURS * 3600_000),
        redeemedAt: now,
      },
    });
    await this.audit.log({ actor: user, patientId: patient.id, action: 'BREAK_GLASS', resource: 'Dossier (accès en urgence)', reason: dto.reason, ip });

    const holder = holderContact(patient);
    const family = [...(holder ? [holder] : []), ...(await this.responders.caregivers(patient.id))];
    await this.responders.notify(family, (lang) => sms('emergency.breakGlass', lang, { name: user.name }), `break-glass:${consent.id}`);

    // Contrôle a posteriori : chaque bris de glace est signalé aux administrateurs.
    const controllers = await this.prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true, phone: true, lang: true } });
    await this.responders.notify(
      controllers.map((c) => (c.phone ? { to: c.phone, lang: c.lang } : { to: c.id, lang: c.lang, channel: 'PUSH' as const })),
      (lang) => sms('emergency.breakGlass.control', lang, { name: user.name }),
      `break-glass:${consent.id}`,
    );

    return { patientId: patient.id, expiresAt: consent.expiresAt, scopes: consent.scopes };
  }

  /** Bouton SOS du patient : prévient ses proches et les relais, indique les urgences ouvertes. */
  async sos(user: AuthUser, dto: SosDto, ip?: string) {
    if (!user.patientId) throw new ForbiddenException('Réservé au titulaire du carnet');
    const patient = await this.prisma.patient.findUniqueOrThrow({
      where: { id: user.patientId },
      select: { id: true, firstName: true, emergencyPhone: true, communeId: true, commune: { select: { lat: true, lng: true } } },
    });

    const position: Origin | null = dto.lat !== undefined && dto.lng !== undefined ? { lat: dto.lat, lng: dto.lng } : null;
    let url: string | null = null;
    if (position) {
      const lat = position.lat.toFixed(5);
      const lng = position.lng.toFixed(5);
      url = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
    }
    const body = (lang: Recipient['lang']) => (url ? sms('emergency.sos.position', lang, { prenom: patient.firstName, url }) : sms('emergency.sos', lang, { prenom: patient.firstName }));

    const recipients: Recipient[] = [
      ...(patient.emergencyPhone ? [{ to: patient.emergencyPhone, lang: 'fr' as const }] : []),
      ...(await this.responders.caregivers(patient.id)),
      ...(await this.responders.relays(patient.communeId)),
    ];
    const notified = await this.responders.notify(recipients, body, `sos:${patient.id}`);
    await this.audit.log({ actor: user, patientId: patient.id, action: 'SOS', resource: 'Alerte SOS', reason: `${notified} contact(s) prévenu(s)`, ip });

    const places = await this.responders.nearestOpen('urgences', position ?? patient.commune);
    return { notified, places };
  }
}
