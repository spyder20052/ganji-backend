import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import { AuthUser } from '../common/auth-user';
import { OutboxService } from '../common/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAlertDto, ReportDto } from './alerts.dto';

export const SYNDROMES: Record<string, string> = {
  DIARRHEE: 'Diarrhées aiguës',
  FIEVRE_ERUPTION: 'Fièvre avec éruption',
  TOUX: 'Toux et fièvre',
  PARALYSIE: 'Paralysie soudaine',
  FIEVRE_HEMORRAGIQUE: 'Fièvre avec saignements',
  DECES_INEXPLIQUE: 'Décès inexpliqué',
};

/** Seuils de regroupement sur 7 jours glissants (démonstration ; à fixer avec la DNSP). */
const CLUSTER_WINDOW_DAYS = 7;
const CLUSTER_MIN_REPORTS = 3;
const IMMEDIATE = new Set(['PARALYSIE', 'FIEVRE_HEMORRAGIQUE']);

@Injectable()
export class AlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Alertes en cours. `withSignals` : ajoute les regroupements détectés automatiquement, réservés
   * au médecin chef de zone et aux équipes tant qu'ils n'ont pas été vérifiés.
   */
  async list(communeName?: string, withSignals = false) {
    const now = new Date();
    const commune = communeName ? await this.prisma.commune.findUnique({ where: { name: communeName } }) : null;
    const rows = await this.prisma.healthAlert.findMany({
      where: {
        AND: [
          { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          ...(withSignals ? [] : [{ auto: false }]),
          ...(commune ? [{ OR: [{ communes: { some: { communeId: commune.id } } }, { communes: { none: {} } }] }] : []),
        ],
      },
      include: { communes: { include: { commune: { select: { name: true, departmentCode: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    return rows.map((a) => ({
      id: a.id,
      kind: a.kind,
      severity: a.severity,
      title: a.title,
      message: a.message,
      audioKey: a.audioKey,
      source: a.source,
      auto: a.auto,
      createdAt: a.createdAt,
      communes: a.communes.map((c) => c.commune.name),
      national: a.communes.length === 0,
    }));
  }

  async create(user: AuthUser, dto: CreateAlertDto) {
    const communes = dto.communes?.length ? await this.prisma.commune.findMany({ where: { name: { in: dto.communes } } }) : [];
    if (dto.communes?.length && communes.length !== dto.communes.length) throw new BadRequestException('Commune inconnue');
    const alert = await this.prisma.healthAlert.create({
      data: {
        kind: dto.kind,
        severity: dto.severity,
        title: dto.title,
        message: dto.message,
        source: 'Ministère de la Santé',
        expiresAt: dto.days ? new Date(Date.now() + dto.days * 86_400_000) : null,
        communes: { create: communes.map((c) => ({ communeId: c.id })) },
      },
    });
    // Diffusion SMS aux habitants inscrits des communes ciblées (plafonnée en démo).
    const recipients = await this.prisma.user.findMany({
      where: { phone: { not: null }, patient: communes.length ? { communeId: { in: communes.map((c) => c.id) } } : { isNot: null } },
      select: { phone: true, lang: true },
      take: 50,
    });
    for (const r of recipients) {
      await this.outbox.send({ channel: 'SMS', to: r.phone!, lang: r.lang, body: `Ganji · ${dto.title} : ${dto.message}`.slice(0, 300), ref: `alert:${alert.id}` });
    }
    await this.audit.log({ actor: user, action: 'ALERT', resource: `Alerte « ${dto.title} » (${communes.length || 'national'})` });
    return { id: alert.id, broadcast: recipients.length };
  }

  /** Signalement communautaire en 3 gestes : quoi, combien, où. Fonctionne hors ligne (file de synchronisation). */
  async report(user: AuthUser | null, dto: ReportDto) {
    const commune = await this.prisma.commune.findUnique({ where: { name: dto.commune } });
    if (!commune) throw new BadRequestException('Commune inconnue');
    const r = await this.prisma.communityReport.create({
      data: {
        relayId: user?.id,
        relayName: user?.name,
        communeId: commune.id,
        village: dto.village,
        syndrome: dto.syndrome,
        cases: dto.cases,
        offline: dto.offline ?? false,
        createdAt: dto.observedAt ? new Date(dto.observedAt) : undefined,
      },
    });
    const clusters = await this.detectClusters(commune.id);
    return { id: r.id, clusterAlert: clusters.created > 0, alerts: clusters.alerts };
  }

  async reports(days = 14) {
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await this.prisma.communityReport.findMany({
      where: { createdAt: { gte: since } },
      include: { commune: { select: { name: true, departmentCode: true, lat: true, lng: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => ({
      id: r.id,
      syndrome: r.syndrome,
      label: SYNDROMES[r.syndrome],
      cases: r.cases,
      commune: r.commune.name,
      department: r.commune.departmentCode,
      lat: r.commune.lat,
      lng: r.commune.lng,
      village: r.village,
      relay: r.relayName,
      at: r.createdAt,
    }));
  }

  /**
   * Détection de regroupements : ≥ 3 signalements du même syndrome dans une commune
   * sur 7 jours, ou un seul pour les syndromes à notification immédiate.
   */
  async detectClusters(communeId?: string) {
    const since = new Date(Date.now() - CLUSTER_WINDOW_DAYS * 86_400_000);
    const groups = await this.prisma.communityReport.groupBy({
      by: ['communeId', 'syndrome'],
      where: { createdAt: { gte: since }, ...(communeId ? { communeId } : {}) },
      _count: { _all: true },
      _sum: { cases: true },
    });
    const created: string[] = [];
    for (const g of groups) {
      if (g._count._all < CLUSTER_MIN_REPORTS && !IMMEDIATE.has(g.syndrome)) continue;
      const commune = await this.prisma.commune.findUniqueOrThrow({ where: { id: g.communeId } });
      const title = `Regroupement de cas : ${SYNDROMES[g.syndrome].toLowerCase()} à ${commune.name}`;
      const exists = await this.prisma.healthAlert.findFirst({ where: { auto: true, title, createdAt: { gte: since } } });
      if (exists) continue;
      await this.prisma.healthAlert.create({
        data: {
          kind: 'EPIDEMIE',
          severity: IMMEDIATE.has(g.syndrome) ? 'URGENCE' : 'ATTENTION',
          title,
          message: `${g._count._all} signalement(s) communautaire(s), ${g._sum.cases ?? 0} cas en ${CLUSTER_WINDOW_DAYS} jours. Investigation recommandée par l'équipe de la zone sanitaire.`,
          source: 'Détection automatique Ganji',
          auto: true,
          expiresAt: new Date(Date.now() + 14 * 86_400_000),
          communes: { create: [{ communeId: commune.id }] },
        },
      });
      const officers = await this.prisma.user.findMany({ where: { role: 'MINISTRY', phone: { not: null } }, select: { phone: true } });
      for (const o of officers) {
        await this.outbox.send({ channel: 'SMS', to: o.phone!, body: `Ganji surveillance : ${title}. Voir le tableau de bord.`, ref: `cluster:${commune.id}:${g.syndrome}` });
      }
      created.push(title);
    }
    return { created: created.length, alerts: created };
  }
}
