import { Injectable, Logger } from '@nestjs/common';
import type { Lang } from '@prisma/client';
import { distanceKm } from '../common/geo';
import { Channel, OutboxService } from '../common/outbox.service';
import { PrismaService } from '../prisma/prisma.service';

export interface Recipient {
  to: string;
  lang: Lang;
  channel?: Channel;
}

export interface Origin {
  lat: number;
  lng: number;
}

/** Nombre maximal de relais communautaires prévenus pour une même alerte. */
const MAX_RELAYS = 3;

/**
 * Qui prévenir et où aller : aidants, relais communautaires, lieux de soin
 * ouverts 24 h/24. Partagé par les modules Urgence et Mère-enfant.
 */
@Injectable()
export class RespondersService {
  private readonly logger = new Logger(RespondersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  /** Aidants actifs (délégation non révoquée) ayant un numéro de téléphone. */
  async caregivers(patientId: string): Promise<Recipient[]> {
    const rows = await this.prisma.delegation.findMany({
      where: { patientId, revokedAt: null, caregiver: { phone: { not: null } } },
      select: { caregiver: { select: { phone: true, lang: true } } },
    });
    return rows.map((d) => ({ to: d.caregiver.phone as string, lang: d.caregiver.lang }));
  }

  /**
   * Relais communautaires à prévenir.
   *
   * Simplification assumée : le modèle User ne porte pas de commune. Un relais
   * est rattaché à une commune s'il possède lui-même un carnet (Patient.communeId) ;
   * à défaut, on prévient les premiers relais inscrits (MAX_RELAYS). En production,
   * une table d'affectation relais ↔ commune/village remplacera ce repli.
   */
  async relays(communeId: string | null | undefined): Promise<Recipient[]> {
    const select = { phone: true, lang: true } as const;
    let rows = communeId
      ? await this.prisma.user.findMany({
          where: { role: 'RELAY', phone: { not: null }, patient: { is: { communeId } } },
          select,
          take: MAX_RELAYS,
        })
      : [];
    if (rows.length === 0) {
      rows = await this.prisma.user.findMany({
        where: { role: 'RELAY', phone: { not: null } },
        select,
        orderBy: { createdAt: 'asc' },
        take: MAX_RELAYS,
      });
    }
    return rows.map((u) => ({ to: u.phone as string, lang: u.lang }));
  }

  /** Lieux ouverts 24 h/24 offrant le service demandé, du plus proche au plus lointain. */
  async nearestOpen(service: 'urgences' | 'maternite', origin: Origin | null, limit = 3) {
    const rows = await this.prisma.facility.findMany({
      where: { services: { has: service }, open24h: true },
      select: { id: true, name: true, shortName: true, type: true, lat: true, lng: true, phone: true, commune: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
    const places = rows.map((f) => ({
      ...f,
      commune: f.commune.name,
      distanceKm: origin ? distanceKm(origin.lat, origin.lng, f.lat, f.lng) : null,
    }));
    if (origin) places.sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
    return places.slice(0, limit);
  }

  /**
   * Envoie le même message à chaque destinataire (dédoublonnés), dans sa langue : `body` reçoit la langue
   * et rend le texte (sms() de common/i18n). Un échec d'envoi n'empêche pas les suivants : en situation
   * d'urgence, chaque contact prévenu compte. Renvoie le nombre de messages mis en file.
   */
  async notify(recipients: Recipient[], body: (lang: Lang) => string, ref: string, audioKey?: string): Promise<number> {
    const seen = new Set<string>();
    let sent = 0;
    for (const r of recipients) {
      const key = `${r.channel ?? 'SMS'}:${r.to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        await this.outbox.send({ channel: r.channel ?? 'SMS', to: r.to, lang: r.lang, body: body(r.lang), ref, audioKey });
        sent++;
      } catch (err) {
        this.logger.warn(`Envoi impossible (ref=${ref}) : ${(err as Error).message}`);
      }
    }
    return sent;
  }
}
