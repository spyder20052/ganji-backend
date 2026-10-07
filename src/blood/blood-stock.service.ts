import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../common/audit.service';
import { AuthUser } from '../common/auth-user';
import { compatibleDonorGroups, distanceKm } from '../common/geo';
import { PrismaService } from '../prisma/prisma.service';
import { type Place, placeOf, STOCK_RADIUS_KM } from './blood.logic';
import { planStockDraw } from './eligibility';

/**
 * Stocks des sites de transfusion : consultation publique, mise à jour par le site concerné, recherche de poches
 * compatibles autour d'un hôpital, et retrait des poches au moment de la transfusion.
 */
@Injectable()
export class BloodStockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async stocks() {
    const sites = await this.prisma.facility.findMany({
      where: { type: 'TRANSFUSION' },
      include: { bloodStock: true, commune: { select: { name: true, departmentCode: true } } },
      orderBy: { name: 'asc' },
    });
    return sites.map((s) => ({
      id: s.id,
      name: s.name,
      shortName: s.shortName,
      lat: s.lat,
      lng: s.lng,
      commune: s.commune.name,
      department: s.commune.departmentCode,
      total: s.bloodStock.reduce((n, x) => n + x.units, 0),
      stock: s.bloodStock.map((x) => ({ product: x.product, bloodGroup: x.bloodGroup, units: x.units })),
      updatedAt: s.bloodStock.reduce<Date | null>((m, x) => (!m || x.updatedAt > m ? x.updatedAt : m), null),
    }));
  }

  async updateStock(user: AuthUser, siteId: string, product: string, bloodGroup: string, units: number) {
    if (user.role !== 'BLOOD_BANK' || !user.facilityId || user.facilityId !== siteId) {
      throw new ForbiddenException('Seul le site de transfusion concerné peut modifier son stock');
    }
    const row = await this.prisma.bloodStock.upsert({
      where: { siteId_product_bloodGroup: { siteId, product, bloodGroup } },
      update: { units },
      create: { siteId, product, bloodGroup, units },
    });
    await this.audit.log({ actor: user, action: 'WRITE', resource: `Stock ${product} ${bloodGroup} = ${units}` });
    return row;
  }

  /** Stocks compatibles, du site le plus proche au plus lointain. */
  async stockCheck(product: string, recipientGroup: string, lat: number, lng: number) {
    const groups = compatibleDonorGroups(recipientGroup);
    const rows = await this.prisma.bloodStock.findMany({
      where: { product, bloodGroup: { in: groups }, units: { gt: 0 } },
      include: { site: { select: { id: true, name: true, shortName: true, lat: true, lng: true } } },
    });
    const bySite = new Map<string, { id: string; site: string; distanceKm: number; units: number; groups: string[] }>();
    for (const r of rows) {
      const cur = bySite.get(r.site.id) ?? { id: r.site.id, site: placeOf(r.site), distanceKm: distanceKm(lat, lng, r.site.lat, r.site.lng), units: 0, groups: [] };
      cur.units += r.units;
      cur.groups.push(`${r.bloodGroup}:${r.units}`);
      bySite.set(r.site.id, cur);
    }
    const sites = [...bySite.values()].sort((a, b) => a.distanceKm - b.distanceKm);
    const nearbyUnits = sites.filter((s) => s.distanceKm <= STOCK_RADIUS_KM).reduce((n, s) => n + s.units, 0);
    return { compatibleGroups: groups, nearbyUnits, sites };
  }

  /**
   * Retire n poches compatibles, groupe identique d'abord : du site qui a réservé, puis des sites de
   * transfusion à moins de 60 km de l'hôpital, du plus proche au plus lointain. Jamais d'un site éloigné.
   */
  async drawStockNear(
    tx: Prisma.TransactionClient,
    r: { product: string; bloodGroup: string; reservedSiteId: string | null; facility: { lat: number; lng: number } },
    units: number,
  ) {
    const groups = compatibleDonorGroups(r.bloodGroup);
    const rows = await tx.bloodStock.findMany({ where: { product: r.product, bloodGroup: { in: groups }, units: { gt: 0 } }, include: { site: true } });
    const bySite = new Map<string, { site: Place & { id: string }; km: number; rows: { bloodGroup: string; units: number }[] }>();
    for (const row of rows) {
      const km = distanceKm(r.facility.lat, r.facility.lng, row.site.lat, row.site.lng);
      if (row.siteId !== r.reservedSiteId && km > STOCK_RADIUS_KM) continue;
      const cur = bySite.get(row.siteId) ?? { site: row.site, km: row.siteId === r.reservedSiteId ? -1 : km, rows: [] };
      cur.rows.push({ bloodGroup: row.bloodGroup, units: row.units });
      bySite.set(row.siteId, cur);
    }
    const used: { site: string; bloodGroup: string; units: number }[] = [];
    let left = units;
    for (const s of [...bySite.values()].sort((a, b) => a.km - b.km)) {
      if (left <= 0) break;
      for (const d of planStockDraw(s.rows, r.bloodGroup, groups, left).draw) {
        const u = await tx.bloodStock.updateMany({ where: { siteId: s.site.id, product: r.product, bloodGroup: d.bloodGroup, units: { gte: d.units } }, data: { units: { decrement: d.units } } });
        if (u.count === 1) {
          used.push({ site: placeOf(s.site), bloodGroup: d.bloodGroup, units: d.units });
          left -= d.units;
        }
      }
    }
    return { used, missing: left };
  }
}
