import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { ListenMessage, ListenThread } from '@prisma/client';
import { normalizePhone } from '../auth/auth.dto';
import { notifyInLang } from '../circle/notify';
import { AuditService } from '../common/audit.service';
import type { AuthUser } from '../common/auth-user';
import { CryptoService } from '../common/crypto.service';
import { NotificationsService } from '../common/notifications.service';
import { defineSms } from '../common/sms';
import { detectDistress } from '../data/distress';
import { PrismaService } from '../prisma/prisma.service';
import { LISTEN_AUDIT_PREFIX } from './listen.constants';
import type { CallbackDto, OpenThreadDto } from './listen.dto';

/** Les écoutants sont des soignants vérifiés de spécialité psychologie. */
export const COUNSELOR_SPECIALTY = 'PSYCHOLOGIE';

/** Messages automatiques de la conversation : phrase française = clé, traduite à l'affichage. */
export const LISTEN_SYSTEM = {
  welcome: 'Merci de nous écrire. Une écoutante formée va vous répondre ici. Vous serez prévenu·e dès sa réponse.',
  safety:
    'Vous comptez. Si vous êtes en danger maintenant, appelez le 118 ou allez aux urgences les plus proches. Restez avec nous : une écoutante est prévenue et va vous répondre.',
  joined: 'Une écoutante a rejoint la conversation.',
  callback: 'Demande de rappel envoyée : l’écoutante vous appellera au numéro donné.',
  closedByPerson: 'Conversation close. Vous pouvez en ouvrir une autre à tout moment.',
  closedByCounselor: 'L’écoutante a clos la conversation. Vous pouvez en ouvrir une autre à tout moment.',
} as const;

type Author = 'PERSONNE' | 'ECOUTANT' | 'SYSTEME';
/** Messages chargés par conversation (les plus récents) : une longue conversation ne charge pas tout. */
export const MAX_MESSAGES = 100;
/** Une lecture par écoutante et par conversation au plus toutes les 15 min au journal (la page se rafraîchit toutes les 5 s). */
const READ_LOG_EVERY_MS = 15 * 60_000;
const SYSTEM_KEY = new Map<string, keyof typeof LISTEN_SYSTEM>(Object.entries(LISTEN_SYSTEM).map(([k, v]) => [v, k as keyof typeof LISTEN_SYSTEM]));
type ThreadWithMessages = ListenThread & { messages: ListenMessage[] };

defineSms({
  // SMS : neutre, rien sur l'écoute ni sur ce qui a été écrit.
  'listen.reply': { fr: "Ganji : vous avez un nouveau message dans l'application.", en: 'Ganji: you have a new message in the app.' },
  // Notifications dans l'application (personne qui écrit).
  'listen.n.reply.title': { fr: 'Nouveau message', en: 'New message' },
  'listen.n.reply.body': { fr: 'L’écoute vous a répondu. Ouvrez la conversation.', en: 'The listening line has replied. Open the conversation.' },
  'listen.n.closed.title': { fr: 'Conversation close', en: 'Conversation closed' },
  'listen.n.closed.body': { fr: 'L’écoutante a clos la conversation. Vous pouvez en ouvrir une autre à tout moment.', en: 'The listener closed the conversation. You can open a new one at any time.' },
  // Notifications de la cellule d'écoute.
  'listen.n.urgent.title': { fr: 'Écoute : détresse signalée', en: 'Listening line: distress detected' },
  'listen.n.urgent.body': { fr: 'Une personne a écrit des mots de détresse. Répondez en priorité.', en: 'Someone wrote words of distress. Reply first.' },
  'listen.n.new.title': { fr: 'Écoute : nouvelle conversation', en: 'Listening line: new conversation' },
  'listen.n.new.body': { fr: 'Une personne attend une réponse.', en: 'Someone is waiting for a reply.' },
  'listen.n.message.title': { fr: 'Écoute : nouveau message', en: 'Listening line: new message' },
  'listen.n.message.body': { fr: 'La personne que vous accompagnez a écrit.', en: 'The person you are supporting has written.' },
  'listen.n.callback.title': { fr: 'Écoute : rappel demandé', en: 'Listening line: call-back requested' },
  'listen.n.callback.body': { fr: 'Une personne demande à être rappelée.', en: 'Someone asked to be called back.' },
});

/** « Mme Hounkpè (écoute) » → « Mme Hounkpè ». */
function shortName(displayName: string) {
  return displayName.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

/**
 * Écoute psychologique : conversation confidentielle entre une personne (patient ou aidant) et la
 * cellule d'écoute. Messages chiffrés en base (AES-256-GCM). Anonyme par défaut : l'écoutante ne voit
 * ni le nom, ni le carnet, ni le numéro (sauf numéro donné pour être rappelé). Mots de détresse :
 * conversation urgente, consigne de sécurité immédiate et alerte de toute la cellule.
 */
@Injectable()
export class ListenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  // ─── Outils ──────────────────────────────────────────────────────

  /** Ajoute des messages dans l'ordre (horodatage croissant, même dans la même milliseconde). */
  private async addMessages(threadId: string, items: { author: Author; body: string }[]) {
    const base = Date.now();
    await this.prisma.listenMessage.createMany({
      data: items.map((m, i) => ({ threadId, author: m.author, bodyEnc: this.crypto.encrypt(m.body)!, createdAt: new Date(base + i) })),
    });
    await this.prisma.listenThread.update({ where: { id: threadId }, data: { updatedAt: new Date(base + items.length) } });
  }

  private decrypt(m: ListenMessage) {
    try {
      return this.crypto.decrypt(m.bodyEnc) ?? '';
    } catch {
      return '';
    }
  }

  /** Messages déchiffrés ; les messages automatiques portent leur nature (ex. « safety » : consigne de sécurité). */
  private messages(t: ThreadWithMessages) {
    return t.messages.map((m) => {
      const body = this.decrypt(m);
      const system = m.author === 'SYSTEME' ? SYSTEM_KEY.get(body) ?? 'info' : undefined;
      return { id: m.id, author: m.author as Author, body, at: m.createdAt, ...(system ? { system } : {}) };
    });
  }

  private callback(t: ListenThread) {
    if (!t.callbackAt) return null;
    let phone: string | null = null;
    try {
      phone = t.callbackPhone ? this.crypto.decrypt(t.callbackPhone) : null;
    } catch {
      phone = null;
    }
    return { at: t.callbackAt, phone };
  }

  private async counselorIds() {
    const rows = await this.prisma.user.findMany({
      where: { role: 'PRACTITIONER', practitioner: { is: { specialty: COUNSELOR_SPECIALTY, verifiedAt: { not: null } } } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  private notifyCounselors(ids: string[], what: 'urgent' | 'new' | 'message' | 'callback', threadId: string) {
    return notifyInLang(this.prisma, this.notifications, ids, {
      kind: 'ECOUTE',
      title: `listen.n.${what}.title`,
      body: `listen.n.${what}.body`,
      href: `/pro/ecoute?c=${threadId}`,
    });
  }

  /** Mots de détresse : conversation urgente, consigne de sécurité, toute la cellule prévenue. */
  private async onPersonMessage(thread: ListenThread, text: string) {
    const { distress } = detectDistress(text);
    if (!distress) return false;
    await this.prisma.listenThread.update({ where: { id: thread.id }, data: { urgent: true } });
    await this.addMessages(thread.id, [{ author: 'SYSTEME', body: LISTEN_SYSTEM.safety }]);
    await this.notifyCounselors(await this.counselorIds(), 'urgent', thread.id);
    return true;
  }

  // ─── Côté personne (patient ou aidant) ───────────────────────────

  private assertPerson(user: AuthUser) {
    if (user.role !== 'PATIENT' && user.role !== 'CAREGIVER') throw new ForbiddenException('Réservé aux patients et aux aidants');
  }

  private async ownThread(user: AuthUser, id: string): Promise<ThreadWithMessages> {
    this.assertPerson(user);
    const t = await this.prisma.listenThread.findUnique({ where: { id }, include: { messages: { orderBy: { createdAt: 'desc' }, take: MAX_MESSAGES } } });
    // Même réponse qu'un identifiant inconnu : on ne confirme pas l'existence d'une conversation d'autrui.
    if (!t || t.userId !== user.id) throw new NotFoundException('Conversation introuvable');
    t.messages.reverse();
    return t;
  }

  private personView(t: ThreadWithMessages) {
    return {
      id: t.id,
      status: t.status,
      anonymous: t.anonymous,
      urgent: t.urgent,
      counselorName: t.counselorName,
      callback: this.callback(t),
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      messages: this.messages(t),
    };
  }

  async open(user: AuthUser, dto: OpenThreadDto) {
    this.assertPerson(user);
    const text = dto.firstMessage.trim();
    if (!text) throw new BadRequestException('Écrivez un message');
    const thread = await this.prisma.listenThread.create({ data: { userId: user.id, anonymous: dto.anonymous ?? true } });
    await this.addMessages(thread.id, [
      { author: 'PERSONNE', body: text },
      { author: 'SYSTEME', body: LISTEN_SYSTEM.welcome },
    ]);
    const urgent = await this.onPersonMessage(thread, text);
    if (!urgent) await this.notifyCounselors(await this.counselorIds(), 'new', thread.id);
    return this.personView(await this.ownThread(user, thread.id));
  }

  async mine(user: AuthUser) {
    this.assertPerson(user);
    const threads = await this.prisma.listenThread.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' },
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
      take: 20,
    });
    return threads.map((t) => {
      const last = t.messages[0];
      return {
        id: t.id,
        status: t.status,
        anonymous: t.anonymous,
        counselorName: t.counselorName,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        last: last ? { author: last.author as Author, body: this.decrypt(last).slice(0, 140), at: last.createdAt } : null,
      };
    });
  }

  async thread(user: AuthUser, id: string) {
    return this.personView(await this.ownThread(user, id));
  }

  async personMessage(user: AuthUser, id: string, body: string) {
    const t = await this.ownThread(user, id);
    if (t.status === 'CLOS') throw new BadRequestException('Cette conversation est close. Ouvrez-en une nouvelle.');
    const text = body.trim();
    if (!text) throw new BadRequestException('Écrivez un message');
    await this.addMessages(t.id, [{ author: 'PERSONNE', body: text }]);
    const urgent = await this.onPersonMessage(t, text);
    // L'écoutante qui suit la conversation est prévenue ; sinon, la conversation reste dans la file.
    if (!urgent && t.counselorId) await this.notifyCounselors([t.counselorId], 'message', t.id);
    return this.personView(await this.ownThread(user, id));
  }

  async requestCallback(user: AuthUser, id: string, dto: CallbackDto) {
    const t = await this.ownThread(user, id);
    if (t.status === 'CLOS') throw new BadRequestException('Cette conversation est close. Ouvrez-en une nouvelle.');
    const phone = normalizePhone(dto.phone);
    if (!/^\d{8,12}$/.test(phone)) throw new BadRequestException('Numéro de téléphone invalide');
    const when = new Date(dto.when);
    const at = Number.isNaN(when.getTime()) || when.getTime() < Date.now() ? new Date() : when;
    await this.prisma.listenThread.update({ where: { id: t.id }, data: { callbackPhone: this.crypto.encrypt(phone), callbackAt: at } });
    await this.addMessages(t.id, [{ author: 'SYSTEME', body: LISTEN_SYSTEM.callback }]);
    await this.notifyCounselors(t.counselorId ? [t.counselorId] : await this.counselorIds(), 'callback', t.id);
    return this.personView(await this.ownThread(user, id));
  }

  async personClose(user: AuthUser, id: string) {
    const t = await this.ownThread(user, id);
    if (t.status !== 'CLOS') {
      await this.prisma.listenThread.update({ where: { id: t.id }, data: { status: 'CLOS' } });
      await this.addMessages(t.id, [{ author: 'SYSTEME', body: LISTEN_SYSTEM.closedByPerson }]);
    }
    return this.personView(await this.ownThread(user, id));
  }

  // ─── Côté cellule d'écoute ───────────────────────────────────────

  /** Écoutante : soignant vérifié de spécialité psychologie. Renvoie son nom court. */
  async counselor(user: AuthUser) {
    if (user.role !== 'PRACTITIONER' || !user.practitionerId) throw new ForbiddenException("Réservé à la cellule d'écoute");
    const p = await this.prisma.practitioner.findUnique({ where: { id: user.practitionerId }, include: { user: { select: { displayName: true } } } });
    if (!p || p.specialty !== COUNSELOR_SPECIALTY || !p.verifiedAt) throw new ForbiddenException("Réservé à la cellule d'écoute");
    return { id: user.id, name: shortName(p.user.displayName) };
  }

  private async counselorThread(user: AuthUser, id: string) {
    const me = await this.counselor(user);
    const t = await this.prisma.listenThread.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: 'desc' }, take: MAX_MESSAGES }, user: { select: { displayName: true, patient: { select: { id: true } } } } },
    });
    if (!t) throw new NotFoundException('Conversation introuvable');
    if (t.counselorId && t.counselorId !== me.id) throw new ForbiddenException('Conversation suivie par une autre écoutante');
    t.messages.reverse();
    return { me, t };
  }

  private readonly lastRead = new Map<string, number>();

  /**
   * Journal d'audit de l'écoutante. Conversation nommée : rattachée au carnet de la personne (elle voit qui a
   * lu). Conversation anonyme : jamais de lien avec un carnet ni avec la personne.
   */
  private logCounselor(user: AuthUser, t: { id: string; anonymous: boolean; user: { patient: { id: string } | null } }, action: 'READ' | 'LISTEN_TAKE', what: string) {
    return this.audit.log({
      actor: user,
      patientId: t.anonymous ? null : (t.user.patient?.id ?? null),
      action,
      resource: `${LISTEN_AUDIT_PREFIX} : ${what}${t.anonymous ? ' (anonyme)' : ''}`,
    });
  }

  /** Lecture journalisée, au plus une fois par quart d'heure et par conversation. */
  private async logRead(user: AuthUser, t: { id: string; anonymous: boolean; user: { patient: { id: string } | null } }) {
    const key = `${user.id}:${t.id}`;
    const last = this.lastRead.get(key) ?? 0;
    if (Date.now() - last < READ_LOG_EVERY_MS) return;
    this.lastRead.set(key, Date.now());
    if (this.lastRead.size > 5000) this.lastRead.clear();
    await this.logCounselor(user, t, 'READ', 'conversation lue');
  }

  /** Vue de l'écoutante : anonyme = « Personne anonyme » (ni nom, ni carnet, ni numéro sauf rappel demandé). */
  private counselorView(t: ThreadWithMessages & { user: { displayName: string } }, meId: string) {
    return {
      id: t.id,
      status: t.status,
      urgent: t.urgent,
      anonymous: t.anonymous,
      name: t.anonymous ? null : t.user.displayName,
      mine: t.counselorId === meId,
      counselorName: t.counselorName,
      callback: this.callback(t),
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      messages: this.messages(t),
    };
  }

  /** File : détresse d'abord, puis conversations en attente (la plus ancienne d'abord), puis les miennes. */
  async queue(user: AuthUser) {
    const me = await this.counselor(user);
    const threads = await this.prisma.listenThread.findMany({
      where: { status: { not: 'CLOS' }, OR: [{ counselorId: null }, { counselorId: me.id }] },
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 1, where: { author: { not: 'SYSTEME' } } }, user: { select: { displayName: true } } },
      take: 100,
    });
    const rank = (t: ListenThread) => (t.urgent ? 0 : t.counselorId ? 2 : 1);
    threads.sort((a, b) => rank(a) - rank(b) || (rank(a) === 2 ? b.updatedAt.getTime() - a.updatedAt.getTime() : a.createdAt.getTime() - b.createdAt.getTime()));
    const items = threads.map((t) => {
      const last = t.messages[0];
      return {
        id: t.id,
        status: t.status,
        urgent: t.urgent,
        anonymous: t.anonymous,
        name: t.anonymous ? null : t.user.displayName,
        mine: t.counselorId === me.id,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        waiting: last?.author === 'PERSONNE',
        last: last ? { author: last.author as Author, body: this.decrypt(last).slice(0, 140), at: last.createdAt } : null,
        callback: this.callback(t),
      };
    });
    return {
      counselor: me.name,
      counts: { urgent: items.filter((i) => i.urgent).length, open: items.filter((i) => !i.urgent && i.status === 'OUVERT').length, mine: items.filter((i) => i.mine).length },
      items,
    };
  }

  async counselorGet(user: AuthUser, id: string) {
    const { me, t } = await this.counselorThread(user, id);
    await this.logRead(user, t);
    return this.counselorView(t, me.id);
  }

  async take(user: AuthUser, id: string) {
    const { me, t } = await this.counselorThread(user, id);
    if (t.status === 'CLOS') throw new BadRequestException('Conversation close');
    if (!t.counselorId) {
      const r = await this.prisma.listenThread.updateMany({ where: { id, counselorId: null }, data: { counselorId: me.id, counselorName: me.name, status: 'EN_COURS' } });
      if (r.count === 0) throw new ConflictException('Une autre écoutante vient de prendre cette conversation');
      await this.addMessages(id, [{ author: 'SYSTEME', body: LISTEN_SYSTEM.joined }]);
      await this.logCounselor(user, t, 'LISTEN_TAKE', 'conversation prise en charge');
    }
    return this.counselorGet(user, id);
  }

  async counselorMessage(user: AuthUser, id: string, body: string) {
    const { t } = await this.counselorThread(user, id);
    if (t.status === 'CLOS') throw new BadRequestException('Conversation close');
    const text = body.trim();
    if (!text) throw new BadRequestException('Écrivez un message');
    if (!t.counselorId) await this.take(user, id);
    const previous = t.messages[t.messages.length - 1];
    await this.addMessages(id, [{ author: 'ECOUTANT', body: text }]);
    // Personne prévenue dans l'application ; par SMS (texte neutre) seulement pour la première réponse d'une série.
    await notifyInLang(this.prisma, this.notifications, [t.userId], {
      kind: 'ECOUTE',
      title: 'listen.n.reply.title',
      body: 'listen.n.reply.body',
      href: '/app/ecoute',
      smsKey: previous?.author === 'ECOUTANT' ? undefined : 'listen.reply',
      // Sans identifiant de conversation : la boîte d'envoi ne doit pas relier un numéro à une conversation anonyme.
      ref: 'listen',
    });
    return this.counselorGet(user, id);
  }

  async counselorClose(user: AuthUser, id: string) {
    const { t } = await this.counselorThread(user, id);
    if (t.status !== 'CLOS') {
      await this.prisma.listenThread.update({ where: { id }, data: { status: 'CLOS' } });
      await this.addMessages(id, [{ author: 'SYSTEME', body: LISTEN_SYSTEM.closedByCounselor }]);
      await notifyInLang(this.prisma, this.notifications, [t.userId], { kind: 'ECOUTE', title: 'listen.n.closed.title', body: 'listen.n.closed.body', href: '/app/ecoute' });
    }
    return this.counselorGet(user, id);
  }
}
