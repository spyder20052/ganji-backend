import { CryptoService } from '../../src/common/crypto.service';
import { sms } from '../../src/common/i18n';
import { LISTEN_SYSTEM } from '../../src/listen/listen.service';
import type { SeedCtx } from './context';

/** Identifiants fixes : le seed se rejoue sans doublon. */
const ID = {
  koffi: 'a1570000-0000-4000-8000-000000000001',
  urgent: 'a1570000-0000-4000-8000-000000000002',
};
/** Personne (fictive) qui écrit de façon anonyme : aucun compte de démonstration ne la voit. */
const ANON_PHONE = '0190000081';
const MIN = 60_000;

/**
 * Écoute psychologique :
 * - l'écoutante de démonstration (persona « ecoutante ») : Mme Hounkpè, psychologue au CNHU-HKM ;
 * - une conversation anonyme urgente, en attente (mots de détresse, rappel demandé) ;
 * - la conversation en cours de Koffi (nom partagé), suivie par Mme Hounkpè ; sa dernière réponse est à lire.
 */
export async function seedListen(ctx: SeedCtx) {
  const { prisma, users } = ctx;
  const crypto = new CryptoService();
  const cnhu = await prisma.facility.findFirst({ where: { shortName: 'CNHU-HKM' } });

  const counselor = await prisma.user.upsert({
    where: { demoPersona: 'ecoutante' },
    update: { role: 'PRACTITIONER', displayName: 'Mme Hounkpè (écoute)', phone: '0190000080', lang: 'fr' },
    create: { demoPersona: 'ecoutante', role: 'PRACTITIONER', displayName: 'Mme Hounkpè (écoute)', phone: '0190000080', lang: 'fr' },
  });
  const verifiedAt = new Date(Date.now() - 400 * 24 * 60 * MIN);
  await prisma.practitioner.upsert({
    where: { userId: counselor.id },
    update: { title: 'Psy.', specialty: 'PSYCHOLOGIE', facilityId: cnhu?.id ?? null, verifiedAt },
    create: { userId: counselor.id, title: 'Psy.', specialty: 'PSYCHOLOGIE', facilityId: cnhu?.id ?? null, orderNumber: 'PSY-0412', verifiedAt },
  });
  const anon = await prisma.user.upsert({
    where: { phone: ANON_PHONE },
    update: {},
    create: { role: 'PATIENT', displayName: 'Personne anonyme (démonstration écoute)', phone: ANON_PHONE, lang: 'fr' },
  });

  // Rejouable : on efface les conversations et notifications d'écoute des comptes de démonstration, puis on recrée.
  const demo = await prisma.user.findMany({ where: { demoPersona: { not: null } }, select: { id: true } });
  const owners = [anon.id, ...demo.map((u) => u.id)];
  await prisma.listenThread.deleteMany({ where: { OR: [{ id: { in: Object.values(ID) } }, { userId: { in: owners } }] } });
  await prisma.notification.deleteMany({ where: { kind: 'ECOUTE', userId: { in: [...owners, counselor.id] } } });

  const now = Date.now();
  const enc = (s: string) => crypto.encrypt(s)!;
  const msg = (author: string, body: string, minutesAgo: number) => ({ author, bodyEnc: enc(body), createdAt: new Date(now - minutesAgo * MIN) });

  // 1. Conversation anonyme urgente : « mieux sans moi » → consigne de sécurité, rappel demandé.
  await prisma.listenThread.create({
    data: {
      id: ID.urgent,
      userId: anon.id,
      anonymous: true,
      urgent: true,
      status: 'OUVERT',
      callbackPhone: crypto.encrypt(ANON_PHONE),
      callbackAt: new Date(now - 20 * MIN),
      createdAt: new Date(now - 26 * MIN),
      updatedAt: new Date(now - 20 * MIN),
      messages: {
        create: [
          msg('PERSONNE', 'Je n’en peux plus. Depuis la mort de mon mari, je ne dors plus. Parfois je me dis que ce serait mieux sans moi.', 26),
          msg('SYSTEME', LISTEN_SYSTEM.welcome, 26 - 0.01),
          msg('SYSTEME', LISTEN_SYSTEM.safety, 26 - 0.02),
          msg('PERSONNE', 'Je ne sais pas à qui parler. Mes enfants ne doivent pas savoir.', 22),
          msg('SYSTEME', LISTEN_SYSTEM.callback, 20),
        ],
      },
    },
  });

  // 2. Conversation de Koffi (nom partagé), suivie par Mme Hounkpè : sa réponse d'hier soir est à lire.
  if (users.koffi) {
    const H = 60;
    await prisma.listenThread.create({
      data: {
        id: ID.koffi,
        userId: users.koffi.id,
        anonymous: false,
        status: 'EN_COURS',
        counselorId: counselor.id,
        counselorName: 'Mme Hounkpè',
        createdAt: new Date(now - 50 * H * MIN),
        updatedAt: new Date(now - 4 * H * MIN),
        messages: {
          create: [
            msg('PERSONNE', 'Bonsoir. Depuis l’annonce de ma maladie, je dors très mal. J’ai peur pour mon travail et pour ma mère.', 50 * H),
            msg('SYSTEME', LISTEN_SYSTEM.welcome, 50 * H - 0.01),
            msg('SYSTEME', LISTEN_SYSTEM.joined, 38 * H),
            msg('ECOUTANT', 'Bonjour Koffi, merci de nous écrire. C’est normal d’avoir peur après une telle annonce. Qu’est-ce qui vous empêche le plus de dormir ?', 38 * H - 2),
            msg('PERSONNE', 'Je pense aux prochaines prises de sang, aux résultats. La nuit, tout tourne dans ma tête.', 27 * H),
            msg('ECOUTANT', 'Merci de le dire. Le soir, on peut essayer ensemble de petites choses pour calmer les pensées. Voulez-vous qu’on en parle au téléphone ?', 4 * H),
          ],
        },
      },
    });
    await prisma.notification.create({
      data: { userId: users.koffi.id, kind: 'ECOUTE', title: sms('listen.n.reply.title', 'fr'), body: sms('listen.n.reply.body', 'fr'), href: '/app/ecoute', createdAt: new Date(now - 4 * H * MIN) },
    });
  }

  await prisma.notification.create({
    data: {
      userId: counselor.id,
      kind: 'ECOUTE',
      title: sms('listen.n.urgent.title', 'fr'),
      body: sms('listen.n.urgent.body', 'fr'),
      href: `/pro/ecoute?c=${ID.urgent}`,
      createdAt: new Date(now - 26 * MIN),
    },
  });
}
