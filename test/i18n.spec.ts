import type { Lang } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { preferredText, when } from '../src/appointments/appointments.logic';
import { NotificationsService } from '../src/common/notifications.service';
import { OutboxService } from '../src/common/outbox.service';
import { FON } from '../src/common/i18n/fon';
import { YORUBA } from '../src/common/i18n/yoruba';
import { fill, localeOf, longDateTime, note, plural, pluralOf, SMS, sms, textLang, translate, type Entry, type TextKey } from '../src/common/i18n';
import { checkCatalog, checkNational, placeholders } from '../scripts/i18n/check';

const KEY = 'auth.otp' satisfies TextKey;

afterEach(() => {
  delete FON[KEY];
  delete YORUBA[KEY];
  delete YORUBA['rdv.confirmed'];
  delete YORUBA['date.at'];
  delete YORUBA['blood.n.reserved.title.one'];
  delete YORUBA['blood.n.reserved.title.other'];
});

describe('sms() : langue de la personne, puis langue nationale, puis français', () => {
  it('français et anglais viennent du catalogue', () => {
    expect(sms(KEY, 'fr', { code: '123456' })).toBe('Ganji : votre code de connexion est 123456. Il expire dans 5 minutes. Ne le communiquez à personne.');
    expect(sms(KEY, 'en', { code: '123456' })).toBe('Ganji: your login code is 123456. It expires in 5 minutes. Do not share it with anyone.');
  });

  it('sans langue, ou langue nationale sans traduction : français', () => {
    const fr = sms(KEY, 'fr', { code: '1' });
    expect(sms(KEY, null, { code: '1' })).toBe(fr);
    expect(sms(KEY, undefined, { code: '1' })).toBe(fr);
    for (const lang of ['fon', 'yoruba', 'bariba', 'dendi'] as const) expect(sms(KEY, lang, { code: '1' })).toBe(fr);
  });

  it('langue nationale traduite dans son fichier : ce texte, variables remplacées', () => {
    FON[KEY] = 'Ganji : kɔ́dù towe {code}.';
    expect(sms(KEY, 'fon', { code: '4242' })).toBe('Ganji : kɔ́dù towe 4242.');
    // Chaque langue a son fichier : le yoruba reste en français tant qu'il n'est pas traduit.
    expect(sms(KEY, 'yoruba', { code: '4242' })).toBe(sms(KEY, 'fr', { code: '4242' }));
    // Le français et l'anglais ne lisent jamais les fichiers nationaux.
    expect(sms(KEY, 'en', { code: '4242' })).toContain('your login code is 4242');
  });

  it('traduction vide : français plutôt qu’un SMS vide', () => {
    FON[KEY] = '';
    expect(sms(KEY, 'fon', { code: '1' })).toBe(sms(KEY, 'fr', { code: '1' }));
  });

  it('texte en ligne dans le catalogue, puis fichier national, puis français', () => {
    const entry: Entry = { fr: 'fr {x}', en: 'en {x}', fon: 'fon en ligne {x}' };
    YORUBA['clé.test'] = 'yoruba du fichier {x}';
    FON['clé.test'] = 'fon du fichier {x}';
    try {
      expect(translate(entry, 'clé.test', 'fon', { x: 1 })).toBe('fon en ligne 1');
      expect(translate(entry, 'clé.test', 'yoruba', { x: 1 })).toBe('yoruba du fichier 1');
      expect(translate(entry, 'clé.test', 'bariba', { x: 1 })).toBe('fr 1');
      expect(translate(entry, 'clé.test', 'en', { x: 1 })).toBe('en 1');
    } finally {
      delete YORUBA['clé.test'];
      delete FON['clé.test'];
    }
  });

  it('clé inconnue : erreur (jamais de SMS vide)', () => {
    expect(() => sms('nope' as TextKey, 'fr')).toThrow(/Texte inconnu/);
  });
});

describe('variables {x}', () => {
  it('remplace chaque occurrence, nombres compris ; une variable absente reste visible', () => {
    expect(fill('{a} et {a}, {n} km', { a: 'Koffi', n: 12 })).toBe('Koffi et Koffi, 12 km');
    expect(fill('Bonjour {prenom}', {})).toBe('Bonjour {prenom}');
    expect(sms('order.n.dispatched.body', 'fr', { courier: 'Paul', courierPhone: '0197', code: '0042' })).toBe('Livreur : Paul, 0197. Code à donner : 0042.');
  });

  it('les caractères spéciaux d’une valeur ne sont pas interprétés', () => {
    expect(fill('{a}', { a: '$& {b}' })).toBe('$& {b}');
  });

  it('une variable fonction reçoit la langue du texte réellement envoyé', () => {
    const seen: string[] = [];
    const vars = { code: (l: string) => (seen.push(l), l) };
    expect(sms(KEY, 'en', vars)).toContain('login code is en.');
    expect(sms(KEY, 'fon', vars)).toContain('code de connexion est fr.'); // pas de traduction fon : texte et variable en français
    FON[KEY] = 'kɔ́dù {code}';
    expect(sms(KEY, 'fon', vars)).toBe('kɔ́dù fon');
    expect(seen).toEqual(['en', 'fr', 'fon']);
    expect(textLang(KEY, 'fon')).toBe('fon');
    expect(textLang(KEY, 'dendi')).toBe('fr');
  });
});

describe('dates et pluriels selon la langue', () => {
  const d = new Date('2026-10-01T08:30:00Z');

  it('locale : fr-FR (français, fon, bariba, dendi), en-GB, yo-NG', () => {
    expect(['fr', 'fon', 'bariba', 'dendi', null].map((l) => localeOf(l as never))).toEqual(['fr-FR', 'fr-FR', 'fr-FR', 'fr-FR', 'fr-FR']);
    expect(localeOf('en')).toBe('en-GB');
    expect(localeOf('yoruba')).toBe(Intl.DateTimeFormat.supportedLocalesOf(['yo-NG']).length ? 'yo-NG' : 'fr-FR');
  });

  it('rendez-vous : français et anglais inchangés, langues nationales au format français (jusqu’à traduction)', () => {
    expect(when(d, 'fr')).toBe('jeudi 1 octobre à 9 h 30');
    expect(when(d, 'en')).toBe('Thursday 1 October at 09:30');
    expect(when(d, 'fon')).toBe('jeudi 1 octobre à 9 h 30');
    expect(preferredText(d, 'en')).toBe('Thursday 1 October, morning');
    // Yoruba sans traduction : phrase et date en français ; traduit : jour et heure au format yo-NG.
    expect(when(d, 'yoruba')).toBe('jeudi 1 octobre à 9 h 30');
    YORUBA['date.at'] = '{day} ní {time}';
    if (localeOf('yoruba') === 'yo-NG') expect(when(d, 'yoruba')).not.toContain('jeudi');
    expect(when(d, 'yoruba')).toContain(' ní ');
  });

  it('yoruba : date au format yo-NG seulement dans un texte traduit, jamais dans la phrase française de repli', () => {
    const vars = { when: (l: Lang) => longDateTime(d, l), place: 'CNHU-HKM' };
    expect(sms('rdv.confirmed', 'yoruba', vars)).toBe(sms('rdv.confirmed', 'fr', vars));
    YORUBA['rdv.confirmed'] = 'Ganji : {when}, {place}.';
    expect(sms('rdv.confirmed', 'yoruba', vars)).toBe(`Ganji : ${longDateTime(d, 'yoruba')}, CNHU-HKM.`);
  });

  it('pluriel : 0 et 1 au singulier en français, 1 seul en anglais', () => {
    expect([0, 1, 2, 1_000_000].map((n) => pluralOf(n, 'fr'))).toEqual(['one', 'one', 'other', 'other']);
    expect([0, 1, 2].map((n) => pluralOf(n, 'en'))).toEqual(['other', 'one', 'other']);
    expect(plural('blood.n.reserved.title', 2, 'fr', { prenom: 'Koffi' })).toBe('2 poches réservées pour Koffi');
    expect(plural('blood.n.reserved.title', 1, 'en', { prenom: 'Koffi' })).toBe('1 unit reserved for Koffi');
    // Sans traduction, la règle du français s'applique (le yoruba n'a pas de singulier : « 1 poches » sinon).
    expect(plural('blood.n.reserved.title', 1, 'yoruba', { prenom: 'Koffi' })).toBe('1 poche réservée pour Koffi');
    YORUBA['blood.n.reserved.title.one'] = '{n} (one) {prenom}';
    YORUBA['blood.n.reserved.title.other'] = '{n} (other) {prenom}';
    expect(plural('blood.n.reserved.title', 1, 'yoruba', { prenom: 'Koffi' })).toBe('1 (other) Koffi');
  });
});

describe('catalogue', () => {
  it('aucune clé en double, français et anglais non vides avec les mêmes variables', () => {
    expect(checkCatalog()).toEqual([]);
  });

  it('aucun texte du catalogue n’est refusé par le filtre médical de la file d’envoi', async () => {
    const outbox = new OutboxService({ outbox: { create: vi.fn(async ({ data }) => data) } } as never);
    for (const [key, e] of Object.entries(SMS as Record<string, Entry>)) {
      for (const text of [e.fr, e.en]) {
        const body = fill(text, Object.fromEntries(placeholders(text).map((v) => [v, 'X'])));
        await expect(outbox.send({ channel: 'SMS', to: '0190000001', body }), key).resolves.toBeTruthy();
      }
    }
  });

  it('vérification d’une langue nationale : manquante, vide, variables différentes, clé inconnue', () => {
    const { problems, translated, total } = checkNational('fon', {
      'auth.otp': 'Ganji : kɔ́dù {kod}.',
      'auth.newLogin': ' ',
      'rights.n.payment.title': 'Akwɛ́',
      'clé.inconnue': 'x',
    });
    expect(translated).toBe(2);
    expect(total).toBe(Object.keys(SMS).length);
    const kinds = (kind: string) => problems.filter((p) => p.kind === kind).map((p) => p.key);
    expect(kinds('PLACEHOLDERS')).toEqual(['auth.otp']);
    expect(kinds('EMPTY')).toEqual(['auth.newLogin']);
    expect(kinds('EXTRA')).toEqual(['clé.inconnue']);
    expect(kinds('MISSING')).toHaveLength(total - 3);
    expect(kinds('MISSING')).not.toContain('rights.n.payment.title');
  });
});

describe('notifications : chacun dans sa langue', () => {
  it('titre et texte rendus une fois par langue, SMS dans la langue de chacun', async () => {
    const created: { userId: string; title: string; body: string }[] = [];
    const sent: { to: string; lang: string; body: string }[] = [];
    const prisma = {
      user: {
        findMany: vi.fn(async () => [
          { id: 'a', phone: '0190000001', lang: 'fr' },
          { id: 'b', phone: null, lang: 'en' },
          { id: 'c', phone: '0190000003', lang: 'fon' },
        ]),
      },
      notification: { createMany: vi.fn(async ({ data }: { data: typeof created }) => created.push(...data)) },
    };
    const outbox = { send: vi.fn(async (m: (typeof sent)[number]) => sent.push(m)) };
    const svc = new NotificationsService(prisma as never, outbox as never);
    const text = vi.fn(note('order.n.accepted.title', 'order.n.accepted.body', { pharmacy: 'Pharmacie Camp Guézo', ref: 'CMD-1' }));
    const n = await svc.notify(['a', 'b', 'c', 'a'], { kind: 'COMMANDE', text, sms: (lang) => sms('order.accepted', lang, { pharmacy: 'P', ref: 'CMD-1' }) });

    expect(n).toBe(3);
    expect(text).toHaveBeenCalledTimes(3);
    expect(created.map((c) => [c.userId, c.title])).toEqual([
      ['a', 'Commande acceptée'],
      ['b', 'Order accepted'],
      ['c', 'Commande acceptée'],
    ]);
    expect(created[1].body).toBe('Pharmacie Camp Guézo is preparing your order CMD-1.');
    expect(sent.map((m) => [m.to, m.lang])).toEqual([
      ['0190000001', 'fr'],
      ['0190000003', 'fon'],
    ]);
  });
});
