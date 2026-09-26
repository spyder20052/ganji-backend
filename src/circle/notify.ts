import type { Lang } from '@prisma/client';
import type { NotificationKind, NotificationsService } from '../common/notifications.service';
import { sms } from '../common/sms';
import type { PrismaService } from '../prisma/prisma.service';

export interface LocalizedNotice {
  kind: NotificationKind;
  /** Clés du catalogue de textes (common/sms.ts) : titre et texte de la notification dans l'application. */
  title: string;
  body: string;
  vars?: Record<string, string | number>;
  href?: string;
  /** SMS en plus (clé du catalogue), toujours neutre : aucune donnée médicale. */
  smsKey?: string;
  smsVars?: Record<string, string | number>;
  ref?: string;
}

/**
 * Notifie chacun dans sa langue (réglage de l'application) : les notifications sont stockées
 * déjà traduites, la cloche les affiche telles quelles. Sans traduction : français.
 */
export async function notifyInLang(prisma: PrismaService, notifications: NotificationsService, userIds: string[], n: LocalizedNotice) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return 0;
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, lang: true } });
  const byLang = new Map<Lang, string[]>();
  for (const u of users) byLang.set(u.lang, [...(byLang.get(u.lang) ?? []), u.id]);
  let count = 0;
  for (const [lang, group] of byLang) {
    count += await notifications.notify(group, {
      kind: n.kind,
      title: sms(n.title, lang, n.vars),
      body: sms(n.body, lang, n.vars),
      href: n.href,
      ref: n.ref,
      sms: n.smsKey ? (l) => sms(n.smsKey!, l, n.smsVars ?? n.vars) : undefined,
    });
  }
  return count;
}
