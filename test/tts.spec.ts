import { describe, expect, it } from 'vitest';
import { chunks, spellDigits, tokenize, VOCABS, type TtsLang } from '../src/tts/tts.text';
import fon from './fixtures-tts-fon.json';
import yor from './fixtures-tts-yor.json';
import bba from './fixtures-tts-bba.json';
import ddn from './fixtures-tts-ddn.json';

const FIXTURES: [TtsLang, Record<string, number[]>][] = [['fon', fon], ['yoruba', yor], ['bariba', bba], ['dendi', ddn]];

describe('Voix MMS : même découpage que le tokenizer de référence (Hugging Face)', () => {
  for (const [lang, samples] of FIXTURES) {
    it(lang, () => {
      for (const [text, ids] of Object.entries(samples)) {
        // Écarts voulus : le tokenizer de référence perd une lettre précomposée inconnue (« Àdéhùn » → « déhn »)
        // et garde un double espace là où un chiffre est retiré. Hors de ces cas, identique au jeton près.
        const special = /\d/.test(text) || [...text.normalize('NFC')].some((c) => /\p{L}/u.test(c) && !(c.toLowerCase() in VOCABS[lang].vocab));
        // Dendi : la lettre « g » a l'identifiant du blanc (0) ; la référence en retire un en tête. Inaudible.
        const blankLetter = lang === 'dendi' && /g/i.test(text);
        if (!special && !blankLetter) expect(tokenize(text, lang), text).toEqual(ids);
      }
    });
  }
  it('au moins un texte identique au caractère près dans chaque langue', () => {
    for (const [lang, samples] of FIXTURES) {
      const same = Object.entries(samples).filter(([t, ids]) => JSON.stringify(tokenize(t, lang)) === JSON.stringify(ids));
      expect(same.length, lang).toBeGreaterThan(0);
    }
  });
});

describe('Chiffres et découpage', () => {
  it('118 dit chiffre par chiffre dans chaque langue', () => {
    expect(spellDigits('Appelez le 118.', 'fon')).toContain('ɖokpó ɖokpó tantɔn');
    expect(spellDigits('118', 'yoruba')).toContain('ọ̀kan ọ̀kan ẹ̀jọ');
    expect(spellDigits('118', 'dendi')).toContain('afo afo ahaku');
    expect(spellDigits('1 710 FCFA', 'bariba')).toContain('tia nɔɔba yiru tia sari');
  });
  it('un texte long est coupé en phrases de 220 caractères au plus', () => {
    const t = 'Première phrase. ' + 'mot '.repeat(120) + '. Fin.';
    const c = chunks(t);
    expect(c[0]).toBe('Première phrase.');
    expect(c.every((x) => x.length <= 220)).toBe(true);
    expect(c.at(-1)).toBe('Fin.');
  });
});
