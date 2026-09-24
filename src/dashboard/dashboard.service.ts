import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Seuil minimal de cas par cellule : en dessous, la valeur est masquée (anonymisation). */
export const MIN_CELL = 10;
export function mask(n: number): number | '<10' {
  return n > 0 && n < MIN_CELL ? '<10' : n;
}

function median(values: number[]) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Tableau de bord national : uniquement des agrégats, jamais de donnée nominative. */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async national() {
    const since30 = new Date(Date.now() - 30 * 86_400_000);
    const since7 = new Date(Date.now() - 7 * 86_400_000);
    const [departments, bloodStocks, requests, patients, ruptures, reports, tele, alerts, essentialCount] = await Promise.all([
      this.prisma.department.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.bloodStock.findMany({ include: { site: { include: { commune: true } } } }),
      this.prisma.bloodRequest.findMany({ where: { createdAt: { gte: since30 } }, include: { facility: { include: { commune: true } }, alerts: true } }),
      this.prisma.patient.findMany({ where: { communeId: { not: null } }, select: { commune: { select: { departmentCode: true } } } }),
      this.prisma.pharmacyStock.findMany({ where: { quantity: 0 }, include: { pharmacy: { include: { commune: true } }, medication: true } }),
      this.prisma.communityReport.findMany({ where: { createdAt: { gte: since7 } }, include: { commune: true } }),
      this.prisma.teleExpertise.findMany({ where: { createdAt: { gte: since30 } } }),
      this.prisma.healthAlert.count({ where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } }),
      this.prisma.medication.count(),
    ]);

    const byDept = departments.map((d) => {
      const stock = bloodStocks.filter((s) => s.site.commune.departmentCode === d.code);
      const reqs = requests.filter((r) => r.facility.commune.departmentCode === d.code);
      const rup = ruptures.filter((r) => r.pharmacy.commune.departmentCode === d.code);
      const pats = patients.filter((p) => p.commune?.departmentCode === d.code).length;
      const rep = reports.filter((r) => r.commune.departmentCode === d.code);
      return {
        code: d.code,
        name: d.name,
        lat: d.lat,
        lng: d.lng,
        bloodUnits: stock.reduce((n, s) => n + s.units, 0),
        bloodSites: new Set(stock.map((s) => s.siteId)).size,
        openBloodRequests: reqs.filter((r) => ['OUVERTE', 'DONNEURS_ALERTES'].includes(r.status)).length,
        medicationRuptures: rup.length,
        patientsFollowed: mask(pats),
        communityCases7d: rep.reduce((n, r) => n + r.cases, 0),
      };
    });

    const delays = requests
      .map((r) => {
        const first = r.alerts.filter((a) => a.status === 'ACCEPTEE' && a.respondedAt).sort((a, b) => +a.respondedAt! - +b.respondedAt!)[0];
        return first ? (+first.respondedAt! - +r.createdAt) / 60_000 : null;
      })
      .filter((x): x is number => x !== null);
    const answered = tele.filter((t) => t.answeredAt);
    const within48 = answered.filter((t) => +t.answeredAt! - +t.createdAt <= 48 * 3600_000).length;

    const topRuptures = Object.entries(
      ruptures.reduce<Record<string, number>>((acc, r) => {
        const k = `${r.medication.dci} ${r.medication.strength}`;
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
      }, {}),
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([medication, pharmacies]) => ({ medication, pharmacies }));

    return {
      generatedAt: new Date(),
      anonymization: { minCell: MIN_CELL, note: 'Agrégats uniquement ; toute cellule inférieure à 10 est masquée.' },
      kpis: {
        bloodRequests30d: requests.length,
        medianMinutesToDonor: delays.length ? Math.round(median(delays)!) : null,
        teleExpertiseWithin48h: answered.length ? Math.round((100 * within48) / answered.length) : null,
        teleExpertisePending: tele.length - answered.length,
        patientsFollowed: mask(patients.length),
        activeAlerts: alerts,
        pharmacyRuptures: ruptures.length,
        essentialMedicines: essentialCount,
      },
      departments: byDept,
      topRuptures,
    };
  }
}
