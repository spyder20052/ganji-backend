import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuthUser } from '../common/auth-user';
import { compatibleDonorGroups, distanceKm } from '../common/geo';
import { note, plural, sms, text, type Var } from '../common/i18n';
import { NotificationsService } from '../common/notifications.service';
import { OutboxService } from '../common/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { donorChannel, MAX_ALERTS, NEEDS_BLOOD, type Place, placeOf, wantsVoice } from './blood.logic';
import { productIn, urgencyIn, whenIn } from './blood.sms';
import { boundingBox, canDonateNow, contraindicationOf, coverage, DONOR_HEALTH, pickByRadius, RADIUS_STEPS } from './eligibility';

/**
 * Qui est prévenu d'une demande, et comment : la banque de sang (toujours), les donneurs compatibles par rayons
 * croissants, la famille (sans rien révéler du soin) ; et les donneurs encore attendus quand le besoin est couvert.
 */
@Injectable()
export class BloodDispatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly notifications: NotificationsService,
  ) {}

  /** La banque de sang est TOUJOURS prévenue d'une demande (application + SMS) : elle peut réserver des poches. */
  async notifyBloodBank(requestId: string, r: { quantity: number; product: string; bloodGroup: string; urgency: string; neededBy: Date; requester: string }, facility: Place) {
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

  /**
   * Famille (aidants avec le volet « sang ») : le SMS ou le message vocal ne dit jamais qu'il s'agit de sang,
   * ni l'hôpital, ni la date (« bonne nouvelle pour Koffi, ouvrez l'application ») ; en mode discret, pas même
   * le prénom, ni message vocal. Le détail reste derrière la connexion, dans l'application.
   */
  async notifyFamily(req: { id: string; patientId: string; patient: { firstName: string; discreetMode: boolean } }, skipUserId: string | null) {
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
  async closeIfCovered(requestId: string) {
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
}
