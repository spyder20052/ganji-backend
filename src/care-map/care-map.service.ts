import { Injectable, NotFoundException } from '@nestjs/common';
import { distanceKm } from '../common/geo';
import { TRIAGE_ADVICE, TRIAGE_START, TRIAGE_TREE, TriageAnswer, TriageOutcome, TriageQuestion } from '../data/triage';
import { PrismaService } from '../prisma/prisma.service';

export interface NearbyQuery {
  lat: number;
  lng: number;
  service?: string;
  types?: string[];
  openNow?: boolean;
  onDuty?: boolean;
  limit?: number;
}

const OUTCOME_FILTER: Record<TriageOutcome, Omit<NearbyQuery, 'lat' | 'lng'>> = {
  URGENCE: { service: 'urgences', openNow: true, limit: 3 },
  CENTRE_SANTE: { types: ['CS', 'HZ', 'CONFESSIONNEL', 'CHD'], service: 'consultation', limit: 3 },
  PHARMACIE: { types: ['PHARMACIE'], onDuty: true, limit: 3 },
  MAISON: { types: ['PHARMACIE'], onDuty: true, limit: 1 },
};

@Injectable()
export class CareMapService {
  constructor(private readonly prisma: PrismaService) {}

  departments() {
    return this.prisma.department.findMany({ orderBy: { name: 'asc' }, include: { communes: { select: { id: true, name: true, lat: true, lng: true }, orderBy: { name: 'asc' } } } });
  }

  async facilities(type?: string, department?: string) {
    return this.prisma.facility.findMany({
      where: { ...(type ? { type } : {}), ...(department ? { commune: { departmentCode: department } } : {}) },
      select: { id: true, name: true, shortName: true, type: true, lat: true, lng: true, services: true, open24h: true, onDuty: true, phone: true, commune: { select: { name: true, departmentCode: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async facility(id: string) {
    const f = await this.prisma.facility.findUnique({
      where: { id },
      include: { commune: { select: { name: true, departmentCode: true } } },
    });
    if (!f) throw new NotFoundException('Établissement introuvable');
    return f;
  }

  /** Lieux de soin les plus proches, filtrés par service et disponibilité. */
  async nearby(q: NearbyQuery) {
    const rows = await this.prisma.facility.findMany({
      where: {
        ...(q.types?.length ? { type: { in: q.types } } : { type: { not: 'TRANSFUSION' } }),
        ...(q.service ? { services: { has: q.service } } : {}),
        ...(q.openNow ? { OR: [{ open24h: true }, { onDuty: true }] } : {}),
        ...(q.onDuty ? { onDuty: true } : {}),
      },
      select: { id: true, name: true, shortName: true, type: true, lat: true, lng: true, services: true, open24h: true, onDuty: true, phone: true, commune: { select: { name: true } } },
    });
    return rows
      .map((f) => ({ ...f, commune: f.commune.name, distanceKm: distanceKm(q.lat, q.lng, f.lat, f.lng) }))
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, q.limit ?? 5);
  }

  triageTree() {
    return {
      start: TRIAGE_START,
      nodes: TRIAGE_TREE,
      advice: TRIAGE_ADVICE,
      disclaimer:
        "Orientation seulement : Ganji ne pose pas de diagnostic. En cas de doute, allez au centre de santé. Arbre de démonstration à valider par des médecins référents.",
      // Nom et date du médecin référent qui a validé l'arbre ; aucun pour la démonstration.
      validatedBy: null,
    };
  }

  /** Rejoue le parcours côté serveur (le client ne peut pas imposer un résultat). */
  async triage(answers: number[], lat?: number, lng?: number) {
    let nodeId: string | undefined = TRIAGE_START;
    const path: { question: string; answer: string }[] = [];
    const flags = new Set<string>();
    let outcome: TriageOutcome | undefined;
    for (const idx of answers) {
      const node: TriageQuestion | undefined = nodeId ? TRIAGE_TREE[nodeId] : undefined;
      if (!node) break;
      const a: TriageAnswer | undefined = node.answers[idx];
      if (!a) break;
      path.push({ question: node.text, answer: a.label });
      a.flags?.forEach((f) => flags.add(f));
      if (a.outcome) {
        outcome = a.outcome;
        break;
      }
      nodeId = a.next;
    }
    if (!outcome) return { complete: false, next: nodeId, path };
    const advice = TRIAGE_ADVICE[outcome];
    const places = lat !== undefined && lng !== undefined ? await this.nearby({ lat, lng, ...OUTCOME_FILTER[outcome] }) : [];
    return {
      complete: true,
      outcome,
      flags: [...flags],
      title: advice.title,
      advice: advice.advice,
      path,
      places,
      emergencyNumbers: outcome === 'URGENCE' ? [{ label: 'Sapeurs-pompiers', number: '118' }, { label: 'Police secours', number: '117' }] : [],
      crisis: flags.has('CRISE'),
      disclaimer: 'Ceci est une orientation, pas un diagnostic.',
    };
  }
}
