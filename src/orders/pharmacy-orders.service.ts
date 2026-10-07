import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import type { Order, Payment, Prescription, Prisma } from '@prisma/client';
import { AuditService } from '../common/audit.service';
import { AuthUser } from '../common/auth-user';
import { sms } from '../common/i18n';
import { shortName } from '../common/names';
import { PrismaService } from '../prisma/prisma.service';
import {
  ACTIVE_STATUSES,
  allowedNext,
  awaitsHandover,
  canTransition,
  checkHandoverCode,
  codeAttemptsLeft,
  handoverStatus,
  MAX_CODE_ATTEMPTS,
  MAX_NEW_CODES,
  newCodesSent,
  newHandoverCode,
  nf,
  orderRef,
  PROVIDER_LABEL,
  receiptNumber,
  RESERVED_STATUSES,
  STATUS_LABEL,
  type OrderEvent,
  type OrderItem,
  type OrderMode,
  type OrderStatus,
} from './orders.logic';
import { OrdersAccessService } from './orders-access.service';
import { OrdersWorkflowService } from './orders-workflow.service';

const now = () => new Date();

/**
 * Commandes côté officine : file des commandes, acceptation (stock réservé), préparation, livraison, remise
 * contre le code du patient, échec de remise, nouveau code.
 */
@Injectable()
export class PharmacyOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrdersAccessService,
    private readonly workflow: OrdersWorkflowService,
  ) {}

  async listForPharmacy(user: AuthUser, status?: string, ip?: string) {
    const pharmacy = await this.access.ownPharmacy(user);
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
    await this.access.auditReads(user, rows, pharmacy.shortName ?? pharmacy.name, ip);
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
    const { pharmacy, order } = await this.access.pharmacyOrder(user, id);
    if (order.prescriptionId) await this.access.assertPrescriptionStillValid(order.prescriptionId);
    const items = order.items as unknown as OrderItem[];
    await this.prisma.$transaction(async (tx) => {
      await this.workflow.move(tx, order, 'ACCEPTEE', user.name);
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
    await this.workflow.notifyFamily(order, 'accepted', vars, (lang) => sms('order.accepted', lang, vars));
    return this.pharmacyView(user, order.id);
  }

  /** Refus (rupture, ordonnance à voir, hors zone…) : stock rendu s'il était réservé, mobile money remboursé. */
  async refuse(user: AuthUser, id: string, reason: string, ip?: string) {
    const { order } = await this.access.pharmacyOrder(user, id);
    const items = order.items as unknown as OrderItem[];
    let refunded = false;
    await this.prisma.$transaction(async (tx) => {
      refunded = await this.workflow.refund(tx, order);
      await this.workflow.move(tx, order, 'REFUSEE', user.name, { refusalReason: reason, ...(refunded ? { paymentStatus: 'REMBOURSE' } : {}) }, reason);
      if (RESERVED_STATUSES.includes(order.status as OrderStatus)) await this.workflow.restoreStock(tx, order.pharmacyId, items);
    });
    const vars = { ref: orderRef(order.id), pharmacy: order.pharmacyName, amount: nf(order.totalFcfa), reason: reason.replace(/[.\s]+$/, '') };
    await this.workflow.notifyFamily(order, 'refused', vars, (lang) => [sms('order.refused', lang, vars), refunded ? sms('order.refunded', lang, vars) : null].filter(Boolean).join(' '));
    await this.audit.log({ actor: user, patientId: order.patientId, action: 'WRITE', resource: `Commande ${orderRef(order.id)} refusée`, reason, ip });
    return this.pharmacyView(user, order.id);
  }

  async ready(user: AuthUser, id: string) {
    const { order } = await this.access.pharmacyOrder(user, id);
    await this.prisma.$transaction((tx) => this.workflow.move(tx, order, 'PRETE', user.name));
    const vars = { ref: orderRef(order.id), pharmacy: order.pharmacyName, code: order.handoverCode, amount: nf(order.totalFcfa) };
    const cash = order.paymentStatus !== 'PAYE';
    if (order.mode === 'RETRAIT') {
      await this.workflow.notifyFamily(order, 'readyPickup', vars, (lang, withCode) =>
        withCode ? [sms('order.ready.pickup', lang, vars), cash ? sms('order.cash', lang, vars) : null].filter(Boolean).join(' ') : sms('order.ready.pickup.family', lang, vars),
      );
    } else {
      await this.workflow.notifyFamily(order, 'readyDelivery', vars, (lang) => sms('order.ready.delivery', lang, vars));
    }
    return this.pharmacyView(user, order.id);
  }

  async dispatch(user: AuthUser, id: string, courierName: string, courierPhone: string) {
    const { order } = await this.access.pharmacyOrder(user, id);
    if (order.mode !== 'LIVRAISON') throw new ConflictException('Commande à retirer au comptoir : pas de livreur.');
    await this.prisma.$transaction((tx) => this.workflow.move(tx, order, 'EN_LIVRAISON', user.name, { courierName, courierPhone }, courierName));
    const vars = { ref: orderRef(order.id), courier: courierName, courierPhone, code: order.handoverCode, amount: nf(order.totalFcfa) };
    const cash = order.paymentStatus !== 'PAYE';
    await this.workflow.notifyFamily(order, 'dispatched', vars, (lang, withCode) =>
      withCode ? [sms('order.dispatched', lang, vars), cash ? sms('order.cash', lang, vars) : null].filter(Boolean).join(' ') : sms('order.dispatched.family', lang, vars),
    );
    return this.pharmacyView(user, order.id);
  }

  /**
   * Remise contre le code à 4 chiffres : livrée (ou retirée), ordonnance marquée délivrée comme au comptoir,
   * espèces encaissées (reçu). Au-delà de 5 codes faux, la remise est bloquée.
   */
  async deliver(user: AuthUser, id: string, code: string, ip?: string) {
    const { pharmacy, order } = await this.access.pharmacyOrder(user, id);
    const to = handoverStatus(order.mode as OrderMode);
    if (!canTransition(order.status as OrderStatus, to, order.mode as OrderMode)) {
      throw new ConflictException(order.mode === 'LIVRAISON' ? 'La commande doit être en route avant d’être livrée.' : 'Marquez d’abord la commande « prête ».');
    }
    // Compteur atomique AVANT la comparaison : des requêtes parallèles ne peuvent pas dépasser 5 essais.
    const { count: slot } = await this.prisma.order.updateMany({
      where: { id: order.id, status: order.status, codeAttempts: { lt: MAX_CODE_ATTEMPTS } },
      data: { codeAttempts: { increment: 1 } },
    });
    if (slot !== 1) {
      // Soit les cinq essais sont consommés, soit la commande a changé de statut entre-temps : on le dit.
      const fresh = await this.prisma.order.findUnique({ where: { id: order.id }, select: { status: true } });
      if (fresh && fresh.status !== order.status) throw new ConflictException('La commande vient de changer. Actualisez la page.');
      throw new ForbiddenException('Trop de codes faux : envoyez un nouveau code au patient ou déclarez l’échec de remise.');
    }
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
      await this.workflow.move(tx, order, to, user.name, data);
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
    await this.workflow.notifyFamily(order, 'delivered', vars, (lang) => sms('order.delivered', lang, vars));
    return this.pharmacyView(user, order.id);
  }

  /**
   * Remise impossible (patient absent, adresse introuvable, code bloqué, ordonnance expirée entre-temps) :
   * la commande passe en échec, le stock réservé revient, le mobile money est remboursé, la famille est
   * prévenue et l'ordonnance redevient commandable (ou délivrable au comptoir).
   */
  async fail(user: AuthUser, id: string, reason: string, ip?: string) {
    const { order } = await this.access.pharmacyOrder(user, id);
    const refunded = await this.workflow.closeAsFailed(order, user.name, reason);
    await this.audit.log({ actor: user, patientId: order.patientId, action: 'WRITE', resource: `Commande ${orderRef(order.id)} non remise`, reason, ip });
    await this.workflow.notifyFailed(order, reason, refunded);
    return this.pharmacyView(user, order.id);
  }

  /**
   * Nouveau code de remise (code perdu ou remise bloquée après 5 codes faux) : envoyé par SMS au patient
   * et à l'auteur de la commande seulement, jamais montré à l'officine. Trois fois au plus par commande.
   */
  async newCode(user: AuthUser, id: string, ip?: string) {
    const { order } = await this.access.pharmacyOrder(user, id);
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
    await this.workflow.notifyFamily(order, 'newCode', vars, (lang, withCode) => (withCode ? sms('order.newcode', lang, vars) : null));
    return this.pharmacyView(user, order.id);
  }

  // ─── Interne ─────────────────────────────────────────────────────

  private async pharmacyView(user: AuthUser, id: string) {
    const { order } = await this.access.pharmacyOrder(user, id);
    const [patient, commune, rx, pay] = await Promise.all([
      this.prisma.patient.findUniqueOrThrow({ where: { id: order.patientId }, select: { firstName: true, lastName: true } }),
      order.communeId ? this.prisma.commune.findUnique({ where: { id: order.communeId }, select: { name: true } }) : null,
      order.prescriptionId ? this.prisma.prescription.findUnique({ where: { id: order.prescriptionId } }) : null,
      this.prisma.payment.findFirst({ where: { kind: 'COMMANDE', ref: `order:${order.id}` }, orderBy: { createdAt: 'desc' } }),
    ]);
    return this.presentForPharmacy(order, patient, commune?.name ?? null, rx, pay);
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
      prescription: rx ? { id: rx.id, verified: this.access.authentic(rx), prescriber: rx.prescriberName, issuedAt: rx.issuedAt, status: rx.status } : null,
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
