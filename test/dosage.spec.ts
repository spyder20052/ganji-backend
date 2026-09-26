import { describe, expect, it } from 'vitest';
import { cotonouDateKey, occurrences, parseDosage, parseDuration, startOfCotonouDay } from '../src/assistant/dosage';

describe('posologie : heures de prise', () => {
  it.each([
    ['1 comprimé matin et soir', ['08:00', '20:00']],
    ['1 comprimé le matin', ['08:00']],
    ['1 gélule le soir', ['20:00']],
    ['1 comprimé au coucher', ['22:00']],
    ['1 cp matin, midi et soir', ['08:00', '13:00', '20:00']],
    ['2 fois par jour', ['08:00', '20:00']],
    ['deux fois par jour', ['08:00', '20:00']],
    ['3x/j', ['08:00', '13:00', '20:00']],
    ['3 x par jour', ['08:00', '13:00', '20:00']],
    ['1 gélule 2x/j', ['08:00', '20:00']],
    ['trois fois par jour', ['08:00', '13:00', '20:00']],
    ['4 fois par jour', ['08:00', '12:00', '16:00', '20:00']],
    ['2 fois dans la journée', ['08:00', '20:00']],
    ['1 prise par jour', ['08:00']],
    ['une fois par jour', ['08:00']],
    ['1 comprimé par jour', ['08:00']],
    ['1 comprimé/j', ['08:00']],
    ['1 comprimé par jour, au cours du repas', ['13:00']],
    ['1 comprimé après le déjeuner', ['13:00']],
    ['1 sachet au petit-déjeuner', ['08:00']],
    ['1 comprimé au dîner', ['20:00']],
    ['toutes les 8 heures', ['06:00', '14:00', '22:00']],
    ['1 comprimé toutes les 12 h', ['08:00', '20:00']],
    ['toutes les 6 heures', ['00:00', '06:00', '12:00', '18:00']],
    ['2 fois par jour, matin et soir', ['08:00', '20:00']],
  ])('« %s » → %j', (dosage, times) => {
    const plan = parseDosage(dosage);
    expect(plan.times).toEqual(times);
    expect(plan.perDay).toBe(times.length);
    expect(plan.understood).toBe(true);
    expect(plan.asNeeded).toBe(false);
  });

  it('un nombre de prises qui ne correspond pas aux moments cités reprend les heures par défaut', () => {
    expect(parseDosage('3 fois par jour dont le soir').times).toEqual(['08:00', '13:00', '20:00']);
  });

  it('« si besoin » ne crée aucun rappel', () => {
    for (const d of ['1 comprimé si douleur', '1 à 2 comprimés si besoin, jusqu’à 3 fois par jour', 'en cas de fièvre']) {
      const plan = parseDosage(d);
      expect(plan.asNeeded).toBe(true);
      expect(plan.times).toEqual([]);
      expect(plan.perDay).toBe(0);
    }
  });

  it('un texte incompris ne donne aucune heure inventée', () => {
    const plan = parseDosage('Appliquer sur la peau');
    expect(plan.understood).toBe(false);
    expect(plan.times).toEqual([]);
  });

  it('rythmes espacés : un jour sur deux, une fois par semaine, toutes les 48 h', () => {
    expect(parseDosage('1 comprimé un jour sur deux')).toMatchObject({ times: ['08:00'], everyDays: 2, durationDays: null });
    expect(parseDosage('1 comprimé une fois par semaine')).toMatchObject({ times: ['08:00'], everyDays: 7 });
    expect(parseDosage('1 injection toutes les 48 h')).toMatchObject({ times: ['08:00'], everyDays: 2 });
  });

  it('quantité par prise et repas', () => {
    expect(parseDosage('2 comprimés 3 fois par jour').dose).toBe('2 comprimés');
    expect(parseDosage('10 mL trois fois par jour').dose).toBe('10 mL');
    expect(parseDosage('½ comprimé le soir').dose).toBe('½ comprimé');
    expect(parseDosage('une gélule le matin').dose).toBe('une gélule');
    expect(parseDosage('1 comprimé par jour, au cours du repas').meal).toBe('PENDANT');
    expect(parseDosage('1 comprimé avant le repas, 2 fois par jour').meal).toBe('AVANT');
    expect(parseDosage('1 comprimé après les repas matin et soir').meal).toBe('APRES');
    expect(parseDosage('1 gélule le matin à jeun').meal).toBe('A_JEUN');
    expect(parseDosage('1 comprimé le matin').meal).toBeNull();
  });
});

describe('posologie : durée', () => {
  it.each([
    ['7 jours', 7],
    ['pendant 10 j', 10],
    ['2 semaines', 14],
    ['1 mois', 30],
    ['un mois', 30],
    ['3 mois', 90],
    ['30 jours', 30],
  ])('« %s » → %i jours', (text, days) => {
    expect(parseDuration(text)).toEqual({ days, longTerm: false });
  });

  it('au long cours : pas de durée, traitement de fond', () => {
    expect(parseDuration('au long cours')).toEqual({ days: null, longTerm: true });
    expect(parseDuration('à vie')).toEqual({ days: null, longTerm: true });
    expect(parseDuration('')).toEqual({ days: null, longTerm: false });
  });

  it('durée écrite dans la posologie, ou dans le champ durée (prioritaire)', () => {
    expect(parseDosage('1 comprimé matin et soir pendant 7 jours').durationDays).toBe(7);
    expect(parseDosage('3 fois par jour pendant 5 jours', '10 jours').durationDays).toBe(10);
    expect(parseDosage('1 comprimé par jour', '1 mois').durationDays).toBe(30);
    expect(parseDosage('2 fois par jour').durationDays).toBeNull();
    expect(parseDosage('1 comprimé par jour', 'au long cours')).toMatchObject({ durationDays: null, longTerm: true });
  });
});

describe('calendrier des prises (heure de Cotonou)', () => {
  it('début de journée à Cotonou (UTC+1)', () => {
    // 23 h 30 UTC le 25 = 0 h 30 à Cotonou le 26.
    expect(startOfCotonouDay(new Date('2026-09-25T23:30:00Z')).toISOString()).toBe('2026-09-25T23:00:00.000Z');
    expect(cotonouDateKey(new Date('2026-09-25T23:30:00Z'))).toBe('2026-09-26');
  });

  it('génère les prises de chaque jour entre deux instants', () => {
    const from = new Date('2026-09-26T09:00:00Z'); // 10 h à Cotonou
    const until = new Date('2026-09-28T22:59:00Z');
    const list = occurrences(['08:00', '20:00'], 1, from, until).map((d) => d.toISOString());
    expect(list).toEqual([
      '2026-09-26T19:00:00.000Z',
      '2026-09-27T07:00:00.000Z',
      '2026-09-27T19:00:00.000Z',
      '2026-09-28T07:00:00.000Z',
      '2026-09-28T19:00:00.000Z',
    ]);
  });

  it('un jour sur deux, compté depuis le début du traitement', () => {
    const anchor = new Date('2026-09-26T06:00:00Z');
    const list = occurrences(['08:00'], 2, anchor, new Date('2026-10-01T22:00:00Z'), anchor).map(cotonouDateKey);
    expect(list).toEqual(['2026-09-26', '2026-09-28', '2026-09-30']);
  });
});
