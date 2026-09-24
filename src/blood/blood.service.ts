import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessService } from '../common/access.service';
import { AuditService } from '../common/audit.service';
import { AuthUser, CLINICAL_ROLES } from '../common/auth-user';
import { CryptoService } from '../common/crypto.service';
import { canDonate, compatibleDonorGroups, distanceKm } from '../common/geo';
import { OutboxService } from '../common/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBloodRequestDto } from './blood.dto';

const PRODUCT_LABEL: Record<string, string> = { CGR: 'globules rouges', PLAQUETTES: 'plaquettes', PLASMA: 'plasma' };
const DONOR_RADIUS_KM = 40;
const MAX_ALERTS = 14;

function fmtDate(d: Date) {
  return d.toLocaleString('fr-FR', { timeZone: 'Africa/Porto-Novo', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}

/** Prochain créneau de collecte : demain 8 h, 9 h, 10 h… (heure de Cotonou, UTC+1). */
function nextSlot(index: number, now = new Date()) {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(7 + Math.min(index, 8), 0, 0, 0);
  return d;
}

@Injectable()
export class BloodService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly crypto: CryptoService,
  ) {}

  async stocks() {
    const sites = await this.prisma.facility.findMany({
      where: { type: 'TRANSFUSION' },
      include: { bloodStock: true, commune: { select: { name: true, departmentCode: true } } },
      orderBy: { name: 'asc' },
    });
    return sites.map((s) => ({
      id: s.id,
      name: s.name,
      shortName: s.shortName,
      lat: s.lat,
      lng: s.lng,
      commune: s.commune.name,
      department: s.commune.departmentCode,
      total: s.bloodStock.reduce((n, x) => n + x.units, 0),
      stock: s.bloodStock.map((x) => ({ product: x.product, bloodGroup: x.bloodGroup, units: x.units })),
      updatedAt: s.bloodStock.reduce<Date | null>((m, x) => (!m || x.updatedAt > m ? x.updatedAt : m), null),
    }));
  }

  async updateStock(user: AuthUser, siteId: string, product: string, bloodGroup: string, units: number) {
    if (user.role !== 'BLOOD_BANK' || (user.facilityId && user.facilityId !== siteId)) {
      throw new ForbiddenException('Seul le site de transfusion concerné peut modifier son stock');
    }
    const row = await this.prisma.bloodStock.upsert({
      where: { siteId_product_bloodGroup: { siteId, product, bloodGroup } },
      update: { units },
      create: { siteId, product, bloodGroup, units },
    });
    await this.audit.log({ actor: user, action: 'WRITE', resource: `Stock ${product} ${bloodGroup} = ${units}` });
    return row;
  }

  async create(user: AuthUser, dto: CreateBloodRequestDto, ip?: string) {
    if (!CLINICAL_ROLES.includes(user.role)) throw new ForbiddenException('Réservé aux soignants');
    await this.access.assert(user, dto.patientId, 'summary', 'Demande de produit sanguin', ip);
    const patient = await this.prisma.patient.findUniqueOrThrow({ where: { id: dto.patientId } });
    const bloodGroup = dto.bloodGroup ?? patient.bloodGroup;
    if (!bloodGroup) throw new BadRequestException('Groupe sanguin inconnu : précisez-le');
    const facilityId = user.facilityId ?? dto.facilityId;
    if (!facilityId) throw new BadRequestException('Établissement demandeur inconnu');
    const facility = await this.prisma.facility.findUniqueOrThrow({ where: { id: facilityId } });

    const request = await this.prisma.bloodRequest.create({
      data: {
        patientId: patient.id,
        requesterId: user.id,
        requesterName: user.name,
        facilityId,
        product: dto.product,
        bloodGroup,
        quantity: dto.quantity,
        urgency: dto.urgency,
        neededBy: dto.neededBy ? new Date(dto.neededBy) : new Date(Date.now() + 24 * 3600_000),
      },
    });
    await this.audit.log({ actor: user, patientId: patient.id, action: 'WRITE', resource: `Demande ${dto.quantity} ${PRODUCT_LABEL[dto.product]} ${bloodGroup}`, ip });

    const stockCheck = await this.stockCheck(dto.product, bloodGroup, facility.lat, facility.lng);
    let alerted = 0;
    if (stockCheck.nearbyUnits < dto.quantity) {
      alerted = (await this.alertDonors(user, request.id)).alerted;
    }
    return { ...(await this.get(user, request.id)), stockCheck, autoAlerted: alerted };
  }

  /** Stocks compatibles, du site le plus proche au plus lointain. */
  async stockCheck(product: string, recipientGroup: string, lat: number, lng: number) {
    const groups = compatibleDonorGroups(recipientGroup);
    const rows = await this.prisma.bloodStock.findMany({
      where: { product, bloodGroup: { in: groups }, units: { gt: 0 } },
      include: { site: { select: { id: true, name: true, shortName: true, lat: true, lng: true } } },
    });
    const bySite = new Map<string, { site: string; distanceKm: number; units: number; groups: string[] }>();
    for (const r of rows) {
      const key = r.site.id;
      const cur = bySite.get(key) ?? { site: r.site.shortName ?? r.site.name, distanceKm: distanceKm(lat, lng, r.site.lat, r.site.lng), units: 0, groups: [] };
      cur.units += r.units;
      cur.groups.push(`${r.bloodGroup}:${r.units}`);
      bySite.set(key, cur);
    }
    const sites = [...bySite.values()].sort((a, b) => a.distanceKm - b.distanceKm);
    const nearbyUnits = sites.filter((s) => s.distanceKm <= 60).reduce((n, s) => n + s.units, 0);
    return { compatibleGroups: groups, nearbyUnits, sites };
  }

  async alertDonors(user: AuthUser, requestId: string) {
    const req = await this.prisma.bloodRequest.findUnique({ where: { id: requestId }, include: { facility: true, alerts: true } });
    if (!req) throw new NotFoundException('Demande introuvable');
    if (req.requesterId !== user.id && user.role !== 'BLOOD_BANK') throw new ForbiddenException();
    if (!['OUVERTE', 'DONNEURS_ALERTES'].includes(req.status)) throw new BadRequestException('Demande déjà servie ou clôturée');

    const groups = compatibleDonorGroups(req.bloodGroup);
    const already = new Set(req.alerts.map((a) => a.donorId));
    const candidates = await this.prisma.donor.findMany({ where: { bloodGroup: { in: groups }, available: true } });
    const now = new Date();
    const chosen = candidates
      .filter((d) => !already.has(d.id) && canDonate(d.lastDonationAt, d.sex, now))
      .map((d) => ({ d, km: distanceKm(req.facility.lat, req.facility.lng, d.lat, d.lng) }))
      .filter((x) => x.km <= DONOR_RADIUS_KM)
      .sort((a, b) => a.km - b.km)
      .slice(0, MAX_ALERTS);

    const place = req.facility.shortName ?? req.facility.name;
    for (const { d, km } of chosen) {
      const channel = d.hasSmartphone ? 'APP' : d.lang !== 'fr' ? 'VOICE' : 'SMS';
      const alert = await this.prisma.donorAlert.create({ data: { requestId: req.id, donorId: d.id, distanceKm: km, channel } });
      await this.outbox.send({
        channel: 'SMS',
        to: d.phone,
        lang: d.lang,
        audioKey: 'donor.call',
        ref: `donor-alert:${alert.id}`,
        body: `Alafia : ${d.firstName}, votre don de sang ${req.bloodGroup === d.bloodGroup ? `(${d.bloodGroup})` : `(${d.bloodGroup}, compatible)`} peut sauver une vie à ${place}, à ${Math.round(km)} km. Répondez 1 pour OUI ou 2 pour NON.`,
      });
      if (!d.hasSmartphone && d.lang !== 'fr') {
        await this.outbox.send({ channel: 'VOICE', to: d.phone, lang: d.lang, audioKey: 'donor.call', ref: `donor-alert:${alert.id}`, body: `Appel vocal (${d.lang}) : appel au don de sang à ${place}. Tapez 1 pour oui, 2 pour non.` });
      }
    }
    if (chosen.length) await this.prisma.bloodRequest.update({ where: { id: req.id }, data: { status: 'DONNEURS_ALERTES' } });
    return { alerted: chosen.length };
  }

  /** Réponse d'un donneur (application, SMS ou USSD). */
  async respond(alertId: string, accept: boolean, via: 'APP' | 'SMS' | 'USSD' = 'APP') {
    const alert = await this.prisma.donorAlert.findUnique({ where: { id: alertId }, include: { donor: true, request: { include: { facility: true, patient: true } } } });
    if (!alert) throw new NotFoundException('Appel introuvable');
    if (alert.status !== 'ENVOYEE') return { status: alert.status, appointment: alert.appointment };
    const req = alert.request;
    const place = req.facility.shortName ?? req.facility.name;

    if (!accept) {
      await this.prisma.donorAlert.update({ where: { id: alert.id }, data: { status: 'REFUSEE', respondedAt: new Date() } });
      await this.outbox.send({ channel: 'SMS', to: alert.donor.phone, body: 'Alafia : merci de votre réponse. Nous vous solliciterons une autre fois.', ref: `donor-alert:${alert.id}` });
      return { status: 'REFUSEE' };
    }

    const accepted = await this.prisma.donorAlert.count({ where: { requestId: req.id, status: 'ACCEPTEE' } });
    const appointment = nextSlot(accepted);
    await this.prisma.donorAlert.update({ where: { id: alert.id }, data: { status: 'ACCEPTEE', respondedAt: new Date(), appointment } });
    // Premier « oui » : la demande passe à « donneur trouvé » (les suivants complètent la quantité).
    await this.prisma.bloodRequest.update({ where: { id: req.id }, data: { status: 'DONNEUR_TROUVE' } });
    await this.outbox.send({
      channel: 'SMS',
      to: alert.donor.phone,
      audioKey: 'donor.thanks',
      ref: `donor-alert:${alert.id}`,
      body: `Alafia : merci ${alert.donor.firstName} ! Rendez-vous ${fmtDate(appointment)} à ${place}, service de transfusion. Venez avec une pièce d'identité, après avoir mangé.`,
    });
    // Famille : message vocal dans sa langue (parcours Afiavi) + SMS, sans donnée médicale.
    const family = await this.prisma.delegation.findMany({ where: { patientId: req.patientId, revokedAt: null }, include: { caregiver: true } });
    for (const f of family) {
      if (!f.caregiver.phone) continue;
      await this.outbox.send({ channel: 'SMS', to: f.caregiver.phone, lang: f.caregiver.lang, audioKey: 'donor.found', ref: `blood-request:${req.id}`, body: `Alafia : bonne nouvelle, un donneur a été trouvé pour ${req.patient.firstName}. Don prévu ${fmtDate(appointment)} à ${place}.` });
      if (f.caregiver.lang !== 'fr') {
        await this.outbox.send({ channel: 'VOICE', to: f.caregiver.phone, lang: f.caregiver.lang, audioKey: 'donor.found', ref: `blood-request:${req.id}`, body: `Message vocal (${f.caregiver.lang}) : un donneur est trouvé pour ${req.patient.firstName}, rendez-vous ${fmtDate(appointment)}.` });
      }
    }
    await this.audit.log({ patientId: req.patientId, action: 'DONOR_FOUND', resource: `Donneur ${alert.donor.bloodGroup} à ${alert.distanceKm} km (réponse ${via})` });
    return { status: 'ACCEPTEE', appointment, place };
  }

  async list(user: AuthUser) {
    const delegated = await this.prisma.delegation.findMany({
      where: { caregiverId: user.id, revokedAt: null, OR: [{ scopes: { has: 'blood' } }, { scopes: { has: 'all' } }] },
      select: { patientId: true },
    });
    const ownIds = [...(user.patientId ? [user.patientId] : []), ...delegated.map((d) => d.patientId)];
    const where =
      user.role === 'BLOOD_BANK' || user.role === 'MINISTRY'
        ? {}
        : CLINICAL_ROLES.includes(user.role)
          ? { requesterId: user.id }
          : { patientId: { in: ownIds } };
    const rows = await this.prisma.bloodRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { facility: { select: { shortName: true, name: true } }, patient: { select: { firstName: true, lastName: true } }, alerts: { select: { status: true } } },
    });
    return rows.map((r) => this.shape(r));
  }

  async get(user: AuthUser, id: string) {
    const r = await this.prisma.bloodRequest.findUnique({
      where: { id },
      include: {
        facility: { select: { shortName: true, name: true, lat: true, lng: true } },
        patient: { select: { firstName: true, lastName: true, userId: true } },
        alerts: { include: { donor: { select: { firstName: true, bloodGroup: true, city: true } } }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!r) throw new NotFoundException('Demande introuvable');
    const allowed =
      r.requesterId === user.id || user.role === 'BLOOD_BANK' || user.role === 'MINISTRY' || r.patient.userId === user.id || (await this.access.decide(user, r.patientId, 'summary')).allowed;
    if (!allowed) throw new ForbiddenException();
    return {
      ...this.shape(r),
      donors: r.alerts.map((a) => ({
        id: a.id,
        firstName: a.donor.firstName,
        bloodGroup: a.donor.bloodGroup,
        city: a.donor.city,
        distanceKm: a.distanceKm,
        channel: a.channel,
        status: a.status,
        appointment: a.appointment,
      })),
    };
  }

  async markServed(user: AuthUser, id: string) {
    const r = await this.prisma.bloodRequest.findUnique({ where: { id }, include: { facility: true } });
    if (!r) throw new NotFoundException();
    if (r.requesterId !== user.id && user.role !== 'BLOOD_BANK') throw new ForbiddenException();
    await this.prisma.bloodRequest.update({ where: { id }, data: { status: 'SERVIE' } });
    await this.prisma.encounter.create({
      data: {
        patientId: r.patientId,
        type: 'TRANSFUSION',
        date: new Date(),
        facilityName: r.facility.shortName ?? r.facility.name,
        authorName: user.name,
        summaryEnc: this.crypto.encrypt(`Transfusion de ${r.quantity} poche${r.quantity > 1 ? 's' : ''} de ${PRODUCT_LABEL[r.product]} (${r.bloodGroup}).`),
      },
    });
    await this.audit.log({ actor: user, patientId: r.patientId, action: 'WRITE', resource: `Transfusion tracée (${r.quantity} ${PRODUCT_LABEL[r.product]})` });
    return { ok: true };
  }

  /** Espace donneur : appels reçus. */
  async myAlerts(user: AuthUser) {
    const donor = await this.prisma.donor.findUnique({ where: { userId: user.id } });
    if (!donor) return { donor: null, alerts: [] };
    const alerts = await this.prisma.donorAlert.findMany({
      where: { donorId: donor.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { request: { select: { bloodGroup: true, product: true, urgency: true, neededBy: true, facility: { select: { shortName: true, name: true } } } } },
    });
    return {
      donor: { firstName: donor.firstName, bloodGroup: donor.bloodGroup, donations: donor.donations, lastDonationAt: donor.lastDonationAt, canDonate: canDonate(donor.lastDonationAt, donor.sex) },
      alerts: alerts.map((a) => ({
        id: a.id,
        status: a.status,
        distanceKm: a.distanceKm,
        appointment: a.appointment,
        place: a.request.facility.shortName ?? a.request.facility.name,
        product: PRODUCT_LABEL[a.request.product],
        urgency: a.request.urgency,
        neededBy: a.request.neededBy,
      })),
    };
  }

  async respondAsUser(user: AuthUser, alertId: string, accept: boolean) {
    const donor = await this.prisma.donor.findUnique({ where: { userId: user.id } });
    const alert = await this.prisma.donorAlert.findUnique({ where: { id: alertId } });
    if (!donor || !alert || alert.donorId !== donor.id) throw new NotFoundException('Appel introuvable');
    return this.respond(alertId, accept, 'APP');
  }

  private shape(r: {
    id: string; patientId: string; product: string; bloodGroup: string; quantity: number; urgency: string; status: string; neededBy: Date; createdAt: Date; requesterName: string;
    facility: { shortName: string | null; name: string }; patient: { firstName: string; lastName: string }; alerts: { status: string }[];
  }) {
    return {
      id: r.id,
      patientId: r.patientId,
      product: r.product,
      productLabel: PRODUCT_LABEL[r.product],
      bloodGroup: r.bloodGroup,
      quantity: r.quantity,
      urgency: r.urgency,
      status: r.status,
      neededBy: r.neededBy,
      createdAt: r.createdAt,
      requester: r.requesterName,
      facility: r.facility.shortName ?? r.facility.name,
      patient: `${r.patient.firstName} ${r.patient.lastName.charAt(0)}.`,
      counts: {
        alerted: r.alerts.length,
        accepted: r.alerts.filter((a) => a.status === 'ACCEPTEE').length,
        declined: r.alerts.filter((a) => a.status === 'REFUSEE').length,
        waiting: r.alerts.filter((a) => a.status === 'ENVOYEE').length,
      },
    };
  }
}
