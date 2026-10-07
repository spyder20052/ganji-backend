import { ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
import type { Lang, Order, Prisma } from '@prisma/client';
import { note, sms, type TextKey, type Vars } from '../common/i18n';
import { NotificationsService } from '../common/notifications.service';
import { TickRegistry } from '../common/tick.registry';
import { PrismaService } from '../prisma/prisma.service';
import {
  canTransition,
  expiryHours,
  nf,
  ORDER_SCOPES,
  orderRef,
  REMIND_AFTER_MIN,
  RESERVED_STATUSES,
  splitRecipients,
  STATUS_LABEL,
  type OrderEvent,
  type OrderItem,
  type OrderMode,
  type OrderStatus,
} from './orders.logic';

type OrderRef = Pick<Order, 'id' | 'patientId' | 'userId'>;

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
export type FamilyNotice = keyof typeof APP;

const now = () => new Date();

/**
 * Ce qui arrive à une commande quand elle change d'état : automate et concurrence optimiste, stock rendu,
 * mobile money remboursé, famille prévenue dans sa langue ; et la tâche planifiée qui ne laisse aucune
 * commande bloquée.
 */
@Injectable()
export class OrdersWorkflowService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly ticks: TickRegistry,
  ) {}

  onModuleInit() {
    this.ticks.register('orders', () => this.tick());
  }

  // ─── Transitions ─────────────────────────────────────────────────

  /** Changement de statut avec garde (automate + concurrence optimiste) et entrée au journal de la commande. */
  async move(tx: Prisma.TransactionClient, o: Order, to: OrderStatus, by: string, data: Prisma.OrderUpdateManyMutationInput = {}, note?: string) {
    const from = o.status as OrderStatus;
    if (!canTransition(from, to, o.mode as OrderMode)) {
      throw new ConflictException(`Commande ${STATUS_LABEL[from].toLowerCase()} : impossible de la passer à « ${STATUS_LABEL[to].toLowerCase()} ».`);
    }
    const events = [...(o.events as unknown as OrderEvent[]), { status: to, at: now().toISOString(), by, ...(note ? { note } : {}) }];
    const { count } = await tx.order.updateMany({ where: { id: o.id, status: from }, data: { ...data, status: to, events: events as unknown as Prisma.InputJsonValue } });
    if (!count) throw new ConflictException('La commande vient de changer. Actualisez la page.');
  }

  async restoreStock(tx: Prisma.TransactionClient, pharmacyId: string, items: OrderItem[]) {
    for (const it of items) {
      await tx.pharmacyStock.updateMany({ where: { pharmacyId, medicationId: it.medicationId }, data: { quantity: { increment: it.quantity } } });
    }
  }

  /** Bac à sable mobile money : le paiement réussi est marqué remboursé. */
  async refund(tx: Prisma.TransactionClient, o: Order): Promise<boolean> {
    if (o.payment !== 'MOBILE_MONEY' || o.paymentStatus !== 'PAYE') return false;
    const { count } = await tx.payment.updateMany({ where: { kind: 'COMMANDE', ref: `order:${o.id}`, status: 'REUSSI' }, data: { status: 'REMBOURSE' } });
    return count > 0;
  }

  /** Clôture en échec : stock réservé rendu, mobile money remboursé. Renvoie vrai si un remboursement a eu lieu. */
  async closeAsFailed(order: Order, by: string, reason: string): Promise<boolean> {
    let refunded = false;
    await this.prisma.$transaction(async (tx) => {
      refunded = await this.refund(tx, order);
      await this.move(tx, order, 'ECHEC', by, { refusalReason: reason, codeAttempts: 0, ...(refunded ? { paymentStatus: 'REMBOURSE' } : {}) }, reason);
      if (RESERVED_STATUSES.includes(order.status as OrderStatus)) await this.restoreStock(tx, order.pharmacyId, order.items as unknown as OrderItem[]);
    });
    return refunded;
  }

  // ─── Famille prévenue ────────────────────────────────────────────

  /** Motif écrit par la pharmacie (tel quel), ou motif de Ganji dans la langue de chacun. */
  async notifyFailed(order: Order, reason: string | ((lang: Lang) => string), refunded: boolean) {
    const clean = (r: string) => r.replace(/[.\s]+$/, '');
    const vars: Vars = { ref: orderRef(order.id), pharmacy: order.pharmacyName, amount: nf(order.totalFcfa), reason: typeof reason === 'string' ? clean(reason) : (l) => clean(reason(l)) };
    await this.notifyFamily(order, 'failed', vars, (lang) => [sms('order.failed', lang, vars), refunded ? sms('order.refunded', lang, vars) : null].filter(Boolean).join(' '));
  }

  /**
   * Cloche + SMS dans la langue de chacun. Le code de remise ne va qu'au patient (ou à son parent) et à
   * l'auteur de la commande s'il a toujours accès ; les autres aidants (volet « commandes ») reçoivent un
   * texte sans code, ou rien pour un nouveau code.
   */
  async notifyFamily(order: OrderRef, key: FamilyNotice, vars: Vars, smsText: (lang: Lang, withCode: boolean) => string | null) {
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
}
