import { describe, expect, it } from 'vitest';
import { DISTRESS_LEXICON, DISTRESS_TODO, detectDistress, foldText } from '../src/data/distress';

describe('Écoute : détection des mots de détresse', () => {
  it('plie le texte (accents, tons, points souscrits, majuscules, apostrophes)', () => {
    expect(foldText('  J’ai ENVIE   de Mourir ')).toBe('j ai envie de mourir');
    expect(foldText('Mo fẹ́ kú')).toBe('mo fe ku');
    expect(foldText('Mi ò fẹ́ wà láàyè mọ́')).toBe('mi o fe wa laaye mo');
  });

  it('un lexique par langue (fr, en, fon, yo, bba, ddn) ; ceux à compléter sont signalés', () => {
    expect(Object.keys(DISTRESS_LEXICON).sort()).toEqual(['bba', 'ddn', 'en', 'fon', 'fr', 'yo']);
    expect(DISTRESS_TODO).toEqual(expect.arrayContaining(['bba', 'ddn']));
    expect(DISTRESS_TODO).not.toContain('fr');
    expect(DISTRESS_TODO).not.toContain('yo');
  });

  it.each([
    ['Mo fẹ́ kú', 'SUICIDE'],
    ['mo fe ku', 'SUICIDE'],
    ['Mo fẹ́ pa ara mi', 'SUICIDE'],
    ['Mi ò fẹ́ wà láàyè mọ́', 'SUICIDE'],
    ['Mo ti ronú nípa ìgbẹ̀mí ara ẹni', 'SUICIDE'],
    ['Ọkọ mi ń lù mí', 'VIOLENCE'],
  ])('yoruba, avec ou sans tons : « %s »', (text, kind) => {
    const r = detectDistress(text);
    expect(r.kinds).toContain(kind);
    expect(r.langs).toContain('yo');
  });

  it('fon : « Un jló ná kú »', () => {
    expect(detectDistress('Un jló ná kú').langs).toContain('fon');
  });

  it('toutes les langues sont testées sur chaque message, quelle que soit la langue de l’interface', () => {
    expect(detectDistress('Bonjour. Mo fẹ́ kú. I want to die.').langs).toEqual(expect.arrayContaining(['yo', 'en']));
  });

  it.each([
    'Je veux mourir',
    'J’ai envie de mourir ce soir',
    'je pense au suicide',
    'Je vais me suicider',
    'Je veux en finir',
    'Je n’ai plus envie de vivre',
    'Parfois je me dis que ce serait mieux sans moi',
    'je voudrais mettre fin à mes jours',
    'I want to die',
    'I want to kill myself',
    "I don't want to live anymore",
    'Everyone would be better off without me',
  ])('suicide ou envie de mourir : « %s »', (text) => {
    const r = detectDistress(text);
    expect(r.distress).toBe(true);
    expect(r.kinds).toContain('SUICIDE');
  });

  it.each(['J’ai envie de me faire du mal', 'je me scarifie le soir', 'Je vais avaler tous mes médicaments', 'I keep hurting myself', 'self-harm again'])(
    'automutilation : « %s »',
    (text) => {
      expect(detectDistress(text).kinds).toContain('AUTOMUTILATION');
    },
  );

  it.each(['Mon mari me frappe', 'Il m’a frappée hier', 'J’ai été violée', 'Il menace de me tuer', 'Je reçois des coups à la maison', 'My husband beats me', 'domestic violence'])(
    'violences subies : « %s »',
    (text) => {
      expect(detectDistress(text).kinds).toContain('VIOLENCE');
    },
  );

  it.each([
    'Je n’arrive plus à dormir',
    'J’ai peur de mourir de cette maladie',
    "I'm scared I am going to die",
    'Je me sens seul depuis que je suis malade',
    'Mon fils joue du violon',
    'Un mal de tête violent',
    'Merci pour vos coups de fil',
    'Je vais me couper les cheveux',
    'Mo fẹ́ kúrò níbí',
    'Ẹ kú àárọ̀',
  ])('pas de fausse alerte : « %s »', (text) => {
    expect(detectDistress(text).distress).toBe(false);
  });
});
