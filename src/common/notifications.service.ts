import { Injectable } from '@nestjs/common';
import type { Lang } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OutboxService } from './outbox.service';

export type NotificationKind = 'RDV' | 'SANG' | 'COMMANDE' | 'ECOUTE' | 'CERCLE' | 'DROITS' | 'TRAITEMENT' | 'PARTAGE' | 'PROFIL' | 'SYSTEME';

export interface NotificationInput {
  kind: NotificationKind;
  title: string;
  body: string;
  href?: string;
  /** SMS envoyé en plus, texte déjà dans la langue de la personne (sms() de common/sms.ts), sans donnée médicale. */
  sms?: (lang: Lang) => string;
  ref?: string;
}

/**
 * Notifications dans l'application (cloche de l'en-tête) et, au besoin, par SMS : ce qui arrive à
 * chacun (rendez-vous confirmé, donneur trouvé, commande en route, réponse de l'écoutant…).
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  async notify(userIds: string | string[], n: NotificationInput) {
    const ids = [...new Set((Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean))];
    if (!ids.length) return 0;
    await this.prisma.notification.createMany({ data: ids.map((userId) => ({ userId, kind: n.kind, title: n.title, body: n.body, href: n.href })) });
    if (n.sms) {
      const users = await this.prisma.user.findMany({ where: { id: { in: ids }, phone: { not: null } }, select: { phone: true, lang: true } });
      for (const u of users) await this.outbox.send({ channel: 'SMS', to: u.phone!, lang: u.lang, body: n.sms(u.lang), ref: n.ref });
    }
    return ids.length;
  }

  /** Utilisateurs d'un rôle (et, au besoin, d'un établissement) : ANTS, pharmacie, soignants d'un site… */
  async usersWithRole(role: 'BLOOD_BANK' | 'PHARMACIST' | 'PRACTITIONER' | 'NURSE' | 'RELAY' | 'MINISTRY', facilityId?: string) {
    const users = await this.prisma.user.findMany({
      where: { role, ...(facilityId ? { practitioner: { facilityId } } : {}) },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  list(userId: string, limit = 50) {
    return this.prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: limit });
  }

  unread(userId: string) {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  async markRead(userId: string, id?: string) {
    const r = await this.prisma.notification.updateMany({ where: { userId, readAt: null, ...(id ? { id } : {}) }, data: { readAt: new Date() } });
    return { read: r.count };
  }
}
