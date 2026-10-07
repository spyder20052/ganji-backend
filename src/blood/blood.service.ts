import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Donor } from '@prisma/client';
import { AccessService } from '../common/access.service';
import { AuditService } from '../common/audit.service';
import { AuthUser, CLINICAL_ROLES } from '../common/auth-user';
import { CryptoService } from '../common/crypto.service';
import { compatibleDonorGroups, distanceKm } from '../common/geo';
import { NotificationsService } from '../common/notifications.service';
import { shortName } from '../common/names';
import { OutboxService } from '../common/outbox.service';
import { note, plural, sms, text, type Var, type Vars } from '../common/i18n';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBloodRequestDto, DonorProfileDto } from './blood.dto';
import { donorChannel, FINAL_STATUSES, NEEDS_BLOOD, nextSlot, SERVABLE, wantsVoice } from './blood.logic';
import { dayIn, PRODUCT_LABEL, productIn, urgencyIn, whenIn } from './blood.sms';
import {
  ageOn, boundingBox, canDonateNow, type Contraindication, contraindicationOf, coverage, eligibility, MAX_AGE, MIN_AGE, NEARBY_KM, nextDonationDate, pickByRadius, planStockDraw, RADIUS_STEPS, REST_DAYS,
} from './eligibility';

const MAX_ALERTS = 14;
/** Stock « proche » d'un hôpital : sites de transfusion à moins de 60 km. */
const STOCK_RADIUS_KM = 60;
/** Échéance par défaut d'une demande sans date : le lendemain à la même heure. */
const DEFAULT_NEEDED_BY_MS = 24 * 3600_000;
/** Une demande dont l'échéance est passée depuis plus de six heures n'est plus proposée aux donneurs. */
const NEARBY_GRACE_MS = 6 * 3600_000;
const URGENCY_RANK: Record<string, number> = { VITALE: 0, URGENTE: 1, PROGRAMMEE: 2 };

const INELIGIBLE_MESSAGE: Record<string, string> = {
  TOO_YOUNG: 'Il faut avoir au moins 18 ans pour donner son sang.',
  TOO_OLD: 'Au-delà de 60 ans, le don n’est plus possible. Merci de votre générosité !',
  WEIGHT: 'Il faut peser au moins 50 kg pour donner son sang. Merci de votre générosité !',
  PREGNANCY: 'Pas de don de sang pendant la grossesse. Vos proches peuvent donner.',
  CONDITION: 'Votre santé ne permet pas le don pour le moment. Vos proches peuvent donner pour vous.',
};
/** Ce qu'il faut du carnet d'un donneur relié à un compte pour vérifier qu'il peut donner. */
const DONOR_HEALTH = {
  user: { select: { patient: { select: { birthDate: true, conditions: { select: { code: true } }, pregnancies: { where: { status: 'EN_COURS' }, select: { id: true } } } } } },
} as const;

type Place = { shortName: string | null; name: string };
const placeOf = (f: Place) => f.shortName ?? f.name;

@Injectable()
export class BloodService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly crypto: CryptoService,
    private readonly notifications: NotificationsService,
  ) {}

  // ─── Stocks ──────────────────────────────────────────────────────

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
    if (user.role !== 'BLOOD_BANK' || !user.facilityId || user.facilityId !== siteId) {
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

  /** Stocks compatibles, du site le plus proche au plus lointain. */
  async stockCheck(product: string, recipientGroup: string, lat: number, lng: number) {
    const groups = compatibleDonorGroups(recipientGroup);
    const rows = await this.prisma.bloodStock.findMany({
      where: { product, bloodGroup: { in: groups }, units: { gt: 0 } },
      include: { site: { select: { id: true, name: true, shortName: true, lat: true, lng: true } } },
    });
    const bySite = new Map<string, { id: string; site: string; distanceKm: number; units: number; groups: string[] }>();
    for (const r of rows) {
      const cur = bySite.get(r.site.id) ?? { id: r.site.id, site: placeOf(r.site), distanceKm: distanceKm(lat, lng, r.site.lat, r.site.lng), units: 0, groups: [] };
      cur.units += r.units;
      cur.groups.push(`${r.bloodGroup}:${r.units}`);
      bySite.set(r.site.id, cur);
    }
    const sites = [...bySite.values()].sort((a, b) => a.distanceKm - b.distanceKm);
    const nearbyUnits = sites.filter((s) => s.distanceKm <= STOCK_RADIUS_KM).reduce((n, s) => n + s.units, 0);
    return { compatibleGroups: groups, nearbyUnits, sites };
  }

  // ─── Demande d'un soignant ───────────────────────────────────────

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
        neededBy: dto.neededBy ? new Date(dto.neededBy) : new Date(Date.now() + DEFAULT_NEEDED_BY_MS),
      },
    });
    await this.audit.log({ actor: user, patientId: patient.id, action: 'WRITE', resource: `Demande ${dto.quantity} ${PRODUCT_LABEL[dto.product]} ${bloodGroup}`, ip });

    // 1. La banque de sang est TOUJOURS prévenue (application + SMS) : elle peut réserver des poches.
    const antsNotified = await this.notifyBloodBank(request.id, { ...request, requester: user.name }, facility);
    // 2. Stocks compatibles proches ; 3. s'ils ne suffisent pas, les donneurs compatibles sont alertés.
    const stockCheck = await this.stockCheck(dto.product, bloodGroup, facility.lat, facility.lng);
    const donors = stockCheck.nearbyUnits < dto.quantity ? await this.alertDonors(user, request.id) : { alerted: 0, radiusKm: null, widened: false, byChannel: { APP: 0, SMS: 0, VOICE: 0 } };
    const view = await this.get(user, request.id);
    return { ...view, stockCheck, autoAlerted: donors.alerted, dispatch: { ...view.dispatch, antsNotified, donorsJustAlerted: donors.alerted, radiusKm: donors.radiusKm, widened: donors.widened } };
  }

  private async notifyBloodBank(requestId: string, r: { quantity: number; product: string; bloodGroup: string; urgency: string; neededBy: Date; requester: string }, facility: Place) {
    const ids = await this.notifications.usersWithRole('BLOOD_BANK');
    const place = placeOf(facility);
    return this.notifications.notify(ids, {
      kind: 'SANG',
      text: (lang) => ({
        title: text('blood.n.ants.title', lang, { group: r.bloodGroup, place }),
        body: plural('blood.n.ants.body', r.quantity, lang, {
          product: (l) => productIn(r.product, l),
          group: r.bloodGroup,
          urgency: (l) => urgencyIn(r.urgency, l),
          when: (l) => whenIn(r.neededBy, l),
          requester: r.requester,
        }),
      }),
      href: `/ants#demande-${requestId}`,
      ref: `blood-request:${requestId}`,
      sms: (lang) => sms('blood.ants.request', lang, { qty: r.quantity, product: (l) => productIn(r.product, l), group: r.bloodGroup, place, urgency: (l) => urgencyIn(r.urgency, l) }),
    });
  }

  /**
   * Alerte les donneurs compatibles, disponibles et en état de donner, du plus proche au plus lointain :
   * 40 km d'abord ; si personne n'y est disponible, 80 km puis 150 km.
   */
  async alertDonors(user: AuthUser, requestId: string) {
    const req = await this.prisma.bloodRequest.findUnique({ where: { id: requestId }, include: { facility: true, alerts: true, patient: { select: { userId: true } } } });
    if (!req) throw new NotFoundException('Demande introuvable');
    if (req.requesterId !== user.id && user.role !== 'BLOOD_BANK') throw new ForbiddenException();
    const cov = coverage(req.quantity, req.alerts.filter((a) => a.status === 'ACCEPTEE').length, req.reservedUnits);
    if (!NEEDS_BLOOD.includes(req.status) || cov.complete) throw new BadRequestException('Demande déjà couverte, servie ou clôturée');

    const groups = compatibleDonorGroups(req.bloodGroup);
    const already = req.alerts.map((a) => a.donorId);
    const candidates = await this.prisma.donor.findMany({
      where: {
        bloodGroup: { in: groups },
        available: true,
        id: { notIn: already },
        // Seulement le carré de 150 km autour de l'hôpital : les distances exactes sont calculées ensuite.
        ...boundingBox(req.facility.lat, req.facility.lng, RADIUS_STEPS[RADIUS_STEPS.length - 1]),
        // Le patient lui-même n'est jamais sollicité pour sa propre demande.
        ...(req.patient.userId ? { OR: [{ userId: null }, { userId: { not: req.patient.userId } }] } : {}),
      },
      include: DONOR_HEALTH,
    });
    const now = new Date();
    const eligible = candidates
      // Repos, âge et carnet (grossesse, maladie qui exclut le don) revérifiés à chaque appel.
      .filter((d) => canDonateNow(d.lastDonationAt, d.sex, d.user?.patient?.birthDate, contraindicationOf(d.user?.patient), now))
      .map((d) => ({ d, km: distanceKm(req.facility.lat, req.facility.lng, d.lat, d.lng) }));
    // On élargit le rayon tant qu'on n'a pas au moins deux donneurs par poche manquante (14 au plus).
    const { chosen, radiusKm } = pickByRadius(eligible, MAX_ALERTS, RADIUS_STEPS, Math.min(MAX_ALERTS, Math.max(1, cov.missing) * 2));

    const place = placeOf(req.facility);
    const byChannel = { APP: 0, SMS: 0, VOICE: 0 };
    for (const { d, km } of chosen) {
      const channel = donorChannel(d);
      byChannel[channel]++;
      const alert = await this.prisma.donorAlert.create({ data: { requestId: req.id, donorId: d.id, distanceKm: km, channel } });
      const group: Var = req.bloodGroup === d.bloodGroup ? d.bloodGroup : (l) => sms('blood.group.compatible', l, { group: d.bloodGroup });
      await this.outbox.send({
        channel: 'SMS',
        to: d.phone,
        lang: d.lang,
        audioKey: 'donor.call',
        ref: `donor-alert:${alert.id}`,
        body: sms('blood.donor.call', d.lang, { name: d.firstName, group, place, km: Math.round(km) }),
      });
      if (wantsVoice(d)) {
        await this.outbox.send({ channel: 'VOICE', to: d.phone, lang: d.lang, audioKey: 'donor.call', ref: `donor-alert:${alert.id}`, body: sms('blood.donor.voice', d.lang, { place }) });
      }
      if (d.userId) {
        await this.notifications.notify(d.userId, {
          kind: 'SANG',
          text: note('blood.n.call.title', 'blood.n.call.body', { place, km: Math.round(km), group: d.bloodGroup }),
          href: '/app/sang',
        });
      }
    }
    if (chosen.length && req.status === 'OUVERTE') await this.prisma.bloodRequest.update({ where: { id: req.id }, data: { status: 'DONNEURS_ALERTES' } });
    return { alerted: chosen.length, radiusKm, widened: radiusKm !== null && radiusKm > RADIUS_STEPS[0], byChannel };
  }

  // ─── Réponse d'un donneur ────────────────────────────────────────

  /** Réponse d'un donneur alerté (application, SMS ou USSD). */
  async respond(alertId: string, accept: boolean, via: 'APP' | 'SMS' | 'USSD' = 'APP') {
    const alert = await this.prisma.donorAlert.findUnique({
      where: { id: alertId },
      include: { donor: true, request: { include: { facility: true, patient: true, alerts: { select: { status: true } } } } },
    });
    if (!alert) throw new NotFoundException('Appel introuvable');
    if (alert.status !== 'ENVOYEE') return { status: alert.status, appointment: alert.appointment };
    const req = alert.request;
    const place = placeOf(req.facility);

    // Chaque réponse « réclame » l'appel encore en attente : un SMS « 1 » renvoyé deux fois (réseau lent,
    // double appui) ne compte qu'une fois ; seule la réponse qui a réellement changé l'état agit.
    const claim = (status: string) => this.prisma.donorAlert.updateMany({ where: { id: alert.id, status: 'ENVOYEE' }, data: { status, respondedAt: new Date() } });
    const already = async () => {
      const cur = await this.prisma.donorAlert.findUniqueOrThrow({ where: { id: alert.id } });
      return { status: cur.status, appointment: cur.appointment };
    };

    if (!accept) {
      if ((await claim('REFUSEE')).count !== 1) return already();
      await this.outbox.send({ channel: 'SMS', to: alert.donor.phone, lang: alert.donor.lang, body: sms('blood.donor.declined', alert.donor.lang), ref: `donor-alert:${alert.id}` });
      return { status: 'REFUSEE' };
    }

    // Couverture, réclamation et créneau dans une même transaction sérialisable : deux donneurs qui disent
    // oui en même temps pour une seule poche ne sont pas tous deux acceptés (et déplacés pour rien).
    const outcome = await this.serializable(async (tx) => {
      const cur = await tx.bloodRequest.findUniqueOrThrow({ where: { id: req.id }, include: { alerts: { select: { id: true, status: true } } } });
      const acceptedBefore = cur.alerts.filter((a) => a.status === 'ACCEPTEE' && a.id !== alert.id).length;
      const covered = !NEEDS_BLOOD.includes(cur.status) || coverage(cur.quantity, acceptedBefore, cur.reservedUnits).complete;
      const status = covered ? 'EXPIREE' : 'ACCEPTEE';
      const appointment = covered ? null : nextSlot(acceptedBefore, cur.urgency, cur.neededBy);
      const { count } = await tx.donorAlert.updateMany({ where: { id: alert.id, status: 'ENVOYEE' }, data: { status, respondedAt: new Date(), appointment } });
      return count === 1 ? { status, appointment } : null;
    });
    if (!outcome) return already();
    if (outcome.status === 'EXPIREE') {
      // Réponse tardive : le besoin est déjà couvert, on remercie sans faire déplacer la personne.
      await this.outbox.send({ channel: 'SMS', to: alert.donor.phone, lang: alert.donor.lang, body: sms('blood.donor.covered', alert.donor.lang, { place }), ref: `donor-alert:${alert.id}` });
      return { status: 'EXPIREE', place };
    }
    await this.onDonorAccepted(req, alert.donor, alert.distanceKm, outcome.appointment!, via, false);
    return { status: 'ACCEPTEE', appointment: outcome.appointment, place };
  }

  /**
   * Un donneur a dit oui (alerte ou proposition spontanée) : la demande passe à « donneur trouvé »,
   * le donneur reçoit son rendez-vous, le soignant, la banque de sang et la famille sont prévenus.
   */
  private async onDonorAccepted(
    req: {
      id: string; patientId: string; requesterId: string; status: string; quantity: number; reservedUnits: number; bloodGroup: string; product: string;
      facility: Place; patient: { firstName: string; discreetMode: boolean };
    },
    donor: Donor,
    km: number,
    appointment: Date,
    via: 'APP' | 'SMS' | 'USSD',
    volunteer: boolean,
  ) {
    const place = placeOf(req.facility);
    // Premier « oui » : la demande passe à « donneur trouvé » (les suivants complètent la quantité).
    await this.prisma.bloodRequest.updateMany({ where: { id: req.id, status: { in: ['OUVERTE', 'DONNEURS_ALERTES'] } }, data: { status: 'DONNEUR_TROUVE' } });
    await this.outbox.send({
      channel: 'SMS',
      to: donor.phone,
      lang: donor.lang,
      audioKey: 'donor.thanks',
      ref: `blood-request:${req.id}`,
      body: sms('blood.donor.rdv', donor.lang, { name: donor.firstName, when: (l) => whenIn(appointment, l), place }),
    });
    if (donor.userId) {
      await this.notifications.notify(donor.userId, {
        kind: 'SANG',
        text: note('blood.n.rdv.title', 'blood.n.rdv.body', { when: (l) => whenIn(appointment, l), place }),
        href: '/app/sang',
      });
    }

    // Qui a dit oui, et comment : texte du soignant, repris pour la banque de sang.
    const summaryKey = volunteer ? 'blood.n.found.volunteer' : (`blood.n.found.${via}` as const);
    const summaryVars: Vars = { donor: donor.firstName, group: donor.bloodGroup, km: Math.round(km), when: (l) => whenIn(appointment, l), place };
    await this.notifications.notify(req.requesterId, {
      kind: 'SANG',
      text: note('blood.n.found.title', summaryKey, { ...summaryVars, prenom: req.patient.firstName }),
      href: `/pro/sang/${req.id}`,
      ref: `blood-request:${req.id}`,
      sms: (lang) => sms('blood.requester.donor', lang, { group: donor.bloodGroup, place, when: (l) => whenIn(appointment, l) }),
    });
    await this.notifications.notify(await this.notifications.usersWithRole('BLOOD_BANK'), {
      kind: 'SANG',
      text: note('blood.n.toReceive.title', 'blood.n.toReceive.body', {
        place,
        summary: (l) => sms(summaryKey, l, summaryVars),
        group: req.bloodGroup,
        product: (l) => productIn(req.product, l),
      }),
      href: `/ants#demande-${req.id}`,
    });

    await this.notifyFamily(req, donor.userId);
    await this.audit.log({ patientId: req.patientId, action: 'DONOR_FOUND', resource: `Donneur ${donor.bloodGroup} à ${km} km (${volunteer ? 'proposition spontanée' : `réponse ${via}`})` });
    await this.closeIfCovered(req.id);
  }

  /**
   * Demande annulée (erreur, patient transféré, besoin disparu) : par le prescripteur, un soignant de son
   * établissement ou la banque de sang. Les donneurs encore attendus sont prévenus, les poches réservées
   * reviennent au stock du site qui les avait mises de côté.
   */
  async cancel(user: AuthUser, id: string, reason: string | undefined, ip?: string) {
    const r = await this.prisma.bloodRequest.findUnique({ where: { id }, include: { facility: true, alerts: { include: { donor: true } } } });
    if (!r) throw new NotFoundException('Demande introuvable');
    const sameFacility = CLINICAL_ROLES.includes(user.role) && Boolean(user.facilityId) && user.facilityId === r.facilityId;
    if (r.requesterId !== user.id && !sameFacility && user.role !== 'BLOOD_BANK') {
      throw new ForbiddenException('Réservé au prescripteur, aux soignants de son établissement et à la banque de sang');
    }
    if (r.status === 'ANNULEE') return { ok: true, already: true };
    if (r.status === 'SERVIE') throw new BadRequestException('La transfusion a déjà été faite : la demande ne peut plus être annulée.');
    const place = placeOf(r.facility);
    const cancelled = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.bloodRequest.updateMany({ where: { id, status: { in: SERVABLE } }, data: { status: 'ANNULEE' } });
      if (claim.count !== 1) return false;
      await tx.donorAlert.updateMany({ where: { requestId: id, status: { in: ['ENVOYEE', 'ACCEPTEE'] } }, data: { status: 'EXPIREE' } });
      if (r.reservedUnits > 0 && r.reservedSiteId) {
        // Les poches réservées étaient sorties du stock : elles y retournent (sur le groupe du receveur).
        await tx.bloodStock.upsert({
          where: { siteId_product_bloodGroup: { siteId: r.reservedSiteId, product: r.product, bloodGroup: r.bloodGroup } },
          update: { units: { increment: r.reservedUnits } },
          create: { siteId: r.reservedSiteId, product: r.product, bloodGroup: r.bloodGroup, units: r.reservedUnits },
        });
      }
      return true;
    });
    if (!cancelled) return { ok: true, already: true };
    const waiting = r.alerts.filter((a) => a.status === 'ENVOYEE' || a.status === 'ACCEPTEE');
    for (const a of waiting) {
      await this.outbox.send({ channel: 'SMS', to: a.donor.phone, lang: a.donor.lang, body: sms('blood.donor.cancelled', a.donor.lang, { name: a.donor.firstName, place }), ref: `donor-alert:${a.id}` });
      if (a.donor.userId) await this.notifications.notify(a.donor.userId, { kind: 'SANG', text: note('blood.n.cancelled.title', 'blood.n.cancelled.body', { place }), href: '/app/sang' });
    }
    await this.notifications.notify(await this.notifications.usersWithRole('BLOOD_BANK'), {
      kind: 'SANG',
      text: note('blood.n.cancelled.ants.title', 'blood.n.cancelled.ants.body', { place, group: r.bloodGroup, product: (l) => productIn(r.product, l) }),
      href: `/ants#demande-${r.id}`,
    });
    await this.audit.log({ actor: user, patientId: r.patientId, action: 'WRITE', resource: `Demande de sang annulée (${PRODUCT_LABEL[r.product]} ${r.bloodGroup})`, reason: reason?.trim() || undefined, ip });
    return { ok: true, donorsInformed: waiting.length, reservedReturned: r.reservedUnits };
  }

  /**
   * Famille (aidants avec le volet « sang ») : le SMS ou le message vocal ne dit jamais qu'il s'agit de sang,
   * ni l'hôpital, ni la date (« bonne nouvelle pour Koffi, ouvrez l'application ») ; en mode discret, pas même
   * le prénom, ni message vocal. Le détail reste derrière la connexion, dans l'application.
   */
  private async notifyFamily(req: { id: string; patientId: string; patient: { firstName: string; discreetMode: boolean } }, skipUserId: string | null) {
    const discreet = req.patient.discreetMode;
    const family = await this.prisma.delegation.findMany({
      where: { patientId: req.patientId, revokedAt: null, OR: [{ scopes: { has: 'blood' } }, { scopes: { has: 'all' } }] },
      include: { caregiver: true },
    });
    for (const f of family) {
      if (f.caregiver.id === skipUserId) continue;
      await this.notifications.notify(f.caregiver.id, {
        kind: 'SANG',
        text: discreet
          ? note('blood.n.family.discreet.title', 'blood.n.family.discreet.body')
          : note('blood.n.family.title', 'blood.n.family.body', { prenom: req.patient.firstName }),
        href: '/app/sang',
      });
      if (!f.caregiver.phone) continue;
      const lang = f.caregiver.lang;
      await this.outbox.send({
        channel: 'SMS',
        to: f.caregiver.phone,
        lang,
        ref: `blood-request:${req.id}`,
        body: discreet ? sms('blood.family.discreet', lang) : sms('blood.family.news', lang, { prenom: req.patient.firstName }),
      });
      if (!discreet && lang !== 'fr' && lang !== 'en') {
        await this.outbox.send({ channel: 'VOICE', to: f.caregiver.phone, lang, ref: `blood-request:${req.id}`, body: sms('blood.family.news.voice', lang, { prenom: req.patient.firstName }) });
      }
    }
  }

  /** Besoin couvert (donneurs + poches réservées) : les donneurs encore en attente sont remerciés. */
  private async closeIfCovered(requestId: string) {
    const r = await this.prisma.bloodRequest.findUniqueOrThrow({ where: { id: requestId }, include: { facility: true, alerts: { include: { donor: true } } } });
    const cov = coverage(r.quantity, r.alerts.filter((a) => a.status === 'ACCEPTEE').length, r.reservedUnits);
    if (!cov.complete) return false;
    const place = placeOf(r.facility);
    for (const a of r.alerts.filter((x) => x.status === 'ENVOYEE')) {
      const { count } = await this.prisma.donorAlert.updateMany({ where: { id: a.id, status: 'ENVOYEE' }, data: { status: 'EXPIREE' } });
      if (count === 1) await this.outbox.send({ channel: 'SMS', to: a.donor.phone, lang: a.donor.lang, body: sms('blood.donor.covered', a.donor.lang, { place }), ref: `donor-alert:${a.id}` });
    }
    return true;
  }

  // ─── Espace donneur (patient ou aidant) ──────────────────────────

  async donorMe(user: AuthUser) {
    const [donor, profile, account] = await Promise.all([
      this.prisma.donor.findUnique({ where: { userId: user.id } }),
      this.prisma.patient.findUnique({ where: { userId: user.id }, select: { firstName: true, sex: true, birthDate: true, bloodGroup: true, communeId: true, commune: { select: { name: true } } } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { phone: true, lang: true } }),
    ]);
    const donorCommune = donor ? await this.prisma.commune.findUnique({ where: { name: donor.city }, select: { id: true, name: true } }) : null;
    const contraindication = await this.contraindication(user.id);
    return {
      donor: donor ? this.donorView(donor, profile?.birthDate ?? null, donorCommune?.id ?? null, contraindication) : null,
      prefill: {
        bloodGroup: donor?.bloodGroup ?? profile?.bloodGroup ?? null,
        communeId: donorCommune?.id ?? profile?.communeId ?? null,
        commune: donorCommune?.name ?? profile?.commune?.name ?? null,
        sex: donor?.sex ?? profile?.sex ?? null,
        age: profile ? ageOn(profile.birthDate) : null,
        hasProfile: Boolean(profile),
        hasPhone: Boolean(account.phone),
        lang: account.lang,
        contraindication,
      },
      rules: { restDays: REST_DAYS, minAge: MIN_AGE, maxAge: MAX_AGE, nearbyKm: NEARBY_KM },
    };
  }

  /** Contre-indication connue du carnet : grossesse en cours, cancer, maladie du sang, VIH (sans jamais la nommer). */
  private async contraindication(userId: string) {
    return contraindicationOf(await this.prisma.patient.findUnique({ where: { userId }, select: DONOR_HEALTH.user.select.patient.select }));
  }

  private donorView(d: Donor, birthDate: Date | null, communeId: string | null, contraindication: Contraindication | null) {
    const el = eligibility({ lastDonationAt: d.lastDonationAt, sex: d.sex, birthDate, contraindication });
    return {
      id: d.id,
      firstName: d.firstName,
      bloodGroup: d.bloodGroup,
      sex: d.sex,
      city: d.city,
      communeId,
      available: d.available,
      hasSmartphone: d.hasSmartphone,
      lang: d.lang,
      donations: d.donations,
      lastDonationAt: d.lastDonationAt,
      since: d.createdAt,
      eligible: el.eligible,
      reason: el.reason ?? null,
      nextDate: el.nextDate,
      age: el.age,
    };
  }

  /** Devenir donneur (ou mettre à jour sa fiche) : téléphone du compte, commune → position, langue du compte. */
  async saveDonorMe(user: AuthUser, dto: DonorProfileDto) {
    const account = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { phone: true, lang: true, displayName: true } });
    if (!account.phone) throw new BadRequestException('Ajoutez d’abord votre numéro de téléphone : c’est par lui que vous recevrez les appels au don.');
    const profile = await this.prisma.patient.findUnique({ where: { userId: user.id }, select: { firstName: true, sex: true, birthDate: true, bloodGroup: true, communeId: true } });
    const existing =
      (await this.prisma.donor.findUnique({ where: { userId: user.id } })) ??
      // Déjà inscrit au site de transfusion avec ce numéro : on relie la fiche au compte.
      (await this.prisma.donor.findFirst({ where: { phone: account.phone, userId: null } }));

    const communeId = dto.communeId ?? (existing ? undefined : (profile?.communeId ?? undefined));
    const commune = communeId ? await this.prisma.commune.findUnique({ where: { id: communeId } }) : null;
    if (communeId && !commune) throw new BadRequestException('Commune inconnue');
    const sex = profile?.sex ?? dto.sex ?? existing?.sex;
    const bloodGroup = dto.bloodGroup ?? existing?.bloodGroup ?? profile?.bloodGroup ?? undefined;

    if (!existing) {
      const contra = await this.contraindication(user.id);
      if (contra) throw new BadRequestException(INELIGIBLE_MESSAGE[contra]);
      if (!bloodGroup) throw new BadRequestException('Indiquez votre groupe sanguin (il est écrit sur votre carte de groupe ou dans votre carnet).');
      if (!commune) throw new BadRequestException('Indiquez votre commune : on vous appelle seulement pour les hôpitaux proches.');
      if (!sex) throw new BadRequestException('Indiquez si vous êtes un homme ou une femme (le repos entre deux dons en dépend).');
      const age = profile ? ageOn(profile.birthDate) : dto.age;
      if (age === undefined || age === null) throw new BadRequestException('Indiquez votre âge.');
      if (age < MIN_AGE) throw new BadRequestException(INELIGIBLE_MESSAGE.TOO_YOUNG);
      if (age > MAX_AGE) throw new BadRequestException(INELIGIBLE_MESSAGE.TOO_OLD);
    }
    if (dto.weightOk === false) throw new BadRequestException(INELIGIBLE_MESSAGE.WEIGHT);

    const firstName = profile?.firstName ?? account.displayName.split(' ')[0];
    const place = commune ? { lat: commune.lat, lng: commune.lng, city: commune.name } : {};
    const common = {
      userId: user.id,
      phone: account.phone,
      lang: account.lang,
      ...(bloodGroup ? { bloodGroup } : {}),
      ...(sex ? { sex } : {}),
      ...place,
      ...(dto.available !== undefined ? { available: dto.available } : {}),
      ...(dto.hasSmartphone !== undefined ? { hasSmartphone: dto.hasSmartphone } : {}),
    };
    if (existing) {
      await this.prisma.donor.update({ where: { id: existing.id }, data: common });
    } else {
      await this.prisma.donor.create({
        data: { ...common, firstName, bloodGroup: bloodGroup!, sex: sex!, lat: commune!.lat, lng: commune!.lng, city: commune!.name },
      });
      await this.audit.log({ actor: user, action: 'WRITE', resource: 'Inscription comme donneur de sang' });
    }
    return this.donorMe(user);
  }

  /** Demandes ouvertes compatibles à moins de 40 km, anonymes : hôpital, produit, groupe, urgence, échéance. */
  async nearby(user: AuthUser) {
    const donor = await this.prisma.donor.findUnique({ where: { userId: user.id }, include: DONOR_HEALTH });
    if (!donor) return { registered: false, requests: [] };
    if (contraindicationOf(donor.user?.patient)) return { registered: true, requests: [] };
    const rows = await this.prisma.bloodRequest.findMany({
      where: {
        status: { in: NEEDS_BLOOD },
        neededBy: { gt: new Date(Date.now() - NEARBY_GRACE_MS) },
        alerts: { none: { donorId: donor.id } },
        patient: { OR: [{ userId: null }, { userId: { not: user.id } }] },
      },
      include: { facility: { select: { shortName: true, name: true, lat: true, lng: true } }, alerts: { select: { status: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const requests = rows
      .filter((r) => compatibleDonorGroups(r.bloodGroup).includes(donor.bloodGroup))
      .map((r) => ({ r, km: distanceKm(donor.lat, donor.lng, r.facility.lat, r.facility.lng), cov: coverage(r.quantity, r.alerts.filter((a) => a.status === 'ACCEPTEE').length, r.reservedUnits) }))
      .filter((x) => x.km <= NEARBY_KM && !x.cov.complete)
      .sort((a, b) => (URGENCY_RANK[a.r.urgency] ?? 9) - (URGENCY_RANK[b.r.urgency] ?? 9) || a.km - b.km)
      .slice(0, 10)
      .map(({ r, km, cov }) => ({
        id: r.id,
        facility: placeOf(r.facility),
        product: r.product,
        productLabel: PRODUCT_LABEL[r.product],
        bloodGroup: r.bloodGroup,
        urgency: r.urgency,
        neededBy: r.neededBy,
        distanceKm: km,
        missing: cov.missing,
      }));
    return { registered: true, requests };
  }

  /** « Je peux donner » : un donneur inscrit se propose pour une demande proche. */
  async volunteer(user: AuthUser, requestId: string) {
    const donor = await this.prisma.donor.findUnique({ where: { userId: user.id }, include: DONOR_HEALTH });
    if (!donor) throw new BadRequestException('Inscrivez-vous d’abord comme donneur.');
    const req = await this.prisma.bloodRequest.findUnique({ where: { id: requestId }, include: { facility: true, patient: true, alerts: true } });
    if (!req) throw new NotFoundException('Demande introuvable');
    if (req.patient.userId === user.id) throw new ForbiddenException('Vous ne pouvez pas donner pour votre propre demande.');
    const place = placeOf(req.facility);
    const existing = req.alerts.find((a) => a.donorId === donor.id);
    // Déjà d'accord (double appui, réseau lent) : même réponse, sans nouvel envoi.
    if (existing?.status === 'ACCEPTEE') return { status: 'ACCEPTEE', appointment: existing.appointment, place };
    const accepted = req.alerts.filter((a) => a.status === 'ACCEPTEE').length;
    if (!NEEDS_BLOOD.includes(req.status) || coverage(req.quantity, accepted, req.reservedUnits).complete) throw new BadRequestException('Merci ! Cette demande est déjà couverte.');
    if (!compatibleDonorGroups(req.bloodGroup).includes(donor.bloodGroup)) throw new BadRequestException(`Votre groupe (${donor.bloodGroup}) n’est pas compatible avec cette demande.`);
    // Repos, âge et carnet (grossesse, maladie qui exclut le don) revérifiés au moment de se proposer.
    const el = eligibility({ lastDonationAt: donor.lastDonationAt, sex: donor.sex, birthDate: donor.user?.patient?.birthDate, contraindication: contraindicationOf(donor.user?.patient) });
    if (!el.eligible) {
      throw new BadRequestException(el.reason === 'REST' && el.nextDate ? `Votre corps se repose : prochain don possible à partir du ${dayIn(el.nextDate)}.` : (INELIGIBLE_MESSAGE[el.reason ?? ''] ?? 'Don impossible pour le moment.'));
    }
    const km = distanceKm(donor.lat, donor.lng, req.facility.lat, req.facility.lng);
    if (km > RADIUS_STEPS[RADIUS_STEPS.length - 1]) throw new BadRequestException('Cet hôpital est trop loin de chez vous.');
    if (existing?.status === 'ENVOYEE') return this.respond(existing.id, true, 'APP');

    const appointment = nextSlot(accepted, req.urgency, req.neededBy);
    const data = { status: 'ACCEPTEE', volunteer: true, respondedAt: new Date(), appointment, channel: 'APP', distanceKm: km };
    // Une seule proposition par donneur et par demande : l'appel déjà refusé ou expiré est réclamé sous garde,
    // sinon la contrainte unique (demande, donneur) arrête le doublon d'un double appui.
    const current = async () => {
      const a = await this.prisma.donorAlert.findUniqueOrThrow({ where: { requestId_donorId: { requestId: req.id, donorId: donor.id } } });
      return { status: a.status, appointment: a.appointment, place };
    };
    if (existing) {
      const { count } = await this.prisma.donorAlert.updateMany({ where: { id: existing.id, status: { in: ['REFUSEE', 'EXPIREE'] } }, data });
      if (count !== 1) return current();
    } else {
      try {
        await this.prisma.donorAlert.create({ data: { ...data, requestId: req.id, donorId: donor.id } });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return current();
        throw e;
      }
    }
    if (!donor.available) await this.prisma.donor.update({ where: { id: donor.id }, data: { available: true } });
    await this.onDonorAccepted(req, donor, km, appointment, 'APP', true);
    return { status: 'ACCEPTEE', appointment, place };
  }

  /** Espace donneur : appels reçus. */
  async myAlerts(user: AuthUser) {
    const donor = await this.prisma.donor.findUnique({ where: { userId: user.id }, include: DONOR_HEALTH });
    if (!donor) return { donor: null, alerts: [] };
    const alerts = await this.prisma.donorAlert.findMany({
      where: { donorId: donor.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { request: { select: { status: true, bloodGroup: true, product: true, urgency: true, neededBy: true, facility: { select: { shortName: true, name: true } } } } },
    });
    const el = eligibility({ lastDonationAt: donor.lastDonationAt, sex: donor.sex, birthDate: donor.user?.patient?.birthDate, contraindication: contraindicationOf(donor.user?.patient) });
    return {
      donor: { firstName: donor.firstName, bloodGroup: donor.bloodGroup, donations: donor.donations, lastDonationAt: donor.lastDonationAt, canDonate: el.eligible, nextDate: el.nextDate, available: donor.available },
      alerts: alerts.map((a) => ({
        id: a.id,
        status: a.status,
        volunteer: a.volunteer,
        distanceKm: a.distanceKm,
        appointment: a.appointment,
        place: placeOf(a.request.facility),
        product: PRODUCT_LABEL[a.request.product],
        urgency: a.request.urgency,
        neededBy: a.request.neededBy,
        requestStatus: a.request.status,
      })),
    };
  }

  async respondAsUser(user: AuthUser, alertId: string, accept: boolean) {
    const donor = await this.prisma.donor.findUnique({ where: { userId: user.id } });
    const alert = await this.prisma.donorAlert.findUnique({ where: { id: alertId } });
    if (!donor || !alert || alert.donorId !== donor.id) throw new NotFoundException('Appel introuvable');
    return this.respond(alertId, accept, 'APP');
  }

  // ─── Banque de sang : réserver des poches ────────────────────────

  async reserve(user: AuthUser, requestId: string, units: number) {
    if (user.role !== 'BLOOD_BANK' || !user.facilityId) throw new ForbiddenException('Réservé à un site de transfusion');
    const siteId = user.facilityId;
    const req = await this.prisma.bloodRequest.findUnique({ where: { id: requestId }, include: { facility: true, patient: true } });
    if (!req) throw new NotFoundException('Demande introuvable');
    const groups = compatibleDonorGroups(req.bloodGroup);

    // Vérification et retrait dans la même transaction sérialisable : deux sites (ou deux clics) qui réservent
    // en même temps ne peuvent pas dépasser le besoin, ni vider un stock sous le zéro.
    const draw = await this.serializable(async (tx) => {
      const cur = await tx.bloodRequest.findUniqueOrThrow({ where: { id: req.id }, include: { alerts: { select: { status: true } } } });
      const cov = coverage(cur.quantity, cur.alerts.filter((a) => a.status === 'ACCEPTEE').length, cur.reservedUnits);
      if (!NEEDS_BLOOD.includes(cur.status) || cov.complete) throw new BadRequestException('Demande déjà couverte, servie ou clôturée');
      if (units > cov.missing) throw new BadRequestException(cov.missing > 1 ? `Il ne manque que ${cov.missing} poches pour cette demande.` : 'Il ne manque qu’une poche pour cette demande.');
      const rows = await tx.bloodStock.findMany({ where: { siteId, product: req.product, bloodGroup: { in: groups } } });
      const plan = planStockDraw(rows, req.bloodGroup, groups, units);
      if (plan.missing > 0) {
        const have = units - plan.missing;
        throw new BadRequestException(have ? `Stock insuffisant : ${have} poche${have > 1 ? 's' : ''} compatible${have > 1 ? 's' : ''} seulement.` : 'Aucune poche compatible dans votre stock.');
      }
      for (const d of plan.draw) {
        const r = await tx.bloodStock.updateMany({ where: { siteId, product: req.product, bloodGroup: d.bloodGroup, units: { gte: d.units } }, data: { units: { decrement: d.units } } });
        if (r.count !== 1) throw new ConflictException('Le stock vient de changer. Réessayez.');
      }
      const r = await tx.bloodRequest.updateMany({
        where: { id: req.id, reservedUnits: cur.reservedUnits, status: { in: NEEDS_BLOOD } },
        data: { reservedUnits: { increment: units }, reservedSiteId: siteId },
      });
      if (r.count !== 1) throw new ConflictException('La demande vient de changer. Réessayez.');
      return plan.draw;
    });

    const site = await this.prisma.facility.findUniqueOrThrow({ where: { id: siteId } });
    const complete = await this.closeIfCovered(req.id);
    // Besoin couvert (poches seules, ou poches + donneurs) : la demande n'a plus rien à chercher.
    if (complete) await this.prisma.bloodRequest.updateMany({ where: { id: req.id, status: { in: NEEDS_BLOOD } }, data: { status: 'POCHES_RESERVEES' } });
    const place = placeOf(req.facility);
    const siteName = placeOf(site);
    await this.notifications.notify(req.requesterId, {
      kind: 'SANG',
      text: (lang) => ({
        title: plural('blood.n.reserved.title', units, lang, { prenom: req.patient.firstName }),
        body: text(complete ? 'blood.n.reserved.bodyCovered' : 'blood.n.reserved.body', lang, {
          site: siteName,
          units: draw.map((d) => `${d.units} ${d.bloodGroup}`).join(', '),
          product: (l) => productIn(req.product, l),
        }),
      }),
      href: `/pro/sang/${req.id}`,
      ref: `blood-request:${req.id}`,
      sms: (lang) => sms('blood.requester.reserved', lang, { site: siteName, n: units, place }),
    });
    await this.audit.log({ actor: user, action: 'WRITE', resource: `Réservation de ${units} poche(s) ${PRODUCT_LABEL[req.product]} (${draw.map((d) => `${d.bloodGroup}:${d.units}`).join(', ')}) pour une demande de ${place}` });
    return { ...(await this.get(user, req.id)), reservation: { units, draw, site: siteName, complete } };
  }

  /**
   * Transaction sérialisable, rejouée jusqu'à trois fois en cas de conflit de sérialisation (deux réponses ou deux
   * réservations au même instant : PostgreSQL en annule une, qui relit l'état et conclut correctement, par exemple
   * « besoin déjà couvert »). Au-delà, « réessayez ».
   */
  private async serializable<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>, attempts = 3): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (e) {
        const conflict = e instanceof Prisma.PrismaClientKnownRequestError && (e.code === 'P2034' || e.code === 'P2028');
        if (!conflict) throw e;
        if (attempt >= attempts) throw new ConflictException('Une autre opération est en cours sur cette demande. Réessayez.');
        await new Promise((r) => setTimeout(r, 40 * attempt + Math.floor(Math.random() * 60)));
      }
    }
  }

  // ─── Suivi ───────────────────────────────────────────────────────

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
      include: { facility: { select: { shortName: true, name: true } }, patient: { select: { firstName: true, lastName: true } }, alerts: { select: { status: true, volunteer: true } } },
    });
    const sites = await this.siteNames(rows.map((r) => r.reservedSiteId));
    // Le ministère ne voit que des demandes anonymes (pilotage), jamais le nom du patient.
    return rows.map((r) => this.shape(r, sites, user.role === 'MINISTRY'));
  }

  /**
   * Une demande : le prescripteur et le patient la suivent librement ; tout autre lecteur passe par le contrôle
   * d'accès journalisé (équipe de soins, consentement, aidant avec le volet « sang »). La banque de sang la lit
   * pour son métier (lecture inscrite au journal du patient) ; le ministère la voit anonyme.
   */
  async get(user: AuthUser, id: string, ip?: string) {
    const r = await this.prisma.bloodRequest.findUnique({
      where: { id },
      include: {
        facility: { select: { shortName: true, name: true, lat: true, lng: true } },
        patient: { select: { firstName: true, lastName: true, userId: true } },
        alerts: { include: { donor: { select: { firstName: true, bloodGroup: true, city: true, phone: true } } }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!r) throw new NotFoundException('Demande introuvable');
    const bank = user.role === 'BLOOD_BANK';
    const ministry = user.role === 'MINISTRY';
    if (bank) {
      await this.audit.log({ actor: user, patientId: r.patientId, action: 'READ', resource: 'Demande de sang', reason: 'banque de sang', ip });
    } else if (!ministry && r.requesterId !== user.id && r.patient.userId !== user.id) {
      await this.access.assert(user, r.patientId, CLINICAL_ROLES.includes(user.role) ? 'summary' : 'blood', 'Demande de sang', ip);
    }
    const final = FINAL_STATUSES.includes(r.status);

    // Qui a été prévenu : donneurs par canal, rayon atteint, banque de sang, sites avec du stock compatible.
    const alerted = r.alerts.filter((a) => !a.volunteer);
    const byChannel = { APP: 0, SMS: 0, VOICE: 0 } as Record<string, number>;
    for (const a of alerted) byChannel[a.channel] = (byChannel[a.channel] ?? 0) + 1;
    const farthest = alerted.reduce((m, a) => Math.max(m, a.distanceKm), 0);
    const [antsNotified, stock, sites] = await Promise.all([
      // Comptes de banque de sang prévenus au moins une fois (création, donneur trouvé…) : une personne, une fois.
      this.prisma.notification.findMany({ where: { href: `/ants#demande-${r.id}`, user: { role: 'BLOOD_BANK' } }, distinct: ['userId'], select: { userId: true } }).then((rows) => rows.length),
      final ? null : this.stockCheck(r.product, r.bloodGroup, r.facility.lat, r.facility.lng),
      this.siteNames([r.reservedSiteId]),
    ]);

    return {
      ...this.shape(r, sites, ministry),
      donors: ministry ? [] : r.alerts.map((a) => ({
        id: a.id,
        firstName: a.donor.firstName,
        bloodGroup: a.donor.bloodGroup,
        city: a.donor.city,
        distanceKm: a.distanceKm,
        channel: a.channel,
        status: a.status,
        volunteer: a.volunteer,
        appointment: a.appointment,
        // La banque de sang appelle les donneurs qui ont dit oui pour organiser la collecte.
        ...(bank && a.status === 'ACCEPTEE' ? { phone: a.donor.phone } : {}),
      })),
      dispatch: {
        donorsAlerted: alerted.length,
        byChannel,
        volunteers: r.alerts.length - alerted.length,
        radiusKm: alerted.length ? (RADIUS_STEPS.find((s) => s >= farthest) ?? RADIUS_STEPS[RADIUS_STEPS.length - 1]) : null,
        antsNotified,
        stockNearby: stock ? stock.sites.filter((s) => s.distanceKm <= STOCK_RADIUS_KM).map(({ site, distanceKm: d, units }) => ({ site, distanceKm: d, units })) : [],
        nearbyUnits: stock?.nearbyUnits ?? null,
      },
    };
  }

  /**
   * « Transfusion faite » : par le prescripteur, un soignant de son établissement ou la banque de sang.
   * Seuls les donneurs dont on confirme qu'ils ont réellement donné (cochés, aucun par défaut) voient leur don
   * inscrit ; un donneur absent n'est pas bloqué des semaines. Le reste des poches vient du site qui a réservé
   * ou des sites à moins de 60 km. Une seule clôture possible, même en cas de double clic.
   */
  async markServed(user: AuthUser, id: string, donorAlertIds: string[] = [], ip?: string) {
    const r = await this.prisma.bloodRequest.findUnique({ where: { id }, include: { facility: true, alerts: { include: { donor: true } } } });
    if (!r) throw new NotFoundException('Demande introuvable');
    const sameFacility = CLINICAL_ROLES.includes(user.role) && Boolean(user.facilityId) && user.facilityId === r.facilityId;
    if (r.requesterId !== user.id && !sameFacility && user.role !== 'BLOOD_BANK') {
      throw new ForbiddenException('Réservé au prescripteur, aux soignants de son établissement et à la banque de sang');
    }
    if (r.status === 'ANNULEE') throw new BadRequestException('Demande annulée');
    if (r.status === 'SERVIE') return { ok: true, already: true };
    const accepted = r.alerts.filter((a) => a.status === 'ACCEPTEE');
    const wanted = new Set(donorAlertIds);
    if ([...wanted].some((x) => !accepted.some((a) => a.id === x))) {
      throw new BadRequestException('Seuls les donneurs qui ont dit oui peuvent être inscrits comme ayant donné.');
    }
    const givers = accepted.filter((a) => wanted.has(a.id));
    const pending = r.alerts.filter((a) => a.status === 'ENVOYEE');
    const now = new Date();
    const place = placeOf(r.facility);
    const fromStock = Math.max(0, r.quantity - givers.length - r.reservedUnits);

    const done = await this.prisma.$transaction(async (tx) => {
      // Réclamation de la clôture : seul le premier appel agit (idempotent).
      const claim = await tx.bloodRequest.updateMany({ where: { id, status: { in: SERVABLE } }, data: { status: 'SERVIE' } });
      if (claim.count !== 1) return null;
      for (const a of givers) await tx.donor.update({ where: { id: a.donorId }, data: { donations: { increment: 1 }, lastDonationAt: now } });
      const stock = fromStock ? await this.drawStockNear(tx, r, fromStock) : { used: [], missing: 0 };
      await tx.donorAlert.updateMany({ where: { requestId: id, status: 'ENVOYEE' }, data: { status: 'EXPIREE' } });
      await tx.encounter.create({
        data: {
          patientId: r.patientId,
          type: 'TRANSFUSION',
          date: now,
          facilityName: place,
          authorName: user.name,
          summaryEnc: this.crypto.encrypt(`Transfusion de ${r.quantity} poche${r.quantity > 1 ? 's' : ''} de ${PRODUCT_LABEL[r.product]} (${r.bloodGroup}).`),
        },
      });
      return stock;
    });
    if (!done) return { ok: true, already: true };

    for (const a of givers) {
      const d = a.donor;
      const next = nextDonationDate(now, d.sex)!;
      await this.outbox.send({ channel: 'SMS', to: d.phone, lang: d.lang, audioKey: 'donor.thanks', ref: `blood-request:${r.id}`, body: sms('blood.donor.gave', d.lang, { name: d.firstName, date: (l) => dayIn(next, l) }) });
      if (d.userId) {
        await this.notifications.notify(d.userId, { kind: 'SANG', text: note('blood.n.thanks.title', 'blood.n.thanks.body', { date: (l) => dayIn(next, l) }), href: '/app/sang' });
      }
    }
    // Les donneurs encore en attente n'ont plus à venir.
    for (const a of pending) {
      await this.outbox.send({ channel: 'SMS', to: a.donor.phone, lang: a.donor.lang, body: sms('blood.donor.covered', a.donor.lang, { place }), ref: `donor-alert:${a.id}` });
    }
    await this.audit.log({ actor: user, patientId: r.patientId, action: 'WRITE', resource: `Transfusion tracée (${r.quantity} ${PRODUCT_LABEL[r.product]})`, ip });
    return { ok: true, donorsRecorded: givers.length, reservedUnits: r.reservedUnits, stockUsed: done.used, stockMissing: done.missing };
  }

  /**
   * Retire n poches compatibles, groupe identique d'abord : du site qui a réservé, puis des sites de
   * transfusion à moins de 60 km de l'hôpital, du plus proche au plus lointain. Jamais d'un site éloigné.
   */
  private async drawStockNear(
    tx: Prisma.TransactionClient,
    r: { product: string; bloodGroup: string; reservedSiteId: string | null; facility: { lat: number; lng: number } },
    units: number,
  ) {
    const groups = compatibleDonorGroups(r.bloodGroup);
    const rows = await tx.bloodStock.findMany({ where: { product: r.product, bloodGroup: { in: groups }, units: { gt: 0 } }, include: { site: true } });
    const bySite = new Map<string, { site: Place & { id: string }; km: number; rows: { bloodGroup: string; units: number }[] }>();
    for (const row of rows) {
      const km = distanceKm(r.facility.lat, r.facility.lng, row.site.lat, row.site.lng);
      if (row.siteId !== r.reservedSiteId && km > STOCK_RADIUS_KM) continue;
      const cur = bySite.get(row.siteId) ?? { site: row.site, km: row.siteId === r.reservedSiteId ? -1 : km, rows: [] };
      cur.rows.push({ bloodGroup: row.bloodGroup, units: row.units });
      bySite.set(row.siteId, cur);
    }
    const used: { site: string; bloodGroup: string; units: number }[] = [];
    let left = units;
    for (const s of [...bySite.values()].sort((a, b) => a.km - b.km)) {
      if (left <= 0) break;
      for (const d of planStockDraw(s.rows, r.bloodGroup, groups, left).draw) {
        const u = await tx.bloodStock.updateMany({ where: { siteId: s.site.id, product: r.product, bloodGroup: d.bloodGroup, units: { gte: d.units } }, data: { units: { decrement: d.units } } });
        if (u.count === 1) {
          used.push({ site: placeOf(s.site), bloodGroup: d.bloodGroup, units: d.units });
          left -= d.units;
        }
      }
    }
    return { used, missing: left };
  }

  private async siteNames(ids: (string | null)[]) {
    const wanted = [...new Set(ids.filter((x): x is string => Boolean(x)))];
    if (!wanted.length) return new Map<string, string>();
    const rows = await this.prisma.facility.findMany({ where: { id: { in: wanted } }, select: { id: true, shortName: true, name: true } });
    return new Map(rows.map((f) => [f.id, placeOf(f)]));
  }

  private shape(
    r: {
      id: string; patientId: string; product: string; bloodGroup: string; quantity: number; urgency: string; status: string; neededBy: Date; createdAt: Date; requesterName: string;
      reservedUnits: number; reservedSiteId: string | null;
      facility: Place; patient: { firstName: string; lastName: string }; alerts: { status: string; volunteer: boolean }[];
    },
    sites: Map<string, string>,
    anonymous = false,
  ) {
    const accepted = r.alerts.filter((a) => a.status === 'ACCEPTEE').length;
    return {
      id: r.id,
      patientId: anonymous ? null : r.patientId,
      product: r.product,
      productLabel: PRODUCT_LABEL[r.product],
      bloodGroup: r.bloodGroup,
      compatibleGroups: compatibleDonorGroups(r.bloodGroup),
      quantity: r.quantity,
      urgency: r.urgency,
      status: r.status,
      neededBy: r.neededBy,
      createdAt: r.createdAt,
      requester: r.requesterName,
      facility: placeOf(r.facility),
      patient: anonymous ? null : shortName(r.patient),
      reserved: r.reservedUnits ? { units: r.reservedUnits, site: (r.reservedSiteId && sites.get(r.reservedSiteId)) || null } : null,
      coverage: coverage(r.quantity, accepted, r.reservedUnits),
      counts: {
        alerted: r.alerts.filter((a) => !a.volunteer).length,
        volunteers: r.alerts.filter((a) => a.volunteer).length,
        accepted,
        declined: r.alerts.filter((a) => a.status === 'REFUSEE').length,
        waiting: r.alerts.filter((a) => a.status === 'ENVOYEE').length,
      },
    };
  }
}

