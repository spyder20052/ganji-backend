import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import type { Facility, Lang, Order, Payment, Prescription, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../common/audit.service';
import { AuthUser } from '../common/auth-user';
import { CryptoService } from '../common/crypto.service';
import { distanceKm } from '../common/geo';
import { NotificationsService } from '../common/notifications.service';
import { note, plural, sms, type TextKey, type Vars } from '../common/i18n';
import { TickRegistry } from '../common/tick.registry';
import { prescriptionSignedString, type PrescriptionItem } from '../medications/medications.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto, OrderOptionsDto } from './orders.dto';
import {
  ACTIVE_STATUSES,
  allowedNext,
  canTransition,
  checkHandoverCode,
  DELIVERY_FEE_OTHER_COMMUNE,
  DELIVERY_FEE_SAME_COMMUNE,
  deliveryFee,
  awaitsHandover,
  codeAttemptsLeft,
  expiryHours,
  handoverStatus,
  MAX_CODE_ATTEMPTS,
  MAX_DELIVERY_KM,
  MAX_NEW_CODES,
  newCodesSent,
  newHandoverCode,
  orderRef,
  PROVIDER,
  PROVIDER_LABEL,
  receiptNumber,
  REMIND_AFTER_MIN,
  requiresPrescription,
  RESERVED_STATUSES,
  splitRecipients,
  STATUS_LABEL,
  type OrderEvent,
  type OrderMode,
  type OrderStatus,
} from './orders.logic';

/** Ligne de commande telle que stockée (JSON). */
export interface OrderItem {
  medicationId: string;
  dci: string;
  form: string;
  strength: string;
  quantity: number;
  unitPriceFcfa: number;
}

type Line = Omit<OrderItem, 'unitPriceFcfa'>;
type Via = 'OWNER' | 'PARENT' | 'DELEGATION';
interface Target {
  patientId: string;
  via: Via;
  /** Commander une ordonnance : titulaire, parent, aidant qui a aussi accès aux ordonnances (« prescriptions » ou « all »). */
  canOrderRx: boolean;
}
type OrderRef = Pick<Order, 'id' | 'patientId' | 'userId'>;

/** Volets de délégation qui permettent de commander pour la personne et de suivre ses commandes. */
export const ORDER_SCOPES = ['orders', 'prescriptions', 'all'];

/**
 * Notifications de la famille dans l'application (cloche), dans la langue de chacun : titre, texte, texte sans
 * code (clés order.n.*). Le code de remise ne va qu'au patient (ou à son parent) et à l'auteur de la commande ;
 * les autres aidants reçoivent le texte sans code, ou rien (codeOnly).
 */
const APP: Record<string, { title: TextKey; body: TextKey; noCode?: TextKey; codeOnly?: boolean }> = {
  received: { title: 'order.n.received.title', body: 'order.n.received.body', noCode: 'order.n.received.noCode' },
  accepted: { title: 'order.n.accepted.title', body: 'order.n.accepted.body' },
  readyDelivery: { title: 'order.n.readyDelivery.title', body: 'order.n.readyDelivery.body' },
  readyPickup: { title: 'order.n.readyPickup.title', body: 'order.n.readyPickup.body', noCode: 'order.n.readyPickup.noCode' },
  dispatched: { title: 'order.n.dispatched.title', body: 'order.n.dispatched.body', noCode: 'order.n.dispatched.noCode' },
  newCode: { title: 'order.n.newCode.title', body: 'order.n.newCode.body', codeOnly: true },
  delivered: { title: 'order.n.delivered.title', body: 'order.n.delivered.body' },
  refused: { title: 'order.n.refused.title', body: 'order.n.refused.body' },
  failed: { title: 'order.n.failed.title', body: 'order.n.failed.body' },
  cancelled: { title: 'order.n.cancelled.title', body: 'order.n.cancelled.body' },
  expired: { title: 'order.n.expired.title', body: 'order.n.expired.body' },
};

const shortName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName.charAt(0)}.`;
const nf = (n: number) => n.toLocaleString('fr-FR').replace(/ | /g, ' ');
const now = () => new Date();

@Injectable()
export class OrdersService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
    private readonly notifications: NotificationsService,
    private readonly ticks: TickRegistry,
  ) {}

  onModuleInit() {
    this.ticks.register('orders', () => this.tick());
  }

  // ─── Patient, parent, aidant ─────────────────────────────────────

  /** Ce qu'il faut pour commander : médicaments, pharmacies qui ont tout en stock (plus proches d'abord), valeurs par défaut. */
  async options(user: AuthUser, q: OrderOptionsDto) {
    const target = await this.target(user, q.patientId);
    const patient = await this.prisma.patient.findUniqueOrThrow({
      where: { id: target.patientId },
      select: { id: true, firstName: true, address: true, commune: { select: { id: true, name: true, lat: true, lng: true } } },
    });

    let lines: Line[];
    let prescription: { id: string; prescriber: string; issuedAt: Date; expiresAt: Date } | null = null;
    let activeOrderId: string | null = null;
    let blocked: string | null = null;
    if (q.rx) {
      if (!target.canOrderRx) throw new ForbiddenException('Les ordonnances de ce patient ne sont pas partagées avec vous.');
      const rx = await this.validPrescription(user, q.rx, patient.id);
      prescription = { id: rx.id, prescriber: rx.prescriberName, issuedAt: rx.issuedAt, expiresAt: rx.expiresAt };
      lines = (rx.items as unknown as PrescriptionItem[]).map((i) => ({ medicationId: i.medicationId, dci: i.dci, form: i.form, strength: i.strength, quantity: i.quantity }));
      activeOrderId = (await this.prisma.order.findFirst({ where: { prescriptionId: rx.id, status: { in: ACTIVE_STATUSES } }, select: { id: true } }))?.id ?? null;
    } else if (q.med) {
      const m = await this.prisma.medication.findUnique({ where: { id: q.med } });
      if (!m) throw new NotFoundException('Médicament introuvable');
      if (requiresPrescription(m)) blocked = 'Ce médicament se commande seulement avec une ordonnance.';
      lines = [{ medicationId: m.id, dci: m.dci, form: m.form, strength: m.strength, quantity: q.qty ?? 1 }];
    } else {
      throw new BadRequestException('Précisez l’ordonnance ou le médicament à commander');
    }

    const me = await this.prisma.user.findUnique({ where: { id: user.id }, select: { phone: true } });
    // Adresse du profil, sinon celle de la dernière livraison.
    const last = patient.address
      ? null
      : await this.prisma.order.findFirst({ where: { patientId: patient.id, mode: 'LIVRAISON', address: { not: null } }, orderBy: { createdAt: 'desc' }, select: { address: true, communeId: true } });
    const commune =
      patient.commune ?? (last?.communeId ? await this.prisma.commune.findUnique({ where: { id: last.communeId }, select: { id: true, name: true, lat: true, lng: true } }) : null);
    return {
      patient: { id: patient.id, firstName: patient.firstName, self: target.via === 'OWNER' },
      source: prescription ? ('ORDONNANCE' as const) : ('LIBRE' as const),
      prescription,
      items: lines,
      activeOrderId,
      blocked,
      defaults: { phone: me?.phone ?? '', address: patient.address ?? last?.address ?? '', commune },
      fees: { sameCommune: DELIVERY_FEE_SAME_COMMUNE, otherCommune: DELIVERY_FEE_OTHER_COMMUNE, maxDeliveryKm: MAX_DELIVERY_KM },
      pharmacies: blocked || activeOrderId ? [] : await this.pharmaciesWithAll(lines, patient.commune),
    };
  }

  async create(user: AuthUser, dto: CreateOrderDto, ip?: string) {
    const target = await this.target(user, dto.patientId);
    if (dto.prescriptionId && dto.items?.length) throw new BadRequestException('Une commande porte sur une ordonnance ou sur une liste de médicaments, pas les deux');
    const pharmacy = await this.prisma.facility.findUnique({ where: { id: dto.pharmacyId } });
    if (!pharmacy || pharmacy.type !== 'PHARMACIE') throw new NotFoundException('Pharmacie introuvable');
    const pharmacyName = pharmacy.shortName ?? pharmacy.name;
    const patient = await this.prisma.patient.findUniqueOrThrow({ where: { id: target.patientId }, select: { id: true, firstName: true, lastName: true, communeId: true } });

    // 1. Ce qui est commandé : l'ordonnance entière (vérifiée) ou des médicaments sans ordonnance.
    let lines: Line[];
    let rx: Prescription | null = null;
    if (dto.prescriptionId) {
      if (!target.canOrderRx) throw new ForbiddenException('Les ordonnances de ce patient ne sont pas partagées avec vous.');
      rx = await this.validPrescription(user, dto.prescriptionId, patient.id, ip);
      await this.assertNotOrdered(rx.id);
      lines = (rx.items as unknown as PrescriptionItem[]).map((i) => ({ medicationId: i.medicationId, dci: i.dci, form: i.form, strength: i.strength, quantity: i.quantity }));
    } else {
      const wanted = dto.items ?? [];
      const ids = wanted.map((i) => i.medicationId);
      if (new Set(ids).size !== ids.length) throw new BadRequestException('Un même médicament figure deux fois dans la commande');
      const meds = new Map((await this.prisma.medication.findMany({ where: { id: { in: ids } } })).map((m) => [m.id, m]));
      lines = wanted.map((i) => {
        const m = meds.get(i.medicationId);
        if (!m) throw new BadRequestException('Médicament inconnu du référentiel');
        if (requiresPrescription(m)) throw new BadRequestException(`${m.dci} se commande seulement avec une ordonnance.`);
        return { medicationId: m.id, dci: m.dci, form: m.form, strength: m.strength, quantity: i.quantity };
      });
    }

    // 2. Stock et prix dans cette pharmacie (prix de l'officine, sinon prix indicatif du référentiel).
    const stocks = new Map(
      (
        await this.prisma.pharmacyStock.findMany({
          where: { pharmacyId: pharmacy.id, medicationId: { in: lines.map((l) => l.medicationId) } },
          include: { medication: { select: { priceFcfa: true } } },
        })
      ).map((s) => [s.medicationId, s]),
    );
    const items: OrderItem[] = lines.map((l) => {
      const s = stocks.get(l.medicationId);
      if (!s || s.quantity < l.quantity) throw new ConflictException(`${l.dci} ${l.strength} : stock insuffisant dans cette pharmacie. Choisissez-en une autre.`);
      const price = s.priceFcfa ?? s.medication.priceFcfa;
      if (price == null) throw new ConflictException(`${l.dci} : prix non communiqué par cette pharmacie. Choisissez-en une autre.`);
      return { ...l, unitPriceFcfa: price };
    });
    const subtotal = items.reduce((sum, i) => sum + i.unitPriceFcfa * i.quantity, 0);

    // 3. Livraison : commune (celle du patient par défaut), distance maximale, frais.
    let communeId: string | null = null;
    if (dto.mode === 'LIVRAISON') {
      communeId = dto.communeId ?? patient.communeId;
      if (!communeId) throw new BadRequestException('Indiquez la commune de livraison');
      const commune = await this.prisma.commune.findUnique({ where: { id: communeId } });
      if (!commune) throw new BadRequestException('Commune inconnue');
      const km = distanceKm(commune.lat, commune.lng, pharmacy.lat, pharmacy.lng);
      if (km > MAX_DELIVERY_KM) {
        throw new BadRequestException(`Cette pharmacie ne livre pas jusqu’à ${commune.name} (${km} km). Choisissez le retrait ou une pharmacie plus proche.`);
      }
    }
    const fee = deliveryFee(dto.mode, pharmacy.communeId, communeId);
    const total = subtotal + fee;

    // 4. Enregistrement ; mobile money : paiement simulé (bac à sable) avant que la pharmacie ne voie la commande.
    const id = randomUUID();
    const ref = orderRef(id);
    const code = newHandoverCode();
    const at = now().toISOString();
    const events: OrderEvent[] = [{ status: 'RECUE', at, by: user.name }];
    let payment: { provider: string; receipt: string } | null = null;
    if (dto.payment === 'MOBILE_MONEY') {
      payment = { provider: PROVIDER[dto.operator!], receipt: receiptNumber('MM') };
      events.push({ status: 'PAYE', at, by: PROVIDER_LABEL[payment.provider], note: payment.receipt });
    }
    await this.prisma.$transaction(async (tx) => {
      if (rx) {
        // Une seule commande en cours par ordonnance, même si deux demandes arrivent en même temps.
        await tx.$queryRaw`SELECT 1 AS ok FROM pg_advisory_xact_lock(hashtext(${rx.id}))`;
        const dup = await tx.order.findFirst({ where: { prescriptionId: rx.id, status: { in: ACTIVE_STATUSES } }, select: { id: true } });
        if (dup) throw new ConflictException(`Cette ordonnance est déjà commandée (commande ${orderRef(dup.id)} en cours).`);
      }
      await tx.order.create({
        data: {
          id,
          patientId: patient.id,
          userId: user.id,
          pharmacyId: pharmacy.id,
          pharmacyName,
          prescriptionId: rx?.id ?? null,
          items: items as unknown as Prisma.InputJsonValue,
          subtotalFcfa: subtotal,
          deliveryFeeFcfa: fee,
          totalFcfa: total,
          mode: dto.mode,
          address: dto.mode === 'LIVRAISON' ? dto.address : null,
          communeId,
          phone: dto.phone,
          instructions: dto.instructions || null,
          payment: dto.payment,
          paymentStatus: payment ? 'PAYE' : 'A_PAYER',
          handoverCode: code,
          events: events as unknown as Prisma.InputJsonValue,
        },
      });
      if (payment) {
        await tx.payment.create({
          data: {
            patientId: patient.id,
            userId: user.id,
            kind: 'COMMANDE',
            ref: `order:${id}`,
            label: `Commande ${ref} · ${pharmacyName}`,
            amountFcfa: total,
            provider: payment.provider,
            phone: dto.payerPhone ?? dto.phone,
            status: 'REUSSI',
            receipt: payment.receipt,
          },
        });
      }
    });

    if (target.via !== 'OWNER') {
      await this.audit.log({ actor: user, patientId: patient.id, action: 'WRITE', resource: `Commande de médicaments ${ref} (${pharmacyName})`, reason: `via ${target.via}`, ip });
    }
    const vars = { ref, pharmacy: pharmacyName, code, amount: nf(total), provider: payment ? PROVIDER_LABEL[payment.provider] : '', receipt: payment?.receipt ?? '' };
    await this.notifyFamily({ id, patientId: patient.id, userId: user.id }, 'received', vars, (lang, withCode) =>
      withCode ? [sms('order.received', lang, vars), payment ? sms('order.paid', lang, vars) : null].filter(Boolean).join(' ') : sms('order.received.family', lang, vars),
    );
    const staff = await this.notifications.usersWithRole('PHARMACIST', pharmacy.id);
    await this.notifications.notify(staff, {
      kind: 'COMMANDE',
      text: note('order.n.staff.new.title', payment ? 'order.n.staff.new.bodyPaid' : 'order.n.staff.new.body', {
        ref,
        patient: shortName(patient),
        items: (l) => plural('order.items', items.length, l),
        mode: (l) => sms(dto.mode === 'LIVRAISON' ? 'order.mode.LIVRAISON' : 'order.mode.RETRAIT', l),
        total: nf(total),
      }),
      href: '/pharmacie#commandes',
      ref: `order:${id}`,
    });
    return this.getMine(user, id);
  }

  /** Mes commandes et celles de mes proches (enfants, personnes aidées avec le volet « commandes »). */
  async listMine(user: AuthUser, patientId?: string, ip?: string) {
    const ids = patientId ? [(await this.target(user, patientId)).patientId] : await this.reachablePatients(user);
    if (!ids.length) return [];
    const rows = await this.prisma.order.findMany({ where: { patientId: { in: ids } }, orderBy: { createdAt: 'desc' }, take: 50 });
    // Lecture par un aidant : inscrite une fois par commande au journal du patient.
    await this.auditReads(user, rows.filter((o) => o.patientId !== user.patientId), 'via DELEGATION', ip);
    return this.presentForPatient(rows);
  }

  async getMine(user: AuthUser, id: string, ip?: string) {
    const o = await this.prisma.order.findUnique({ where: { id } });
    const access = o ? await this.relation(user, o.patientId) : null;
    if (!o || !access) throw new NotFoundException('Commande introuvable');
    if (access.via !== 'OWNER') await this.auditReads(user, [o], `via ${access.via}`, ip);
    return (await this.presentForPatient([o]))[0];
  }

  /** Annulation par le patient (ou son aidant) tant que la pharmacie n'a pas accepté ; mobile money remboursé. */
  async cancel(user: AuthUser, id: string) {
    const o = await this.prisma.order.findUnique({ where: { id } });
    const access = o ? await this.relation(user, o.patientId) : null;
    if (!o || !access) throw new NotFoundException('Commande introuvable');
    if (o.status !== 'RECUE') throw new ConflictException('La pharmacie a déjà accepté la commande : appelez-la pour l’annuler.');
    let refunded = false;
    await this.prisma.$transaction(async (tx) => {
      refunded = await this.refund(tx, o);
      await this.move(tx, o, 'ANNULEE', user.name, refunded ? { paymentStatus: 'REMBOURSE' } : {});
    });
    const vars = { ref: orderRef(o.id), pharmacy: o.pharmacyName, amount: nf(o.totalFcfa) };
    await this.notifyFamily(o, 'cancelled', vars, (lang) => [sms('order.cancelled', lang, vars), refunded ? sms('order.refunded', lang, vars) : null].filter(Boolean).join(' '));
    const staff = await this.notifications.usersWithRole('PHARMACIST', o.pharmacyId);
    await this.notifications.notify(staff, { kind: 'COMMANDE', text: note('order.n.staff.cancelled.title', 'order.n.staff.cancelled.body', vars), href: '/pharmacie#commandes', ref: `order:${o.id}` });
    return this.getMine(user, id);
  }

  // ─── Officine ────────────────────────────────────────────────────

  async listForPharmacy(user: AuthUser, status?: string, ip?: string) {
    const pharmacy = await this.ownPharmacy(user);
    const wanted = (status ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is OrderStatus => s in STATUS_LABEL);
    const since = new Date(Date.now() - 14 * 86_400_000);
    const rows = await this.prisma.order.findMany({
      where: {
        pharmacyId: pharmacy.id,
        ...(wanted.length ? { status: { in: wanted } } : { OR: [{ status: { in: ACTIVE_STATUSES } }, { updatedAt: { gte: since } }] }),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { patient: { select: { firstName: true, lastName: true } } },
    });
    const [communes, prescriptions, payments] = await Promise.all([
      this.prisma.commune.findMany({ where: { id: { in: rows.map((r) => r.communeId).filter((c): c is string => !!c) } }, select: { id: true, name: true } }),
      this.prisma.prescription.findMany({ where: { id: { in: rows.map((r) => r.prescriptionId).filter((c): c is string => !!c) } } }),
      this.prisma.payment.findMany({ where: { kind: 'COMMANDE', ref: { in: rows.map((r) => `order:${r.id}`) } } }),
    ]);
    const communeName = new Map(communes.map((c) => [c.id, c.name]));
    const rxById = new Map(prescriptions.map((p) => [p.id, p]));
    const payByRef = new Map(payments.map((p) => [p.ref, p]));
    // Chaque commande vue par l'officine (médicaments, adresse) est inscrite une fois au journal du patient.
    await this.auditReads(user, rows, pharmacy.shortName ?? pharmacy.name, ip);
    return {
      pharmacy: { id: pharmacy.id, name: pharmacy.name },
      counts: {
        new: rows.filter((r) => r.status === 'RECUE').length,
        inProgress: rows.filter((r) => RESERVED_STATUSES.includes(r.status as OrderStatus)).length,
      },
      orders: rows.map((o) => this.presentForPharmacy(o, o.patient, o.communeId ? communeName.get(o.communeId) : null, o.prescriptionId ? rxById.get(o.prescriptionId) : null, payByRef.get(`order:${o.id}`))),
    };
  }

  /** Acceptation : le stock est réservé (décrémenté) ; une ordonnance doit toujours être valable. */
  async accept(user: AuthUser, id: string, ip?: string) {
    const { pharmacy, order } = await this.pharmacyOrder(user, id);
    if (order.prescriptionId) await this.assertPrescriptionStillValid(order.prescriptionId);
    const items = order.items as unknown as OrderItem[];
    await this.prisma.$transaction(async (tx) => {
      await this.move(tx, order, 'ACCEPTEE', user.name);
      for (const it of items) {
        const { count } = await tx.pharmacyStock.updateMany({
          where: { pharmacyId: pharmacy.id, medicationId: it.medicationId, quantity: { gte: it.quantity } },
          data: { quantity: { decrement: it.quantity } },
        });
        if (!count) throw new ConflictException(`Stock insuffisant : ${it.dci} ${it.strength}. Mettez le stock à jour ou refusez la commande.`);
      }
    });
    await this.audit.log({ actor: user, patientId: order.patientId, action: 'WRITE', resource: `Commande ${orderRef(order.id)} acceptée`, reason: pharmacy.shortName ?? pharmacy.name, ip });
    const vars = { ref: orderRef(order.id), pharmacy: order.pharmacyName };
    await this.notifyFamily(order, 'accepted', vars, (lang) => sms('order.accepted', lang, vars));
    return this.pharmacyView(user, order.id);
  }

  /** Refus (rupture, ordonnance à voir, hors zone…) : stock rendu s'il était réservé, mobile money remboursé. */
  async refuse(user: AuthUser, id: string, reason: string, ip?: string) {
    const { order } = await this.pharmacyOrder(user, id);
    const items = order.items as unknown as OrderItem[];
    let refunded = false;
    await this.prisma.$transaction(async (tx) => {
      refunded = await this.refund(tx, order);
      await this.move(tx, order, 'REFUSEE', user.name, { refusalReason: reason, ...(refunded ? { paymentStatus: 'REMBOURSE' } : {}) }, reason);
      if (RESERVED_STATUSES.includes(order.status as OrderStatus)) await this.restoreStock(tx, order.pharmacyId, items);
    });
    const vars = { ref: orderRef(order.id), pharmacy: order.pharmacyName, amount: nf(order.totalFcfa), reason: reason.replace(/[.\s]+$/, '') };
    await this.notifyFamily(order, 'refused', vars, (lang) => [sms('order.refused', lang, vars), refunded ? sms('order.refunded', lang, vars) : null].filter(Boolean).join(' '));
    await this.audit.log({ actor: user, patientId: order.patientId, action: 'WRITE', resource: `Commande ${orderRef(order.id)} refusée`, reason, ip });
    return this.pharmacyView(user, order.id);
  }

  async ready(user: AuthUser, id: string) {
    const { order } = await this.pharmacyOrder(user, id);
    await this.prisma.$transaction((tx) => this.move(tx, order, 'PRETE', user.name));
    const vars = { ref: orderRef(order.id), pharmacy: order.pharmacyName, code: order.handoverCode, amount: nf(order.totalFcfa) };
    const cash = order.paymentStatus !== 'PAYE';
    if (order.mode === 'RETRAIT') {
      await this.notifyFamily(order, 'readyPickup', vars, (lang, withCode) =>
        withCode ? [sms('order.ready.pickup', lang, vars), cash ? sms('order.cash', lang, vars) : null].filter(Boolean).join(' ') : sms('order.ready.pickup.family', lang, vars),
      );
    } else {
      await this.notifyFamily(order, 'readyDelivery', vars, (lang) => sms('order.ready.delivery', lang, vars));
    }
    return this.pharmacyView(user, order.id);
  }

  async dispatch(user: AuthUser, id: string, courierName: string, courierPhone: string) {
    const { order } = await this.pharmacyOrder(user, id);
    if (order.mode !== 'LIVRAISON') throw new ConflictException('Commande à retirer au comptoir : pas de livreur.');
    await this.prisma.$transaction((tx) => this.move(tx, order, 'EN_LIVRAISON', user.name, { courierName, courierPhone }, courierName));
    const vars = { ref: orderRef(order.id), courier: courierName, courierPhone, code: order.handoverCode, amount: nf(order.totalFcfa) };
    const cash = order.paymentStatus !== 'PAYE';
    await this.notifyFamily(order, 'dispatched', vars, (lang, withCode) =>
      withCode ? [sms('order.dispatched', lang, vars), cash ? sms('order.cash', lang, vars) : null].filter(Boolean).join(' ') : sms('order.dispatched.family', lang, vars),
    );
    return this.pharmacyView(user, order.id);
  }

  /**
   * Remise contre le code à 4 chiffres : livrée (ou retirée), ordonnance marquée délivrée comme au comptoir,
   * espèces encaissées (reçu). Au-delà de 5 codes faux, la remise est bloquée.
   */
  async deliver(user: AuthUser, id: string, code: string, ip?: string) {
    const { pharmacy, order } = await this.pharmacyOrder(user, id);
    const to = handoverStatus(order.mode as OrderMode);
    if (!canTransition(order.status as OrderStatus, to, order.mode as OrderMode)) {
      throw new ConflictException(order.mode === 'LIVRAISON' ? 'La commande doit être en route avant d’être livrée.' : 'Marquez d’abord la commande « prête ».');
    }
    // Compteur atomique AVANT la comparaison : des requêtes parallèles ne peuvent pas dépasser 5 essais.
    const { count: slot } = await this.prisma.order.updateMany({
      where: { id: order.id, status: order.status, codeAttempts: { lt: MAX_CODE_ATTEMPTS } },
      data: { codeAttempts: { increment: 1 } },
    });
    if (slot !== 1) throw new ForbiddenException('Trop de codes faux : envoyez un nouveau code au patient ou déclarez l’échec de remise.');
    if (!checkHandoverCode(order.handoverCode, code)) {
      await this.audit.log({ actor: user, patientId: order.patientId, action: 'DENIED', resource: `Remise de la commande ${orderRef(order.id)}`, reason: 'Code de remise faux', allowed: false, ip });
      const fresh = await this.prisma.order.findUnique({ where: { id: order.id }, select: { codeAttempts: true } });
      const left = codeAttemptsLeft(fresh?.codeAttempts ?? MAX_CODE_ATTEMPTS);
      throw new BadRequestException(left > 0 ? `Code faux. Encore ${left} essai${left > 1 ? 's' : ''}.` : 'Code faux. Remise bloquée : envoyez un nouveau code ou déclarez l’échec.');
    }

    const pharmacyName = pharmacy.shortName ?? pharmacy.name;
    const at = now();
    let receipt = '';
    const handover = this.prisma.$transaction(async (tx) => {
      if (order.prescriptionId) {
        // Même garde que la délivrance au comptoir : une ordonnance ne sert qu'une fois.
        const { count } = await tx.prescription.updateMany({
          where: { id: order.prescriptionId, status: 'ACTIVE', expiresAt: { gt: at } },
          data: { status: 'DISPENSED', dispensedAt: at, dispensedById: user.id, dispensedByName: `${pharmacyName} · ${user.name}` },
        });
        if (!count) throw new ConflictException('Ordonnance plus valable (déjà délivrée ou expirée) : remise impossible. Déclarez l’échec de remise pour rendre le stock.');
      }
      const data: Prisma.OrderUpdateManyMutationInput = { codeAttempts: 0 };
      if (order.paymentStatus !== 'PAYE') {
        receipt = receiptNumber('ES');
        await tx.payment.create({
          data: {
            patientId: order.patientId,
            userId: order.userId,
            kind: 'COMMANDE',
            ref: `order:${order.id}`,
            label: `Commande ${orderRef(order.id)} · ${order.pharmacyName}`,
            amountFcfa: order.totalFcfa,
            provider: 'ESPECES',
            phone: order.phone,
            status: 'REUSSI',
            receipt,
          },
        });
        data.paymentStatus = 'PAYE';
      } else {
        receipt = (await tx.payment.findFirst({ where: { kind: 'COMMANDE', ref: `order:${order.id}`, status: 'REUSSI' } }))?.receipt ?? '';
      }
      await this.move(tx, order, to, user.name, data);
    });
    try {
      await handover;
    } catch (e) {
      // Le bon code a été donné : l'essai consommé est rendu (ce n'était pas une tentative au hasard).
      await this.prisma.order.updateMany({ where: { id: order.id, codeAttempts: { gt: 0 } }, data: { codeAttempts: { decrement: 1 } } });
      throw e;
    }
    await this.audit.log({ actor: user, patientId: order.patientId, action: 'WRITE', resource: order.prescriptionId ? `Délivrance (commande ${orderRef(order.id)})` : `Remise de la commande ${orderRef(order.id)}`, reason: pharmacyName, ip });
    const vars = { ref: orderRef(order.id), receipt: receipt || '—' };
    await this.notifyFamily(order, 'delivered', vars, (lang) => sms('order.delivered', lang, vars));
    return this.pharmacyView(user, order.id);
  }

  /**
   * Remise impossible (patient absent, adresse introuvable, code bloqué, ordonnance expirée entre-temps) :
   * la commande passe en échec, le stock réservé revient, le mobile money est remboursé, la famille est
   * prévenue et l'ordonnance redevient commandable (ou délivrable au comptoir).
   */
  async fail(user: AuthUser, id: string, reason: string, ip?: string) {
    const { order } = await this.pharmacyOrder(user, id);
    const refunded = await this.closeAsFailed(order, user.name, reason);
    await this.audit.log({ actor: user, patientId: order.patientId, action: 'WRITE', resource: `Commande ${orderRef(order.id)} non remise`, reason, ip });
    await this.notifyFailed(order, reason, refunded);
    return this.pharmacyView(user, order.id);
  }

  /**
   * Nouveau code de remise (code perdu ou remise bloquée après 5 codes faux) : envoyé par SMS au patient
   * et à l'auteur de la commande seulement, jamais montré à l'officine. Trois fois au plus par commande.
   */
  async newCode(user: AuthUser, id: string, ip?: string) {
    const { order } = await this.pharmacyOrder(user, id);
    if (!awaitsHandover(order.status as OrderStatus, order.mode as OrderMode)) throw new ConflictException('Aucune remise en attente pour cette commande.');
    const events = order.events as unknown as OrderEvent[];
    if (newCodesSent(events) >= MAX_NEW_CODES) throw new ForbiddenException('Trois nouveaux codes déjà envoyés : déclarez l’échec de remise.');
    const code = newHandoverCode();
    // Concurrence optimiste : deux clics simultanés n'envoient qu'un seul code.
    const { count } = await this.prisma.order.updateMany({
      where: { id: order.id, status: order.status, updatedAt: order.updatedAt },
      data: { handoverCode: code, codeAttempts: 0, events: [...events, { status: 'NOUVEAU_CODE', at: now().toISOString(), by: user.name }] as unknown as Prisma.InputJsonValue },
    });
    if (!count) throw new ConflictException('La commande vient de changer. Actualisez la page.');
    await this.audit.log({ actor: user, patientId: order.patientId, action: 'WRITE', resource: `Nouveau code de remise (commande ${orderRef(order.id)})`, ip });
    const vars = { ref: orderRef(order.id), code };
    await this.notifyFamily(order, 'newCode', vars, (lang, withCode) => (withCode ? sms('order.newcode', lang, vars) : null));
    return this.pharmacyView(user, order.id);
  }

  // ─── Tâche planifiée ─────────────────────────────────────────────

  /**
   * Aucune commande ne reste bloquée : relance de la pharmacie après 30 min sans réponse, annulation
   * (remboursée) après 24 h ; commande acceptée mais jamais remise clôturée en échec après 72 h (stock
   * rendu, remboursement). En démonstration publique, 30 jours pour les deux délais. 200 commandes par passage.
   */
  async tick() {
    const t = Date.now();
    const limits = expiryHours(process.env.DEMO_MODE === 'true');
    let reminded = 0;
    let expired = 0;
    let failed = 0;

    const waiting = await this.prisma.order.findMany({
      where: { status: 'RECUE', createdAt: { lt: new Date(t - REMIND_AFTER_MIN * 60_000) } },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    for (const o of waiting) {
      const events = o.events as unknown as OrderEvent[];
      const ref = orderRef(o.id);
      if (o.createdAt.getTime() < t - limits.unanswered * 3_600_000) {
        let refunded = false;
        try {
          await this.prisma.$transaction(async (tx) => {
            refunded = await this.refund(tx, o);
            await this.move(tx, o, 'ANNULEE', 'Ganji (sans réponse)', refunded ? { paymentStatus: 'REMBOURSE' } : {}, 'Sans réponse de la pharmacie');
          });
        } catch {
          continue; // la commande a changé entre-temps
        }
        const vars = { ref, pharmacy: o.pharmacyName, amount: nf(o.totalFcfa) };
        await this.notifyFamily(o, 'expired', vars, (lang) => [sms('order.expired', lang, vars), refunded ? sms('order.refunded', lang, vars) : null].filter(Boolean).join(' '));
        const staff = await this.notifications.usersWithRole('PHARMACIST', o.pharmacyId);
        await this.notifications.notify(staff, { kind: 'COMMANDE', text: note('order.n.staff.expired.title', 'order.n.staff.expired.body', { ref }), href: '/pharmacie#commandes', ref: `order:${o.id}` });
        expired++;
        continue;
      }
      if (events.some((e) => e.status === 'RAPPEL')) continue;
      const { count } = await this.prisma.order.updateMany({
        where: { id: o.id, status: 'RECUE' },
        data: { events: [...events, { status: 'RAPPEL', at: new Date(t).toISOString(), by: 'Ganji' }] as unknown as Prisma.InputJsonValue },
      });
      if (!count) continue;
      const staff = await this.notifications.usersWithRole('PHARMACIST', o.pharmacyId);
      await this.notifications.notify(staff, {
        kind: 'COMMANDE',
        text: note('order.n.staff.waiting.title', 'order.n.staff.waiting.body', { ref }),
        href: '/pharmacie#commandes',
        sms: (lang) => sms('order.pharmacy.reminder', lang, { ref }),
        ref: `order:${o.id}`,
      });
      reminded++;
    }

    const stuck = await this.prisma.order.findMany({
      where: { status: { in: RESERVED_STATUSES }, updatedAt: { lt: new Date(t - limits.undelivered * 3_600_000) } },
      orderBy: { updatedAt: 'asc' },
      take: 200,
    });
    for (const o of stuck) {
      // Motif enregistré en français (historique de la commande) ; la famille le lit dans sa langue.
      const reason = sms('order.reason.late', 'fr');
      let refunded: boolean;
      try {
        refunded = await this.closeAsFailed(o, 'Ganji (non remise)', reason);
      } catch {
        continue;
      }
      await this.notifyFailed(o, (lang) => sms('order.reason.late', lang), refunded);
      const staff = await this.notifications.usersWithRole('PHARMACIST', o.pharmacyId);
      await this.notifications.notify(staff, { kind: 'COMMANDE', text: note('order.n.staff.closed.title', 'order.n.staff.closed.body', { ref: orderRef(o.id) }), href: '/pharmacie#commandes', ref: `order:${o.id}` });
      failed++;
    }
    return { reminded, expired, failed };
  }

  // ─── Interne ─────────────────────────────────────────────────────

  /** Pour qui commande-t-on ? Soi-même, son enfant, ou une personne aidée (délégation active avec le volet « commandes »). */
  private async target(user: AuthUser, patientId?: string): Promise<Target> {
    if (user.role !== 'PATIENT' && user.role !== 'CAREGIVER') throw new ForbiddenException('Réservé aux patients et à leurs aidants');
    if (!patientId || patientId === user.patientId) {
      if (!user.patientId) throw new BadRequestException('Choisissez la personne pour qui vous commandez');
      return { patientId: user.patientId, via: 'OWNER', canOrderRx: true };
    }
    const t = await this.relation(user, patientId);
    if (!t) {
      await this.audit.log({ actor: user, patientId, action: 'DENIED', resource: 'Commande de médicaments', reason: 'Pas de délégation « commandes » active', allowed: false });
      throw new ForbiddenException('Vous ne pouvez pas commander pour cette personne.');
    }
    return t;
  }

  /**
   * Relation qui ouvre les commandes d'un patient : titulaire, parent, ou aidant dont la délégation active
   * comporte le volet « commandes » (ou « ordonnances », « tout »). Une délégation révoquée ne laisse rien,
   * même sur les commandes que l'aidant a passées lui-même.
   */
  private async relation(user: AuthUser, patientId: string): Promise<Target | null> {
    if (patientId === user.patientId) return { patientId, via: 'OWNER', canOrderRx: true };
    const patient = await this.prisma.patient.findUnique({ where: { id: patientId }, select: { parentId: true } });
    if (!patient) return null;
    if (patient.parentId && user.patientId && patient.parentId === user.patientId) return { patientId, via: 'PARENT', canOrderRx: true };
    const d = await this.prisma.delegation.findFirst({ where: { patientId, caregiverId: user.id, revokedAt: null, scopes: { hasSome: ORDER_SCOPES } } });
    if (d) return { patientId, via: 'DELEGATION', canOrderRx: d.scopes.includes('prescriptions') || d.scopes.includes('all') };
    return null;
  }

  /** Patients dont on suit les commandes : soi, ses enfants, les personnes aidées (volet « commandes »). */
  private async reachablePatients(user: AuthUser): Promise<string[]> {
    const [children, delegated] = await Promise.all([
      user.patientId ? this.prisma.patient.findMany({ where: { parentId: user.patientId }, select: { id: true } }) : [],
      this.prisma.delegation.findMany({ where: { caregiverId: user.id, revokedAt: null, scopes: { hasSome: ORDER_SCOPES } }, select: { patientId: true } }),
    ]);
    return [...new Set([...(user.patientId ? [user.patientId] : []), ...children.map((c) => c.id), ...delegated.map((d) => d.patientId)])];
  }

  /**
   * Lecture d'une commande par quelqu'un d'autre que le titulaire (officine, aidant) : une entrée au journal
   * d'accès du patient par personne et par commande (les écrans se rafraîchissent : pas de doublon).
   */
  private async auditReads(user: AuthUser, orders: Pick<Order, 'id' | 'patientId'>[], reason: string, ip?: string) {
    if (!orders.length) return;
    const resource = (o: { id: string }) => `Commande ${orderRef(o.id)}`;
    const seen = await this.prisma.auditEvent.findMany({
      where: { actorId: user.id, action: 'READ', patientId: { in: [...new Set(orders.map((o) => o.patientId))] }, resource: { in: orders.map(resource) } },
      select: { patientId: true, resource: true },
    });
    const done = new Set(seen.map((e) => `${e.patientId}|${e.resource}`));
    for (const o of orders) {
      if (done.has(`${o.patientId}|${resource(o)}`)) continue;
      await this.audit.log({ actor: user, patientId: o.patientId, action: 'READ', resource: resource(o), reason, ip });
    }
  }

  /** Clôture en échec : stock réservé rendu, mobile money remboursé. Renvoie vrai si un remboursement a eu lieu. */
  private async closeAsFailed(order: Order, by: string, reason: string): Promise<boolean> {
    let refunded = false;
    await this.prisma.$transaction(async (tx) => {
      refunded = await this.refund(tx, order);
      await this.move(tx, order, 'ECHEC', by, { refusalReason: reason, codeAttempts: 0, ...(refunded ? { paymentStatus: 'REMBOURSE' } : {}) }, reason);
      if (RESERVED_STATUSES.includes(order.status as OrderStatus)) await this.restoreStock(tx, order.pharmacyId, order.items as unknown as OrderItem[]);
    });
    return refunded;
  }

  /** Motif écrit par la pharmacie (tel quel), ou motif de Ganji dans la langue de chacun. */
  private async notifyFailed(order: Order, reason: string | ((lang: Lang) => string), refunded: boolean) {
    const clean = (r: string) => r.replace(/[.\s]+$/, '');
    const vars: Vars = { ref: orderRef(order.id), pharmacy: order.pharmacyName, amount: nf(order.totalFcfa), reason: typeof reason === 'string' ? clean(reason) : (l) => clean(reason(l)) };
    await this.notifyFamily(order, 'failed', vars, (lang) => [sms('order.failed', lang, vars), refunded ? sms('order.refunded', lang, vars) : null].filter(Boolean).join(' '));
  }

  private authentic(rx: Prescription): boolean {
    return this.crypto.verify(prescriptionSignedString(rx.id, rx.patientId, rx.items as unknown as PrescriptionItem[]), rx.signature);
  }

  /** Ordonnance du patient, signature valide, non délivrée, non annulée, non expirée. */
  private async validPrescription(user: AuthUser, id: string, patientId: string, ip?: string) {
    const rx = await this.prisma.prescription.findUnique({ where: { id } });
    if (!rx || rx.patientId !== patientId) throw new NotFoundException('Ordonnance introuvable');
    if (!this.authentic(rx)) {
      await this.audit.log({ actor: user, patientId, action: 'DENIED', resource: 'Commande d’ordonnance', reason: 'Signature invalide', allowed: false, ip });
      throw new BadRequestException('Ordonnance non authentique');
    }
    if (rx.status === 'DISPENSED') throw new ConflictException('Ordonnance déjà délivrée : elle ne peut pas resservir.');
    if (rx.status === 'CANCELLED') throw new ConflictException('Ordonnance annulée par le prescripteur.');
    if (rx.expiresAt <= now()) throw new ConflictException('Ordonnance expirée : consultez pour la renouveler.');
    return rx;
  }

  private async assertNotOrdered(prescriptionId: string) {
    const dup = await this.prisma.order.findFirst({ where: { prescriptionId, status: { in: ACTIVE_STATUSES } }, select: { id: true } });
    if (dup) throw new ConflictException(`Cette ordonnance est déjà commandée (commande ${orderRef(dup.id)} en cours).`);
  }

  private async assertPrescriptionStillValid(prescriptionId: string) {
    const rx = await this.prisma.prescription.findUnique({ where: { id: prescriptionId } });
    if (!rx || !this.authentic(rx)) throw new ConflictException('Ordonnance non authentique : refusez la commande.');
    if (rx.status !== 'ACTIVE' || rx.expiresAt <= now()) throw new ConflictException('Ordonnance plus valable (déjà délivrée, annulée ou expirée) : refusez la commande.');
  }

  /** Pharmacies (type PHARMACIE) qui ont TOUTES les lignes en quantité suffisante, avec un prix connu. */
  private async pharmaciesWithAll(lines: Line[], from: { id: string; lat: number; lng: number } | null) {
    const stocks = await this.prisma.pharmacyStock.findMany({
      where: { medicationId: { in: lines.map((l) => l.medicationId) }, pharmacy: { type: 'PHARMACIE' } },
      include: { pharmacy: { include: { commune: { select: { id: true, name: true } } } }, medication: { select: { priceFcfa: true } } },
    });
    const byPharmacy = new Map<string, typeof stocks>();
    for (const s of stocks) byPharmacy.set(s.pharmacyId, [...(byPharmacy.get(s.pharmacyId) ?? []), s]);
    const out = [];
    for (const rows of byPharmacy.values()) {
      const priced = lines.map((l) => {
        const s = rows.find((r) => r.medicationId === l.medicationId);
        const price = s ? (s.priceFcfa ?? s.medication.priceFcfa) : null;
        return s && s.quantity >= l.quantity && price != null ? { medicationId: l.medicationId, quantity: l.quantity, unitPriceFcfa: price } : null;
      });
      if (priced.some((p) => p === null)) continue;
      const f = rows[0].pharmacy;
      const km = from ? distanceKm(from.lat, from.lng, f.lat, f.lng) : null;
      const subtotal = priced.reduce((sum, p) => sum + p!.unitPriceFcfa * p!.quantity, 0);
      out.push({
        id: f.id,
        name: f.name,
        commune: f.commune.name,
        communeId: f.communeId,
        lat: f.lat,
        lng: f.lng,
        phone: f.phone,
        onDuty: f.onDuty,
        open24h: f.open24h,
        distanceKm: km,
        lines: priced,
        subtotalFcfa: subtotal,
        deliverable: km === null || km <= MAX_DELIVERY_KM,
        deliveryFeeFcfa: deliveryFee('LIVRAISON', f.communeId, from?.id),
      });
    }
    out.sort(
      (a, b) =>
        (a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY) ||
        Number(b.onDuty) - Number(a.onDuty) ||
        a.subtotalFcfa - b.subtotalFcfa ||
        a.name.localeCompare(b.name, 'fr'),
    );
    return out.slice(0, 20);
  }

  /** Changement de statut avec garde (automate + concurrence optimiste) et entrée au journal de la commande. */
  private async move(tx: Prisma.TransactionClient, o: Order, to: OrderStatus, by: string, data: Prisma.OrderUpdateManyMutationInput = {}, note?: string) {
    const from = o.status as OrderStatus;
    if (!canTransition(from, to, o.mode as OrderMode)) {
      throw new ConflictException(`Commande ${STATUS_LABEL[from].toLowerCase()} : impossible de la passer à « ${STATUS_LABEL[to].toLowerCase()} ».`);
    }
    const events = [...(o.events as unknown as OrderEvent[]), { status: to, at: now().toISOString(), by, ...(note ? { note } : {}) }];
    const { count } = await tx.order.updateMany({ where: { id: o.id, status: from }, data: { ...data, status: to, events: events as unknown as Prisma.InputJsonValue } });
    if (!count) throw new ConflictException('La commande vient de changer. Actualisez la page.');
  }

  private async restoreStock(tx: Prisma.TransactionClient, pharmacyId: string, items: OrderItem[]) {
    for (const it of items) {
      await tx.pharmacyStock.updateMany({ where: { pharmacyId, medicationId: it.medicationId }, data: { quantity: { increment: it.quantity } } });
    }
  }

  /** Bac à sable mobile money : le paiement réussi est marqué remboursé. */
  private async refund(tx: Prisma.TransactionClient, o: Order): Promise<boolean> {
    if (o.payment !== 'MOBILE_MONEY' || o.paymentStatus !== 'PAYE') return false;
    const { count } = await tx.payment.updateMany({ where: { kind: 'COMMANDE', ref: `order:${o.id}`, status: 'REUSSI' }, data: { status: 'REMBOURSE' } });
    return count > 0;
  }

  private async ownPharmacy(user: AuthUser): Promise<Facility> {
    if (!user.facilityId) throw new ForbiddenException('Compte pharmacien non rattaché à une officine');
    const pharmacy = await this.prisma.facility.findUnique({ where: { id: user.facilityId } });
    if (!pharmacy || pharmacy.type !== 'PHARMACIE') throw new ForbiddenException('Compte pharmacien non rattaché à une officine');
    return pharmacy;
  }

  private async pharmacyOrder(user: AuthUser, id: string) {
    const pharmacy = await this.ownPharmacy(user);
    const order = await this.prisma.order.findFirst({ where: { id, pharmacyId: pharmacy.id } });
    if (!order) throw new NotFoundException('Commande introuvable');
    return { pharmacy, order };
  }

  private async pharmacyView(user: AuthUser, id: string) {
    const { order } = await this.pharmacyOrder(user, id);
    const [patient, commune, rx, pay] = await Promise.all([
      this.prisma.patient.findUniqueOrThrow({ where: { id: order.patientId }, select: { firstName: true, lastName: true } }),
      order.communeId ? this.prisma.commune.findUnique({ where: { id: order.communeId }, select: { name: true } }) : null,
      order.prescriptionId ? this.prisma.prescription.findUnique({ where: { id: order.prescriptionId } }) : null,
      this.prisma.payment.findFirst({ where: { kind: 'COMMANDE', ref: `order:${order.id}` }, orderBy: { createdAt: 'desc' } }),
    ]);
    return this.presentForPharmacy(order, patient, commune?.name ?? null, rx, pay);
  }

  /**
   * Cloche + SMS dans la langue de chacun. Le code de remise ne va qu'au patient (ou à son parent) et à
   * l'auteur de la commande s'il a toujours accès ; les autres aidants (volet « commandes ») reçoivent un
   * texte sans code, ou rien pour un nouveau code.
   */
  private async notifyFamily(order: OrderRef, key: keyof typeof APP, vars: Vars, smsText: (lang: Lang, withCode: boolean) => string | null) {
    const p = await this.prisma.patient.findUnique({
      where: { id: order.patientId },
      select: { userId: true, parent: { select: { userId: true } }, delegations: { where: { revokedAt: null, scopes: { hasSome: ORDER_SCOPES } }, select: { caregiverId: true } } },
    });
    if (!p) return;
    const family = [p.userId, p.parent?.userId].filter((x): x is string => !!x);
    const delegates = p.delegations.map((d) => d.caregiverId);
    const split = splitRecipients(family, delegates, order.userId);
    const holders = new Set(split.holders);
    const others = split.others;
    const entry = APP[key];
    // Deux envois au plus : avec le code (titulaires) et sans (autres aidants) ; chacun dans sa langue.
    for (const withCode of [true, false]) {
      const ids = withCode ? [...holders] : entry.codeOnly ? [] : others;
      if (!ids.length) continue;
      await this.notifications.notify(ids, {
        kind: 'COMMANDE',
        text: note(entry.title, withCode ? entry.body : (entry.noCode ?? entry.body), vars),
        href: `/app/commandes/${order.id}`,
        ...(smsText('fr', withCode) !== null ? { sms: (lang: Lang) => smsText(lang, withCode) ?? '' } : {}),
        ref: `order:${order.id}`,
      });
    }
  }

  /** Vue patient d'une liste de commandes : pharmacies, communes et paiements lus en trois requêtes. */
  private async presentForPatient(orders: Order[]) {
    if (!orders.length) return [];
    const [facilities, communes, payments] = await Promise.all([
      this.prisma.facility.findMany({
        where: { id: { in: [...new Set(orders.map((o) => o.pharmacyId))] } },
        select: { id: true, name: true, phone: true, lat: true, lng: true, commune: { select: { name: true } } },
      }),
      this.prisma.commune.findMany({ where: { id: { in: orders.map((o) => o.communeId).filter((c): c is string => !!c) } }, select: { id: true, name: true } }),
      this.prisma.payment.findMany({ where: { kind: 'COMMANDE', ref: { in: orders.map((o) => `order:${o.id}`) } }, orderBy: { createdAt: 'desc' } }),
    ]);
    const facility = new Map(facilities.map((f) => [f.id, f]));
    const communeName = new Map(communes.map((c) => [c.id, c.name]));
    const payment = new Map<string, Payment>();
    for (const pay of payments) if (pay.ref && !payment.has(pay.ref)) payment.set(pay.ref, pay);
    return orders.map((o) => {
      const pharmacy = facility.get(o.pharmacyId);
      const pay = payment.get(`order:${o.id}`);
      const status = o.status as OrderStatus;
      const items = o.items as unknown as OrderItem[];
      return {
        id: o.id,
        ref: orderRef(o.id),
        status,
        mode: o.mode as OrderMode,
        patientId: o.patientId,
        pharmacy: { id: o.pharmacyId, name: pharmacy?.name ?? o.pharmacyName, commune: pharmacy?.commune.name ?? null, phone: pharmacy?.phone ?? null, lat: pharmacy?.lat ?? null, lng: pharmacy?.lng ?? null },
        prescriptionId: o.prescriptionId,
        itemsHidden: false,
        items,
        itemCount: items.length,
        subtotalFcfa: o.subtotalFcfa,
        deliveryFeeFcfa: o.deliveryFeeFcfa,
        totalFcfa: o.totalFcfa,
        address: o.address,
        commune: o.communeId ? (communeName.get(o.communeId) ?? null) : null,
        phone: o.phone,
        instructions: o.instructions,
        payment: o.payment,
        paymentStatus: o.paymentStatus,
        provider: pay ? (PROVIDER_LABEL[pay.provider] ?? pay.provider) : null,
        receipt: pay?.status === 'REUSSI' || pay?.status === 'REMBOURSE' ? pay.receipt : null,
        courierName: o.courierName,
        courierPhone: o.courierPhone,
        handoverCode: ACTIVE_STATUSES.includes(status) ? o.handoverCode : null,
        refusalReason: o.refusalReason,
        events: (o.events as unknown as OrderEvent[]).filter((e) => e.status in STATUS_LABEL).map((e) => ({ status: e.status, at: e.at })),
        canCancel: status === 'RECUE',
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
      };
    });
  }

  private presentForPharmacy(o: Order, patient: { firstName: string; lastName: string }, communeName: string | null | undefined, rx: Prescription | null | undefined, pay: Payment | null | undefined) {
    const status = o.status as OrderStatus;
    const events = o.events as unknown as OrderEvent[];
    return {
      id: o.id,
      ref: orderRef(o.id),
      status,
      mode: o.mode as OrderMode,
      patient: shortName(patient),
      phone: o.phone,
      address: o.address,
      commune: communeName ?? null,
      instructions: o.instructions,
      items: o.items as unknown as OrderItem[],
      subtotalFcfa: o.subtotalFcfa,
      deliveryFeeFcfa: o.deliveryFeeFcfa,
      totalFcfa: o.totalFcfa,
      payment: o.payment,
      paymentStatus: o.paymentStatus,
      provider: pay ? PROVIDER_LABEL[pay.provider] ?? pay.provider : null,
      prescription: rx ? { id: rx.id, verified: this.authentic(rx), prescriber: rx.prescriberName, issuedAt: rx.issuedAt, status: rx.status } : null,
      courierName: o.courierName,
      courierPhone: o.courierPhone,
      refusalReason: o.refusalReason,
      next: allowedNext(status, o.mode as OrderMode).filter((s) => s !== 'ANNULEE'),
      codeAttemptsLeft: codeAttemptsLeft(o.codeAttempts),
      awaitingCode: awaitsHandover(status, o.mode as OrderMode),
      newCodesLeft: Math.max(0, MAX_NEW_CODES - newCodesSent(events)),
      events: events.filter((e) => e.status in STATUS_LABEL).map((e) => ({ status: e.status, at: e.at, by: e.by })),
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    };
  }
}
