import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prescription } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AccessService } from '../common/access.service';
import { AuditService } from '../common/audit.service';
import { AuthUser } from '../common/auth-user';
import { CryptoService } from '../common/crypto.service';
import { distanceKm } from '../common/geo';
import { sms } from '../common/i18n';
import { OutboxService } from '../common/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePrescriptionDto, PharmacyStockDto } from './medications.dto';

/** Ligne d'ordonnance telle que stockée (JSON) et signée. */
export type PrescriptionItem = {
  medicationId: string;
  dci: string;
  form: string;
  strength: string;
  dosage: string;
  duration: string;
  quantity: number;
};

export type PrescriptionStatus = 'ACTIVE' | 'DISPENSED' | 'EXPIRED' | 'CANCELLED';

const STATUS_LABEL: Record<PrescriptionStatus, string> = {
  ACTIVE: 'Valide',
  DISPENSED: 'Délivrée',
  EXPIRED: 'Expirée',
  CANCELLED: 'Annulée',
};

/** En dessous de ce seuil, le public voit « stock faible » (jamais le nombre exact). */
const LOW_STOCK = 5;
const DEFAULT_VALIDITY_DAYS = 30;
const RX_PAYLOAD = /^(?:ganji:rx:)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{16,64})$/i;

/**
 * Chaîne signée d'une ordonnance. Les lignes sont sérialisées dans un ordre de
 * champs fixe : PostgreSQL (jsonb) ne conserve pas l'ordre des clés, un simple
 * JSON.stringify de la valeur relue ne redonnerait pas la chaîne signée.
 * À réutiliser tel quel par tout code qui crée des ordonnances (jeu de données de démo compris).
 */
export function prescriptionSignedString(id: string, patientId: string, items: PrescriptionItem[]): string {
  const canonical = items.map((i) => [i.medicationId, i.dci, i.form, i.strength, i.dosage, i.duration, i.quantity]);
  return `${id}|${patientId}|${JSON.stringify(canonical)}`;
}

function fmtDate(d: Date) {
  return d.toLocaleString('fr-FR', { timeZone: 'Africa/Porto-Novo', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function shortName(p: { firstName: string; lastName: string }) {
  return `${p.firstName} ${p.lastName.charAt(0)}.`;
}

@Injectable()
export class MedicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
    private readonly outbox: OutboxService,
  ) {}

  // ─── Recherche publique ──────────────────────────────────────────

  /**
   * Recherche par DCI, classe ou code ATC (insensible à la casse). Si rien ne
   * correspond, on retente en ignorant les accents (« artemether » trouve
   * « Artéméther ») : le référentiel compte quelques centaines de lignes.
   */
  async search(q: string) {
    const term = q.trim();
    const stocks = {
      where: { quantity: { gt: 0 }, pharmacy: { type: 'PHARMACIE' } },
      select: { priceFcfa: true },
    } as const;
    let rows = await this.prisma.medication.findMany({
      where: {
        OR: [
          { dci: { contains: term, mode: 'insensitive' } },
          { category: { contains: term, mode: 'insensitive' } },
          { atc: { startsWith: term.toUpperCase() } },
        ],
      },
      include: { stocks },
      orderBy: [{ dci: 'asc' }, { strength: 'asc' }],
      take: 20,
    });
    if (rows.length === 0) {
      const folded = fold(term);
      const ids = (await this.prisma.medication.findMany({ select: { id: true, dci: true } }))
        .filter((m) => fold(m.dci).includes(folded))
        .slice(0, 20)
        .map((m) => m.id);
      if (ids.length) {
        rows = await this.prisma.medication.findMany({ where: { id: { in: ids } }, include: { stocks }, orderBy: [{ dci: 'asc' }, { strength: 'asc' }] });
      }
    }
    return rows.map((m) => {
      const prices = m.stocks.map((s) => s.priceFcfa ?? m.priceFcfa).filter((p): p is number => p !== null);
      return {
        id: m.id,
        dci: m.dci,
        form: m.form,
        strength: m.strength,
        category: m.category,
        atc: m.atc,
        chronic: m.chronic,
        indicativePriceFcfa: m.priceFcfa,
        pharmaciesInStock: m.stocks.length,
        minPriceFcfa: prices.length ? Math.min(...prices) : null,
      };
    });
  }

  /** Pharmacies ayant le médicament en stock : de garde d'abord, puis les plus proches. */
  async pharmaciesFor(medicationId: string, lat?: number, lng?: number) {
    const medication = await this.prisma.medication.findUnique({ where: { id: medicationId } });
    if (!medication) throw new NotFoundException('Médicament introuvable');
    const stocks = await this.prisma.pharmacyStock.findMany({
      where: { medicationId, quantity: { gt: 0 }, pharmacy: { type: 'PHARMACIE' } },
      include: { pharmacy: { include: { commune: { select: { name: true } } } } },
    });
    const pharmacies = stocks.map((s) => ({
      ...this.pharmacyView(s.pharmacy, lat, lng),
      priceFcfa: s.priceFcfa ?? medication.priceFcfa,
      availability: s.quantity < LOW_STOCK ? ('stock faible' as const) : ('disponible' as const),
      updatedAt: s.updatedAt,
    }));
    pharmacies.sort(
      (a, b) =>
        Number(b.onDuty) - Number(a.onDuty) ||
        (a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY) ||
        a.name.localeCompare(b.name, 'fr'),
    );
    return {
      medication: { id: medication.id, dci: medication.dci, form: medication.form, strength: medication.strength },
      pharmacies,
    };
  }

  async onDutyPharmacies(lat?: number, lng?: number) {
    const rows = await this.prisma.facility.findMany({
      where: { type: 'PHARMACIE', onDuty: true },
      include: { commune: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
    const list = rows.map((f) => this.pharmacyView(f, lat, lng));
    if (lat !== undefined && lng !== undefined) list.sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
    return list;
  }

  // ─── Ordonnances ─────────────────────────────────────────────────

  async createPrescription(user: AuthUser, dto: CreatePrescriptionDto, ip?: string) {
    await this.access.assert(user, dto.patientId, 'prescriptions', 'Ordonnance', ip);

    const ids = dto.items.map((i) => i.medicationId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Un même médicament figure deux fois sur l’ordonnance');
    const medications = await this.prisma.medication.findMany({ where: { id: { in: ids } } });
    const byId = new Map(medications.map((m) => [m.id, m]));
    const items: PrescriptionItem[] = dto.items.map((i) => {
      const m = byId.get(i.medicationId);
      if (!m) throw new BadRequestException(`Médicament inconnu du référentiel : ${i.medicationId}`);
      return { medicationId: m.id, dci: m.dci, form: m.form, strength: m.strength, dosage: i.dosage, duration: i.duration, quantity: i.quantity };
    });

    // L'identifiant est généré ici pour que la signature le couvre.
    const id = randomUUID();
    const issuedAt = new Date();
    const rx = await this.prisma.prescription.create({
      data: {
        id,
        patientId: dto.patientId,
        prescriberId: user.id,
        prescriberName: user.name,
        items,
        signature: this.crypto.sign(prescriptionSignedString(id, dto.patientId, items)),
        issuedAt,
        expiresAt: new Date(issuedAt.getTime() + (dto.validityDays ?? DEFAULT_VALIDITY_DAYS) * 86_400_000),
      },
    });
    await this.audit.log({ actor: user, patientId: dto.patientId, action: 'WRITE', resource: `Ordonnance (${items.length} médicament${items.length > 1 ? 's' : ''})`, ip });
    return this.present(rx, true);
  }

  async myPrescriptions(user: AuthUser) {
    if (!user.patientId) throw new ForbiddenException('Réservé au titulaire du carnet');
    const rows = await this.prisma.prescription.findMany({ where: { patientId: user.patientId }, orderBy: { issuedAt: 'desc' }, take: 50 });
    return rows.map((r) => this.present(r, true));
  }

  async patientPrescriptions(user: AuthUser, patientId: string, ip?: string) {
    const decision = await this.access.assert(user, patientId, 'prescriptions', 'Ordonnances', ip);
    // Le QR (qui permet la délivrance) n'est remis qu'au patient, à son parent ou à son aidant.
    const withQr = decision.via === 'OWNER' || decision.via === 'PARENT' || decision.via === 'DELEGATION';
    const rows = await this.prisma.prescription.findMany({ where: { patientId }, orderBy: { issuedAt: 'desc' }, take: 50 });
    return rows.map((r) => this.present(r, withQr));
  }

  /** Vérification en officine : le pharmacien voit l'ordonnance, jamais le dossier. */
  async verify(user: AuthUser, payload: string, ip?: string) {
    const { rx, patient } = await this.authenticate(user, payload, ip);
    await this.audit.log({ actor: user, patientId: rx.patientId, action: 'READ', resource: 'Ordonnance (vérification en officine)', ip });
    return this.pharmacistView(rx, patient);
  }

  async dispense(user: AuthUser, payload: string, ip?: string) {
    const pharmacy = await this.ownPharmacy(user);
    const { rx, patient } = await this.authenticate(user, payload, ip);
    const items = rx.items as unknown as PrescriptionItem[];
    const now = new Date();
    const pharmacyName = pharmacy.shortName ?? pharmacy.name;

    // Ordonnance commandée en ligne (livraison ou retrait, module orders) : elle se délivre par sa commande.
    const ordered = await this.prisma.order.findFirst({
      where: { prescriptionId: rx.id, status: { in: ['RECUE', 'ACCEPTEE', 'PRETE', 'EN_LIVRAISON'] } },
      select: { pharmacyName: true },
    });
    if (ordered) {
      await this.audit.log({ actor: user, patientId: rx.patientId, action: 'DENIED', resource: 'Délivrance d’ordonnance', reason: `Commande en cours chez ${ordered.pharmacyName}`, allowed: false, ip });
      throw new ConflictException(`Ordonnance commandée chez ${ordered.pharmacyName} (commande en cours) : elle se délivre avec cette commande, pas au comptoir.`);
    }

    const dispensed = await this.prisma.$transaction(async (tx) => {
      // Garde atomique : une seule délivrance possible, même en cas de double scan simultané.
      const { count } = await tx.prescription.updateMany({
        where: { id: rx.id, status: 'ACTIVE', expiresAt: { gt: now } },
        data: { status: 'DISPENSED', dispensedAt: now, dispensedById: user.id, dispensedByName: `${pharmacyName} · ${user.name}` },
      });
      if (count === 0) return false;
      for (const item of items) {
        // Stock insuffisant : ramené à 0 (jamais négatif), sinon décrémenté.
        await tx.pharmacyStock.updateMany({
          where: { pharmacyId: pharmacy.id, medicationId: item.medicationId, quantity: { lt: item.quantity } },
          data: { quantity: 0 },
        });
        await tx.pharmacyStock.updateMany({
          where: { pharmacyId: pharmacy.id, medicationId: item.medicationId, quantity: { gte: item.quantity } },
          data: { quantity: { decrement: item.quantity } },
        });
      }
      return true;
    });

    if (!dispensed) {
      const current = await this.prisma.prescription.findUniqueOrThrow({ where: { id: rx.id } });
      await this.audit.log({ actor: user, patientId: rx.patientId, action: 'DENIED', resource: 'Délivrance d’ordonnance', reason: STATUS_LABEL[this.status(current)], allowed: false, ip });
      throw new ConflictException(this.refusal(current));
    }

    await this.audit.log({ actor: user, patientId: rx.patientId, action: 'WRITE', resource: 'Délivrance', reason: pharmacyName, ip });
    // Titulaire du carnet, ou son parent pour un enfant : SMS dans la langue de celui qui le reçoit.
    const holder = patient.user?.phone ? patient.user : patient.parent?.user;
    if (holder?.phone) {
      await this.outbox.send({
        channel: 'SMS',
        to: holder.phone,
        lang: holder.lang,
        body: sms('medications.dispensed', holder.lang, { pharmacy: pharmacyName }),
        ref: `prescription:${rx.id}`,
      });
    }
    const updated = await this.prisma.prescription.findUniqueOrThrow({ where: { id: rx.id } });
    return this.pharmacistView(updated, patient);
  }

  // ─── Officine ────────────────────────────────────────────────────

  async stock(user: AuthUser) {
    const pharmacy = await this.ownPharmacy(user);
    const rows = await this.prisma.pharmacyStock.findMany({
      where: { pharmacyId: pharmacy.id },
      include: { medication: { select: { id: true, dci: true, form: true, strength: true, category: true, priceFcfa: true } } },
      orderBy: { medication: { dci: 'asc' } },
    });
    return {
      pharmacy: { id: pharmacy.id, name: pharmacy.name, onDuty: pharmacy.onDuty },
      items: rows.map((s) => ({
        medication: s.medication,
        quantity: s.quantity,
        priceFcfa: s.priceFcfa,
        low: s.quantity < LOW_STOCK,
        updatedAt: s.updatedAt,
      })),
    };
  }

  async setStock(user: AuthUser, dto: PharmacyStockDto) {
    const pharmacy = await this.ownPharmacy(user);
    const medication = await this.prisma.medication.findUnique({ where: { id: dto.medicationId } });
    if (!medication) throw new NotFoundException('Médicament introuvable');
    const row = await this.prisma.pharmacyStock.upsert({
      where: { pharmacyId_medicationId: { pharmacyId: pharmacy.id, medicationId: medication.id } },
      update: { quantity: dto.quantity, ...(dto.priceFcfa !== undefined ? { priceFcfa: dto.priceFcfa } : {}) },
      create: { pharmacyId: pharmacy.id, medicationId: medication.id, quantity: dto.quantity, priceFcfa: dto.priceFcfa },
    });
    await this.audit.log({ actor: user, action: 'WRITE', resource: `Stock officine : ${medication.dci} ${medication.strength} = ${dto.quantity}` });
    return { medicationId: row.medicationId, quantity: row.quantity, priceFcfa: row.priceFcfa, updatedAt: row.updatedAt };
  }

  async setOnDuty(user: AuthUser, onDuty: boolean) {
    const pharmacy = await this.ownPharmacy(user);
    await this.prisma.facility.update({ where: { id: pharmacy.id }, data: { onDuty } });
    await this.audit.log({ actor: user, action: 'WRITE', resource: `Garde ${onDuty ? 'ouverte' : 'fermée'} : ${pharmacy.name}` });
    return { id: pharmacy.id, onDuty };
  }

  // ─── Interne ─────────────────────────────────────────────────────

  private async ownPharmacy(user: AuthUser) {
    if (!user.facilityId) throw new ForbiddenException('Compte pharmacien non rattaché à une officine');
    const pharmacy = await this.prisma.facility.findUnique({ where: { id: user.facilityId } });
    if (!pharmacy || pharmacy.type !== 'PHARMACIE') throw new ForbiddenException('Compte pharmacien non rattaché à une officine');
    return pharmacy;
  }

  /** Lit le QR, retrouve l'ordonnance et vérifie sa signature. Toute anomalie est journalisée. */
  private async authenticate(user: AuthUser, payload: string, ip?: string) {
    const match = RX_PAYLOAD.exec(payload.trim());
    const rx = match
      ? await this.prisma.prescription.findUnique({
          where: { id: match[1].toLowerCase() },
          include: {
            patient: {
              select: {
                firstName: true,
                lastName: true,
                user: { select: { phone: true, lang: true } },
                parent: { select: { user: { select: { phone: true, lang: true } } } },
              },
            },
          },
        })
      : null;
    const authentic =
      !!match &&
      !!rx &&
      this.crypto.safeEqual(match[2], rx.signature) &&
      this.crypto.verify(prescriptionSignedString(rx.id, rx.patientId, rx.items as unknown as PrescriptionItem[]), match[2]);
    if (!match || !rx || !authentic) {
      await this.audit.log({
        actor: user,
        patientId: rx?.patientId ?? null,
        action: 'DENIED',
        resource: 'Ordonnance (vérification en officine)',
        reason: 'Signature invalide ou QR inconnu',
        allowed: false,
        ip,
      });
      throw new BadRequestException('Ordonnance non authentique');
    }
    const { patient, ...prescription } = rx;
    return { rx: prescription, patient };
  }

  private status(rx: Prescription, now = new Date()): PrescriptionStatus {
    if (rx.status === 'DISPENSED') return 'DISPENSED';
    if (rx.status === 'CANCELLED') return 'CANCELLED';
    return rx.expiresAt <= now ? 'EXPIRED' : 'ACTIVE';
  }

  private refusal(rx: Prescription): string {
    switch (this.status(rx)) {
      case 'DISPENSED':
        return `Ordonnance déjà délivrée le ${fmtDate(rx.dispensedAt ?? rx.issuedAt)} par ${rx.dispensedByName ?? 'une autre pharmacie'}. Elle ne peut pas resservir.`;
      case 'EXPIRED':
        return `Ordonnance expirée depuis le ${fmtDate(rx.expiresAt)}. Le patient doit consulter pour une nouvelle ordonnance.`;
      case 'CANCELLED':
        return 'Ordonnance annulée par le prescripteur. Elle ne peut pas être délivrée.';
      default:
        return 'Ordonnance non délivrable pour le moment. Réessayez.';
    }
  }

  private present(rx: Prescription, withQr: boolean) {
    const status = this.status(rx);
    return {
      id: rx.id,
      status,
      statusLabel: STATUS_LABEL[status],
      items: rx.items as unknown as PrescriptionItem[],
      prescriber: rx.prescriberName,
      issuedAt: rx.issuedAt,
      expiresAt: rx.expiresAt,
      dispensedAt: rx.dispensedAt,
      dispensedByName: rx.dispensedByName,
      qrPayload: withQr && status === 'ACTIVE' ? `ganji:rx:${rx.id}.${rx.signature}` : undefined,
    };
  }

  private pharmacistView(rx: Prescription, patient: { firstName: string; lastName: string }) {
    const status = this.status(rx);
    return {
      authentic: true,
      id: rx.id,
      status,
      statusLabel: STATUS_LABEL[status],
      canDispense: status === 'ACTIVE',
      patient: shortName(patient),
      prescriber: rx.prescriberName,
      issuedAt: rx.issuedAt,
      expiresAt: rx.expiresAt,
      items: rx.items as unknown as PrescriptionItem[],
      ...(status === 'DISPENSED' ? { dispensedAt: rx.dispensedAt, dispensedByName: rx.dispensedByName } : {}),
    };
  }

  private pharmacyView(
    f: { id: string; name: string; shortName: string | null; lat: number; lng: number; phone: string | null; onDuty: boolean; open24h: boolean; commune: { name: string } },
    lat?: number,
    lng?: number,
  ) {
    return {
      id: f.id,
      name: f.name,
      shortName: f.shortName,
      commune: f.commune.name,
      lat: f.lat,
      lng: f.lng,
      phone: f.phone,
      onDuty: f.onDuty,
      open24h: f.open24h,
      distanceKm: lat !== undefined && lng !== undefined ? distanceKm(lat, lng, f.lat, f.lng) : null,
    };
  }
}

/** Minuscules sans accents, pour une comparaison tolérante. */
function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}
