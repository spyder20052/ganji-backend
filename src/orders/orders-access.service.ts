import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Facility, Order, Prescription } from '@prisma/client';
import { AuditService } from '../common/audit.service';
import { AuthUser } from '../common/auth-user';
import { CryptoService } from '../common/crypto.service';
import { prescriptionSignedString, type PrescriptionItem } from '../medications/medications.logic';
import { PrismaService } from '../prisma/prisma.service';
import { ACTIVE_STATUSES, ORDER_SCOPES, orderRef } from './orders.logic';

export type Via = 'OWNER' | 'PARENT' | 'DELEGATION';
export interface Target {
  patientId: string;
  via: Via;
  /** Commander une ordonnance : titulaire, parent, aidant qui a aussi accès aux ordonnances (« prescriptions » ou « all »). */
  canOrderRx: boolean;
}

const now = () => new Date();

/**
 * Qui peut quoi autour d'une commande : pour qui l'on commande (soi, son enfant, une personne aidée), quelles
 * commandes on suit, quelle officine agit, et ce qu'une ordonnance permet encore (signature, statut, échéance).
 */
@Injectable()
export class OrdersAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
  ) {}

  // ─── Patient, parent, aidant ─────────────────────────────────────

  /** Pour qui commande-t-on ? Soi-même, son enfant, ou une personne aidée (délégation active avec le volet « commandes »). */
  async target(user: AuthUser, patientId?: string): Promise<Target> {
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
  async relation(user: AuthUser, patientId: string): Promise<Target | null> {
    if (patientId === user.patientId) return { patientId, via: 'OWNER', canOrderRx: true };
    const patient = await this.prisma.patient.findUnique({ where: { id: patientId }, select: { parentId: true } });
    if (!patient) return null;
    if (patient.parentId && user.patientId && patient.parentId === user.patientId) return { patientId, via: 'PARENT', canOrderRx: true };
    const d = await this.prisma.delegation.findFirst({ where: { patientId, caregiverId: user.id, revokedAt: null, scopes: { hasSome: ORDER_SCOPES } } });
    if (d) return { patientId, via: 'DELEGATION', canOrderRx: d.scopes.includes('prescriptions') || d.scopes.includes('all') };
    return null;
  }

  /** Patients dont on est « titulaire » des commandes (soi, ses enfants) : eux seuls voient le code de remise. */
  async holderPatients(user: AuthUser): Promise<Set<string>> {
    const children = user.patientId ? await this.prisma.patient.findMany({ where: { parentId: user.patientId }, select: { id: true } }) : [];
    return new Set([...(user.patientId ? [user.patientId] : []), ...children.map((c) => c.id)]);
  }

  /** Patients dont on suit les commandes : soi, ses enfants, les personnes aidées (volet « commandes »). */
  async reachablePatients(user: AuthUser): Promise<string[]> {
    const delegated = await this.prisma.delegation.findMany({ where: { caregiverId: user.id, revokedAt: null, scopes: { hasSome: ORDER_SCOPES } }, select: { patientId: true } });
    return [...new Set([...(await this.holderPatients(user)), ...delegated.map((d) => d.patientId)])];
  }

  /**
   * Lecture d'une commande par quelqu'un d'autre que le titulaire (officine, aidant) : une entrée au journal
   * d'accès du patient par personne et par commande (les écrans se rafraîchissent : pas de doublon).
   */
  async auditReads(user: AuthUser, orders: Pick<Order, 'id' | 'patientId'>[], reason: string, ip?: string) {
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

  // ─── Ordonnance ──────────────────────────────────────────────────

  /** Signature du prescripteur intacte : l'ordonnance n'a pas été modifiée depuis sa rédaction. */
  authentic(rx: Prescription): boolean {
    return this.crypto.verify(prescriptionSignedString(rx.id, rx.patientId, rx.items as unknown as PrescriptionItem[]), rx.signature);
  }

  /** Ordonnance du patient, signature valide, non délivrée, non annulée, non expirée. */
  async validPrescription(user: AuthUser, id: string, patientId: string, ip?: string) {
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

  async assertNotOrdered(prescriptionId: string) {
    const dup = await this.prisma.order.findFirst({ where: { prescriptionId, status: { in: ACTIVE_STATUSES } }, select: { id: true } });
    if (dup) throw new ConflictException(`Cette ordonnance est déjà commandée (commande ${orderRef(dup.id)} en cours).`);
  }

  async assertPrescriptionStillValid(prescriptionId: string) {
    const rx = await this.prisma.prescription.findUnique({ where: { id: prescriptionId } });
    if (!rx || !this.authentic(rx)) throw new ConflictException('Ordonnance non authentique : refusez la commande.');
    if (rx.status !== 'ACTIVE' || rx.expiresAt <= now()) throw new ConflictException('Ordonnance plus valable (déjà délivrée, annulée ou expirée) : refusez la commande.');
  }

  // ─── Officine ────────────────────────────────────────────────────

  async ownPharmacy(user: AuthUser): Promise<Facility> {
    if (!user.facilityId) throw new ForbiddenException('Compte pharmacien non rattaché à une officine');
    const pharmacy = await this.prisma.facility.findUnique({ where: { id: user.facilityId } });
    if (!pharmacy || pharmacy.type !== 'PHARMACIE') throw new ForbiddenException('Compte pharmacien non rattaché à une officine');
    return pharmacy;
  }

  /** Une commande de l'officine du pharmacien connecté, et rien d'autre. */
  async pharmacyOrder(user: AuthUser, id: string) {
    const pharmacy = await this.ownPharmacy(user);
    const order = await this.prisma.order.findFirst({ where: { id, pharmacyId: pharmacy.id } });
    if (!order) throw new NotFoundException('Commande introuvable');
    return { pharmacy, order };
  }
}
