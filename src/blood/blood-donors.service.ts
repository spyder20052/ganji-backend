import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Donor } from '@prisma/client';
import { AuditService } from '../common/audit.service';
import { AuthUser } from '../common/auth-user';
import { compatibleDonorGroups, distanceKm } from '../common/geo';
import { note, sms, type Vars } from '../common/i18n';
import { NotificationsService } from '../common/notifications.service';
import { OutboxService } from '../common/outbox.service';
import { serializable } from '../common/transactions';
import { PrismaService } from '../prisma/prisma.service';
import { DonorProfileDto } from './blood.dto';
import { INELIGIBLE_MESSAGE, NEARBY_GRACE_MS, NEEDS_BLOOD, nextSlot, type Place, placeOf, URGENCY_RANK } from './blood.logic';
import { dayIn, PRODUCT_LABEL, productIn, whenIn } from './blood.sms';
import { BloodDispatchService } from './blood-dispatch.service';
import { ageOn, type Contraindication, contraindicationOf, coverage, DONOR_HEALTH, eligibility, MAX_AGE, MIN_AGE, NEARBY_KM, RADIUS_STEPS, REST_DAYS } from './eligibility';

/**
 * Côté donneur : réponse à un appel (application, SMS, USSD), fiche de donneur, demandes proches,
 * proposition spontanée (« je peux donner ») et appels reçus.
 */
@Injectable()
export class BloodDonorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly notifications: NotificationsService,
    private readonly dispatch: BloodDispatchService,
  ) {}

  // ─── Réponse à un appel ──────────────────────────────────────────

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
    const outcome = await serializable(this.prisma, async (tx) => {
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

  /** Réponse depuis l'application : l'appel doit être adressé au donneur connecté. */
  async respondAsUser(user: AuthUser, alertId: string, accept: boolean) {
    const donor = await this.prisma.donor.findUnique({ where: { userId: user.id } });
    const alert = await this.prisma.donorAlert.findUnique({ where: { id: alertId } });
    if (!donor || !alert || alert.donorId !== donor.id) throw new NotFoundException('Appel introuvable');
    return this.respond(alertId, accept, 'APP');
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

    await this.dispatch.notifyFamily(req, donor.userId);
    await this.audit.log({ patientId: req.patientId, action: 'DONOR_FOUND', resource: `Donneur ${donor.bloodGroup} à ${km} km (${volunteer ? 'proposition spontanée' : `réponse ${via}`})` });
    await this.dispatch.closeIfCovered(req.id);
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
}
