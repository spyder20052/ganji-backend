import { Injectable } from '@nestjs/common';
import type { Lang } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { Localized } from './i18n';
import { OutboxService } from './outbox.service';

export type NotificationKind = 'RDV' | 'SANG' | 'COMMANDE' | 'ECOUTE' | 'CERCLE' | 'DROITS' | 'TRAITEMENT' | 'PARTAGE' | 'PROFIL' | 'SYSTEME';

export interface NotificationInput {
  kind: NotificationKind;
  /**
   * Titre et texte dans la langue de chaque destinataire (réglage de l'application) : `note(titre, texte, vars)`
   * ou `(lang) => ({ title: text(…), body: text(…) })` (common/i18n). Stockés déjà traduits.
   */
  text: Localized;
  href?: string;
  /** SMS envoyé en plus, dans la langue de la personne (sms() de common/i18n), sans donnée médicale. */
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
    const users = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, phone: true, lang: true } });
    // Chaque langue n'est rendue qu'une fois, quel que soit le nombre de destinataires.
    const byLang = new Map<Lang, { title: string; body: string }>();
    const inLang = (lang: Lang) => byLang.get(lang) ?? byLang.set(lang, n.text(lang)).get(lang)!;
    await this.prisma.notification.createMany({ data: users.map((u) => ({ userId: u.id, kind: n.kind, ...inLang(u.lang), href: n.href })) });
    if (n.sms) {
      for (const u of users) if (u.phone) await this.outbox.send({ channel: 'SMS', to: u.phone, lang: u.lang, body: n.sms(u.lang), ref: n.ref });
    }
    return users.length;
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
