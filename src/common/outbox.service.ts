import { Injectable, Logger } from '@nestjs/common';
import type { Lang } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type Channel = 'SMS' | 'VOICE' | 'PUSH';

export interface OutboundMessage {
  channel: Channel;
  to: string;
  body: string;
  lang?: Lang;
  audioKey?: string;
  ref?: string;
}

/** Mots interdits dans le corps d'un SMS ou d'un appel : aucune donnée médicale ne doit transiter. */
const FORBIDDEN = /(leuc|vih|hiv|cancer|diagnos|drépano|diab[eè]t|séropos|psychi|grossesse\s+à\s+risque)/i;

/**
 * File d'envoi SMS / voix / push. En démo, l'agrégateur est simulé : le message
 * passe à SENT immédiatement et s'affiche dans le simulateur de téléphone.
 * En production : adaptateur vers un agrégateur SMS et BullMQ.
 */
@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);
  constructor(private readonly prisma: PrismaService) {}

  async send(msg: OutboundMessage) {
    if (FORBIDDEN.test(msg.body)) {
      this.logger.error(`Message bloqué : contenu médical détecté (ref=${msg.ref ?? '-'})`);
      throw new Error('Un SMS ne doit contenir aucune donnée médicale');
    }
    return this.prisma.outbox.create({
      data: {
        channel: msg.channel,
        to: msg.to,
        body: msg.body,
        lang: msg.lang ?? 'fr',
        audioKey: msg.audioKey,
        ref: msg.ref,
        status: 'SENT',
        sentAt: new Date(),
      },
    });
  }

  async sendMany(msgs: OutboundMessage[]) {
    const results = [];
    for (const m of msgs) results.push(await this.send(m));
    return results;
  }
}
