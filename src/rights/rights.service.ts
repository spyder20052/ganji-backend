import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Coverage, type Payment } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { normalizePhone } from '../auth/auth.dto';
import type { AuthUser } from '../common/auth-user';
import { CryptoService } from '../common/crypto.service';
import { NotificationsService } from '../common/notifications.service';
import { defineSms, sms } from '../common/sms';
import { PrismaService } from '../prisma/prisma.service';
import { COVERAGE_REGISTRY, type CoverageRegistry, type RegistryReason, normalizeArch } from './coverage-registry';
import { MOBILE_MONEY, type MobileMoneyGateway, PROVIDER_LABEL } from './mobile-money';
import { ESTIMATE_TTL_MS, readEstimate, receiptLabel, signEstimate } from './estimate-token';
import type { CoverageDto, EstimateDto, PaymentDto } from './rights.dto';

defineSms({
  'rights.payment': {
    fr: 'Ganji : paiement de {amount} FCFA reçu. Reçu n° {receipt}. Détails dans l’application.',
    en: 'Ganji: payment of {amount} FCFA received. Receipt no. {receipt}. Details in the app.',
  },
});

/** 12500 → « 12 500 » (espaces simples : lisibles sur tous les téléphones). */
function amountText(n: number) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** « 0190000001 » → « 01 •• •• 00 01 » : le reçu se montre, le numéro complet ne s'affiche pas. */
export function maskPhone(p: string | null) {
  if (!p) return null;
  const d = p.replace(/\D/g, '');
  return d.length >= 8 ? `${d.slice(0, 2)} •• •• ${d.slice(-4, -2)} ${d.slice(-2)}` : '••••';
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

const NEXT_STEP: Record<string, string> = {
  AUCUNE: 'Pas encore de couverture : renseignez-vous au guichet ARCH de votre mairie ou auprès d’une mutuelle de santé.',
  NON_DECLAREE: 'Déclarez votre couverture pour connaître la part prise en charge.',
  A_VERIFIER: 'Touchez « Vérifier » pour confirmer vos droits.',
};

type CoverageStatus = 'ACTIF' | 'EN_ATTENTE' | 'INACTIF' | 'NON_DECLAREE';

@Injectable()
export class RightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly crypto: CryptoService,
    @Inject(COVERAGE_REGISTRY) private readonly registry: CoverageRegistry,
    @Inject(MOBILE_MONEY) private readonly gateway: MobileMoneyGateway,
  ) {}

  private patientId(user: AuthUser): string {
    if (!user.patientId) throw new ForbiddenException('Réservé au titulaire du carnet');
    return user.patientId;
  }

  // ─── Couverture ──────────────────────────────────────────────────

  async coverage(user: AuthUser) {
    const row = await this.prisma.coverage.findUnique({ where: { patientId: this.patientId(user) } });
    return this.presentCoverage(row);
  }

  async declare(user: AuthUser, dto: CoverageDto) {
    const patientId = this.patientId(user);
    if (dto.scheme !== 'AUCUNE' && !dto.number?.trim()) throw new BadRequestException('Numéro de bénéficiaire requis');
    const number = dto.scheme === 'AUCUNE' ? null : dto.scheme === 'ARCH' ? (normalizeArch(dto.number!) ?? dto.number!.trim().toUpperCase()) : dto.number!.trim().toUpperCase();
    const data = {
      scheme: dto.scheme,
      number,
      rate: 0,
      status: dto.scheme === 'AUCUNE' ? 'INACTIF' : 'EN_ATTENTE',
      source: 'DECLARE',
      verifiedAt: null,
    };
    const row = await this.prisma.coverage.upsert({ where: { patientId }, update: data, create: { patientId, ...data } });
    return this.presentCoverage(row);
  }

  /** Interroge le registre (bac à sable en démonstration) et enregistre la réponse. */
  async verify(user: AuthUser) {
    const patientId = this.patientId(user);
    const current = await this.prisma.coverage.findUnique({ where: { patientId } });
    if (!current || current.scheme === 'AUCUNE' || !current.number) {
      throw new BadRequestException('Déclarez d’abord votre couverture (ARCH ou mutuelle) avec son numéro');
    }
    const patient = await this.prisma.patient.findUniqueOrThrow({ where: { id: patientId }, select: { firstName: true, lastName: true, birthDate: true } });
    const result = await this.registry.check({ scheme: current.scheme as 'ARCH' | 'MUTUELLE', number: current.number, person: patient });
    const row = await this.prisma.coverage.update({
      where: { patientId },
      data: { number: result.number, status: result.status, rate: result.rate, source: 'VERIFIE', verifiedAt: new Date() },
    });
    if (result.status === 'ACTIF' && current.status !== 'ACTIF') {
      await this.notifications.notify(user.id, {
        kind: 'DROITS',
        title: 'Couverture vérifiée',
        body: `${row.scheme} : ${row.rate} % de vos soins pris en charge.`,
        href: '/app/droits',
        ref: `coverage:${row.id}`,
      });
    }
    return { ...this.presentCoverage(row, result.reason), checkedWith: this.registry.name };
  }

  private presentCoverage(row: Coverage | null, reason: RegistryReason = null) {
    if (!row) {
      return { declared: false, scheme: null, number: null, status: 'NON_DECLAREE' as CoverageStatus, rate: 0, source: null, verifiedAt: null, validUntil: null, reason: null, nextStep: NEXT_STEP.NON_DECLAREE, registry: this.registry.name };
    }
    const status = row.status as CoverageStatus;
    // Motif recalculé à la lecture : le registre bac à sable est déterministe.
    const why: RegistryReason =
      reason ?? (status === 'EN_ATTENTE' && row.source === 'VERIFIE' ? (row.scheme === 'MUTUELLE' ? 'NON_RACCORDE' : 'NUMERO_INVALIDE') : null);
    const nextStep =
      row.scheme === 'AUCUNE'
        ? NEXT_STEP.AUCUNE
        : status === 'ACTIF'
          ? null
          : why === 'NON_RACCORDE'
            ? 'Votre mutuelle n’est pas encore raccordée : montrez votre carte de mutuelle à l’accueil de l’hôpital.'
            : why === 'NUMERO_INVALIDE'
              ? 'Numéro introuvable : vérifiez-le sur votre carte ARCH, ou passez au guichet ARCH de votre mairie.'
              : NEXT_STEP.A_VERIFIER;
    const validUntil = status === 'ACTIF' && row.verifiedAt ? new Date(Date.UTC(row.verifiedAt.getUTCFullYear(), 11, 31, 22, 59)) : null;
    return {
      declared: true,
      scheme: row.scheme,
      number: row.number,
      status,
      rate: status === 'ACTIF' ? row.rate : 0,
      source: row.source,
      verifiedAt: row.verifiedAt,
      validUntil,
      reason: why,
      nextStep,
      registry: this.registry.name,
    };
  }

  // ─── Tarifs et estimation ────────────────────────────────────────

  async tariffs() {
    const rows = await this.prisma.careTariff.findMany({ orderBy: [{ category: 'asc' }, { priceFcfa: 'asc' }] });
    return rows;
  }

  /** Prix d'un médicament : médiane des prix relevés en pharmacie (en stock d'abord), sinon prix indicatif. */
  private async medicationPrices(ids: string[]) {
    const meds = await this.prisma.medication.findMany({
      where: { id: { in: ids } },
      include: { stocks: { where: { pharmacy: { type: 'PHARMACIE' } }, select: { priceFcfa: true, quantity: true } } },
    });
    return new Map(
      meds.map((m) => {
        const inStock = m.stocks.filter((s) => s.quantity > 0).map((s) => s.priceFcfa ?? m.priceFcfa).filter((p): p is number => p !== null);
        const any = m.stocks.map((s) => s.priceFcfa ?? m.priceFcfa).filter((p): p is number => p !== null);
        const fromPharmacies = median(inStock.length ? inStock : any);
        const unit = fromPharmacies ?? m.priceFcfa;
        const source = fromPharmacies !== null ? 'PHARMACIES' : m.priceFcfa !== null ? 'INDICATIF' : null;
        return [m.id, { med: m, unit, source, pharmacies: inStock.length }] as const;
      }),
    );
  }

  async estimate(user: AuthUser, dto: EstimateDto) {
    const patientId = this.patientId(user);
    if (!dto.acts.length && !dto.medications.length) throw new BadRequestException('Choisissez au moins un soin ou un médicament');
    const codes = [...new Set(dto.acts.map((a) => a.code))];
    const tariffs = new Map((await this.prisma.careTariff.findMany({ where: { code: { in: codes } } })).map((t) => [t.code, t]));
    const prices = await this.medicationPrices([...new Set(dto.medications.map((m) => m.medicationId))]);

    const lines: {
      kind: 'ACTE' | 'MEDICAMENT';
      code: string;
      label: string;
      category: string;
      unitPriceFcfa: number | null;
      quantity: number;
      totalFcfa: number;
      priceSource: 'GRILLE' | 'PHARMACIES' | 'INDICATIF' | null;
    }[] = [];
    for (const a of dto.acts) {
      const t = tariffs.get(a.code);
      if (!t) throw new BadRequestException(`Acte inconnu de la grille : ${a.code}`);
      lines.push({ kind: 'ACTE', code: t.code, label: t.label, category: t.category, unitPriceFcfa: t.priceFcfa, quantity: a.qty, totalFcfa: t.priceFcfa * a.qty, priceSource: 'GRILLE' });
    }
    for (const m of dto.medications) {
      const p = prices.get(m.medicationId);
      if (!p) throw new BadRequestException('Médicament inconnu du référentiel');
      lines.push({
        kind: 'MEDICAMENT',
        code: p.med.id,
        label: `${p.med.dci} ${p.med.strength}`,
        category: p.med.form,
        unitPriceFcfa: p.unit,
        quantity: m.quantity,
        totalFcfa: (p.unit ?? 0) * m.quantity,
        priceSource: p.source as 'PHARMACIES' | 'INDICATIF' | null,
      });
    }

    const coverage = await this.prisma.coverage.findUnique({ where: { patientId } });
    const active = coverage?.status === 'ACTIF' && coverage.rate > 0;
    const rate = active ? coverage!.rate : 0;
    const totalFcfa = lines.reduce((n, l) => n + l.totalFcfa, 0);
    const coveredFcfa = Math.round((totalFcfa * rate) / 100);
    const remainderFcfa = totalFcfa - coveredFcfa;
    // Rien n'est enregistré tant qu'on ne paie pas : l'estimation voyage dans un jeton signé (30 min),
    // seul moyen de payer. Référence unique par estimation (un seul paiement par référence).
    const ref = `EST-${randomBytes(4).toString('hex').toUpperCase()}`;
    const expiresAt = new Date(Date.now() + ESTIMATE_TTL_MS);
    const label = receiptLabel(lines.map((l) => l.label));
    const token = signEstimate(
      { v: 1, ref, p: patientId, u: user.id, amount: remainderFcfa, total: totalFcfa, covered: coveredFcfa, label, exp: expiresAt.getTime() },
      (v) => this.crypto.hmac(v),
    );
    return {
      ref,
      lines,
      totalFcfa,
      coveredFcfa,
      remainderFcfa,
      unknownPrices: lines.filter((l) => l.unitPriceFcfa === null).length,
      coverage: { scheme: coverage?.scheme ?? null, status: coverage?.status ?? 'NON_DECLAREE', rate, applied: active },
      label,
      token: remainderFcfa > 0 ? token : null,
      expiresAt,
    };
  }

  // ─── Paiement ────────────────────────────────────────────────────

  /** Prochain numéro de reçu de l'année : GJ-2026-000124. */
  private async nextReceipt(): Promise<string> {
    const year = new Date().getUTCFullYear();
    const prefix = `GJ-${year}-`;
    const last = await this.prisma.payment.findFirst({ where: { receipt: { startsWith: prefix } }, orderBy: { receipt: 'desc' }, select: { receipt: true } });
    const n = last ? Number(last.receipt.slice(prefix.length)) + 1 : 1;
    return `${prefix}${String(Number.isFinite(n) ? n : 1).padStart(6, '0')}`;
  }

  /** Paiement d'un reste à charge : uniquement contre une estimation signée par le serveur (montant, libellé, référence). */
  async pay(user: AuthUser, dto: PaymentDto) {
    const patientId = this.patientId(user);
    const check = readEstimate(dto.estimateToken, (v) => this.crypto.hmac(v), (a, b) => this.crypto.safeEqual(a, b));
    if (!check.ok) {
      throw new BadRequestException(
        check.reason === 'EXPIRED'
          ? { code: 'ESTIMATE_EXPIRED', message: 'Estimation expirée : le montant a été recalculé, vérifiez-le puis payez.' }
          : { code: 'ESTIMATE_INVALID', message: 'Estimation invalide : recalculez le montant avant de payer.' },
      );
    }
    const est = check.claims;
    if (est.p !== patientId || est.u !== user.id) throw new ForbiddenException('Cette estimation a été faite pour un autre compte.');
    if (est.amount <= 0) throw new BadRequestException('Rien à payer pour cette estimation.');
    const phone = normalizePhone(dto.phone);
    if (!/^01\d{8}$/.test(phone)) throw new BadRequestException('Numéro de téléphone invalide (10 chiffres, commence par 01)');
    const already = await this.prisma.payment.findFirst({ where: { patientId, ref: est.ref, status: { in: ['REUSSI', 'EN_COURS'] } }, select: { receipt: true } });
    if (already) throw new ConflictException({ code: 'ALREADY_PAID', message: `Cette estimation est déjà payée (reçu ${already.receipt}).`, receipt: already.receipt });

    let payment: Payment | null = null;
    for (let attempt = 0; attempt < 5 && !payment; attempt++) {
      try {
        payment = await this.prisma.payment.create({
          data: {
            patientId,
            userId: user.id,
            kind: 'RESTE_A_CHARGE',
            ref: est.ref,
            label: est.label,
            amountFcfa: est.amount,
            provider: dto.provider,
            phone,
            status: 'EN_COURS',
            receipt: await this.nextReceipt(),
          },
        });
      } catch (e) {
        // Deux paiements au même instant : le numéro de reçu est unique, on reprend le suivant.
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      }
    }
    if (!payment) throw new BadRequestException('Paiement impossible pour le moment. Réessayez.');

    const result = await this.gateway.collect({ provider: dto.provider, phone, amountFcfa: payment.amountFcfa, reference: payment.receipt, label: payment.label });
    payment = await this.prisma.payment.update({ where: { id: payment.id }, data: { status: result.status } });
    if (result.status !== 'REUSSI') {
      throw new BadRequestException(result.message ?? 'Paiement refusé par l’opérateur. Aucun montant n’a été débité.');
    }

    await this.notifications.notify(user.id, {
      kind: 'DROITS',
      title: 'Paiement reçu',
      body: `${amountText(payment.amountFcfa)} FCFA · ${payment.label} · reçu ${payment.receipt}`,
      href: `/app/droits/recu/${payment.receipt}`,
      sms: (lang) => sms('rights.payment', lang, { amount: amountText(payment!.amountFcfa), receipt: payment!.receipt }),
      ref: `payment:${payment.id}`,
    });
    return this.presentPayment(payment, user);
  }

  async payments(user: AuthUser) {
    const rows = await this.prisma.payment.findMany({ where: { patientId: this.patientId(user) }, orderBy: { createdAt: 'desc' }, take: 50 });
    return rows.map((p) => this.presentPayment(p, user));
  }

  async receipt(user: AuthUser, receipt: string) {
    if (!/^[A-Z0-9-]{4,30}$/i.test(receipt)) throw new NotFoundException('Reçu introuvable');
    const row = await this.prisma.payment.findUnique({ where: { receipt: receipt.toUpperCase() }, include: { patient: { select: { firstName: true, lastName: true } } } });
    if (!row || row.patientId !== this.patientId(user)) throw new NotFoundException('Reçu introuvable');
    return { ...this.presentPayment(row, user), patient: `${row.patient.firstName} ${row.patient.lastName}` };
  }

  private presentPayment(p: Payment, user: AuthUser) {
    return {
      id: p.id,
      receipt: p.receipt,
      kind: p.kind,
      label: p.label,
      ref: p.ref,
      amountFcfa: p.amountFcfa,
      provider: p.provider,
      providerLabel: PROVIDER_LABEL[p.provider as keyof typeof PROVIDER_LABEL] ?? p.provider,
      phone: maskPhone(p.phone),
      status: p.status,
      payer: p.userId === user.id ? user.name : null,
      createdAt: p.createdAt,
      sandbox: this.gateway.mode === 'sandbox' && p.provider !== 'ESPECES',
    };
  }
}
