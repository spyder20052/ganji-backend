import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Order, Payment, Prescription, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../common/audit.service';
import { AuthUser } from '../common/auth-user';
import { distanceKm } from '../common/geo';
import { note, plural, sms } from '../common/i18n';
import { shortName } from '../common/names';
import { NotificationsService } from '../common/notifications.service';
import type { PrescriptionItem } from '../medications/medications.logic';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto, OrderOptionsDto } from './orders.dto';
import {
  ACTIVE_STATUSES,
  DELIVERY_FEE_OTHER_COMMUNE,
  DELIVERY_FEE_SAME_COMMUNE,
  deliveryFee,
  MAX_DELIVERY_KM,
  newHandoverCode,
  nf,
  orderRef,
  PROVIDER,
  PROVIDER_LABEL,
  receiptNumber,
  requiresPrescription,
  STATUS_LABEL,
  type OrderEvent,
  type OrderItem,
  type OrderMode,
  type OrderStatus,
} from './orders.logic';
import { OrdersAccessService } from './orders-access.service';
import { OrdersWorkflowService } from './orders-workflow.service';

type Line = Omit<OrderItem, 'unitPriceFcfa'>;
const now = () => new Date();

/** Commandes côté patient, parent ou aidant : préparer, passer, suivre, annuler. */
@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly access: OrdersAccessService,
    private readonly workflow: OrdersWorkflowService,
  ) {}

  /** Ce qu'il faut pour commander : médicaments, pharmacies qui ont tout en stock (plus proches d'abord), valeurs par défaut. */
  async options(user: AuthUser, q: OrderOptionsDto) {
    const target = await this.access.target(user, q.patientId);
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
      const rx = await this.access.validPrescription(user, q.rx, patient.id);
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
    const target = await this.access.target(user, dto.patientId);
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
      rx = await this.access.validPrescription(user, dto.prescriptionId, patient.id, ip);
      await this.access.assertNotOrdered(rx.id);
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
    await this.workflow.notifyFamily({ id, patientId: patient.id, userId: user.id }, 'received', vars, (lang, withCode) =>
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
    const ids = patientId ? [(await this.access.target(user, patientId)).patientId] : await this.access.reachablePatients(user);
    if (!ids.length) return [];
    const rows = await this.prisma.order.findMany({ where: { patientId: { in: ids } }, orderBy: { createdAt: 'desc' }, take: 50 });
    // Lecture par un aidant : inscrite une fois par commande au journal du patient.
    await this.access.auditReads(user, rows.filter((o) => o.patientId !== user.patientId), 'via DELEGATION', ip);
    return this.presentForPatient(rows, user, await this.access.holderPatients(user));
  }

  async getMine(user: AuthUser, id: string, ip?: string) {
    const o = await this.prisma.order.findUnique({ where: { id } });
    const access = o ? await this.access.relation(user, o.patientId) : null;
    if (!o || !access) throw new NotFoundException('Commande introuvable');
    if (access.via !== 'OWNER') await this.access.auditReads(user, [o], `via ${access.via}`, ip);
    return (await this.presentForPatient([o], user, access.via === 'DELEGATION' ? new Set() : new Set([o.patientId])))[0];
  }

  /** Annulation par le patient (ou son aidant) tant que la pharmacie n'a pas accepté ; mobile money remboursé. */
  async cancel(user: AuthUser, id: string) {
    const o = await this.prisma.order.findUnique({ where: { id } });
    const access = o ? await this.access.relation(user, o.patientId) : null;
    if (!o || !access) throw new NotFoundException('Commande introuvable');
    if (o.status !== 'RECUE') throw new ConflictException('La pharmacie a déjà accepté la commande : appelez-la pour l’annuler.');
    let refunded = false;
    await this.prisma.$transaction(async (tx) => {
      refunded = await this.workflow.refund(tx, o);
      await this.workflow.move(tx, o, 'ANNULEE', user.name, refunded ? { paymentStatus: 'REMBOURSE' } : {});
    });
    const vars = { ref: orderRef(o.id), pharmacy: o.pharmacyName, amount: nf(o.totalFcfa) };
    await this.workflow.notifyFamily(o, 'cancelled', vars, (lang) => [sms('order.cancelled', lang, vars), refunded ? sms('order.refunded', lang, vars) : null].filter(Boolean).join(' '));
    const staff = await this.notifications.usersWithRole('PHARMACIST', o.pharmacyId);
    await this.notifications.notify(staff, { kind: 'COMMANDE', text: note('order.n.staff.cancelled.title', 'order.n.staff.cancelled.body', vars), href: '/pharmacie#commandes', ref: `order:${o.id}` });
    return this.getMine(user, id);
  }

  // ─── Interne ─────────────────────────────────────────────────────

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

  /**
   * Vue patient d'une liste de commandes : pharmacies, communes et paiements lus en trois requêtes. Le code de
   * remise n'est rendu qu'aux titulaires (patient, parent) et à l'auteur de la commande : même règle que les
   * SMS (notifyFamily), un aidant « commandes » suit la commande sans pouvoir la retirer à la place du patient.
   */
  private async presentForPatient(orders: Order[], viewer: AuthUser, holderPatientIds: Set<string>) {
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
        handoverCode: ACTIVE_STATUSES.includes(status) && (holderPatientIds.has(o.patientId) || o.userId === viewer.id) ? o.handoverCode : null,
        refusalReason: o.refusalReason,
        events: (o.events as unknown as OrderEvent[]).filter((e) => e.status in STATUS_LABEL).map((e) => ({ status: e.status, at: e.at })),
        canCancel: status === 'RECUE',
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
      };
    });
  }
}
