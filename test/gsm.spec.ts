import { describe, expect, it } from 'vitest';
import { smsSafe } from '../src/common/gsm';

/** Caractères de l'alphabet GSM 7 bits de base utilisés dans nos SMS (sans lettres spéciales ni tons). */
const GSM = /^[A-Za-z0-9 \n\r@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà]*$/;

describe('SMS en langue nationale', () => {
  it('fon : lettres propres et tons retirés, message resté en alphabet GSM', () => {
    const out = smsSafe('Ganji : Mi yí gbè 1 bo ɖɔ ɛɛn. Hwenu : 13 h', 'fon');
    expect(out).toBe('Ganji : Mi yi gbe 1 bo do een. Hwenu : 13 h');
    expect(out).toMatch(GSM);
  });
  it('yoruba : points souscrits et tons retirés', () => {
    const out = smsSafe('Ẹ jọ̀ọ́, ẹ dáhùn 1 tí ẹ bá ti lò ó.', 'yoruba');
    expect(out).toBe('E joo, e dahun 1 ti e ba ti lo o.');
    expect(out).toMatch(GSM);
  });
  it('bariba et dendi : ŋ et ɲ deviennent ng et ny', () => {
    expect(smsSafe('Kuri haŋ, ɲaŋ', 'dendi')).toBe('Kuri hang, nyang');
    expect(smsSafe('Yɛm kɛ̃o', 'bariba')).toBe('Yem keo');
  });
  it('français et anglais : inchangés', () => {
    expect(smsSafe('Ganji : votre rendez-vous est confirmé. Répondez 1.', 'fr')).toBe('Ganji : votre rendez-vous est confirmé. Répondez 1.');
    expect(smsSafe('Ganji: reply 1 when done.', 'en')).toBe('Ganji: reply 1 when done.');
  });
});
