import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessService } from '../common/access.service';
import { AuditService } from '../common/audit.service';
import { AuthUser, CLINICAL_ROLES } from '../common/auth-user';
import { CryptoService } from '../common/crypto.service';
import { compatibleDonorGroups } from '../common/geo';
import { note, plural, sms, text } from '../common/i18n';
import { shortName } from '../common/names';
import { NotificationsService } from '../common/notifications.service';
import { OutboxService } from '../common/outbox.service';
import { serializable } from '../common/transactions';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBloodRequestDto } from './blood.dto';
import { DEFAULT_NEEDED_BY_MS, FINAL_STATUSES, NEEDS_BLOOD, type Place, placeOf, SERVABLE, STOCK_RADIUS_KM } from './blood.logic';
import { dayIn, PRODUCT_LABEL, productIn } from './blood.sms';
import { BloodDispatchService } from './blood-dispatch.service';
import { BloodStockService } from './blood-stock.service';
import { coverage, nextDonationDate, planStockDraw, RADIUS_STEPS } from './eligibility';

/**
 * Cycle de vie d'une demande de produit sanguin : création par un soignant (banque de sang prévenue, stocks
 * vérifiés, donneurs alertés), suivi, réservation de poches par un site de transfusion, annulation,
 * transfusion faite.
 */
@Injectable()
export class BloodRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly crypto: CryptoService,
    private readonly notifications: NotificationsService,
    private readonly stock: BloodStockService,
    private readonly dispatch: BloodDispatchService,
  ) {}

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
    const antsNotified = await this.dispatch.notifyBloodBank(request.id, { ...request, requester: user.name }, facility);
    // 2. Stocks compatibles proches ; 3. s'ils ne suffisent pas, les donneurs compatibles sont alertés.
    const stockCheck = await this.stock.stockCheck(dto.product, bloodGroup, facility.lat, facility.lng);
    const donors = stockCheck.nearbyUnits < dto.quantity ? await this.dispatch.alertDonors(user, request.id) : { alerted: 0, radiusKm: null, widened: false, byChannel: { APP: 0, SMS: 0, VOICE: 0 } };
    const view = await this.get(user, request.id);
    return { ...view, stockCheck, autoAlerted: donors.alerted, dispatch: { ...view.dispatch, antsNotified, donorsJustAlerted: donors.alerted, radiusKm: donors.radiusKm, widened: donors.widened } };
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

  // ─── Banque de sang : réserver des poches ────────────────────────

  async reserve(user: AuthUser, requestId: string, units: number) {
    if (user.role !== 'BLOOD_BANK' || !user.facilityId) throw new ForbiddenException('Réservé à un site de transfusion');
    const siteId = user.facilityId;
    const req = await this.prisma.bloodRequest.findUnique({ where: { id: requestId }, include: { facility: true, patient: true } });
    if (!req) throw new NotFoundException('Demande introuvable');
    const groups = compatibleDonorGroups(req.bloodGroup);

    // Vérification et retrait dans la même transaction sérialisable : deux sites (ou deux clics) qui réservent
    // en même temps ne peuvent pas dépasser le besoin, ni vider un stock sous le zéro.
    const draw = await serializable(this.prisma, async (tx) => {
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
    const complete = await this.dispatch.closeIfCovered(req.id);
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
      final ? null : this.stock.stockCheck(r.product, r.bloodGroup, r.facility.lat, r.facility.lng),
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
      const stock = fromStock ? await this.stock.drawStockNear(tx, r, fromStock) : { used: [], missing: 0 };
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
