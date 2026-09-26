import bba from './vocab/bba.json';
import ddn from './vocab/ddn.json';
import fon from './vocab/fon.json';
import yor from './vocab/yor.json';

/** Voix disponibles (modèles MMS-TTS de Meta) et code du modèle pour chaque langue de l'application. */
export const TTS_MODELS = { fon: 'fon', yoruba: 'yor', bariba: 'bba', dendi: 'ddn' } as const;
export type TtsLang = keyof typeof TTS_MODELS;
export const isTtsLang = (v: unknown): v is TtsLang => typeof v === 'string' && v in TTS_MODELS;

interface VocabFile {
  vocab: Record<string, number>;
  addBlank: boolean;
  samplingRate: number;
}
export const VOCABS: Record<TtsLang, VocabFile> = { fon, yoruba: yor, bariba: bba, dendi: ddn } as Record<TtsLang, VocabFile>;

/**
 * Les modèles ne lisent pas les chiffres : on les dit un par un (numéros comme 118, codes), avec les mots
 * de chaque langue. Traductions à valider par des locuteurs natifs (docs/LANGUES.md).
 */
const DIGITS: Record<TtsLang, string[]> = {
  fon: ['zelo', 'ɖokpó', 'wè', 'atɔn', 'ɛnɛ', 'atɔ́ɔ́n', 'ayizɛ́n', 'tɛ́nwe', 'tantɔn', 'tɛ́nnɛ'],
  yoruba: ['òdo', 'ọ̀kan', 'èjì', 'ẹ̀ta', 'ẹ̀rin', 'àrún', 'ẹ̀fà', 'èje', 'ẹ̀jọ', 'ẹ̀sán'],
  bariba: ['sari', 'tia', 'yiru', 'ita', 'nnɛ', 'nɔɔbu', 'nɔɔba tia', 'nɔɔba yiru', 'nɔɔba ita', 'nɔɔba nnɛ'],
  dendi: ['zeero', 'afo', 'hinka', 'hinza', 'taaci', 'guu', 'iddu', 'iyye', 'ahaku', 'yagga'],
};

/** Chiffres dits un par un ; « 1 710 » (espace de milliers) est lu comme un seul nombre. */
export function spellDigits(text: string, lang: TtsLang): string {
  return text.replace(/\d(?:[\d   ](?=\d))*\d?/g, (n) =>
    ` ${[...n.replace(/\D/g, '')].map((d) => DIGITS[lang][Number(d)]).join(' ')} `,
  );
}

/**
 * Identifiants du modèle pour un texte, comme le tokenizer VITS de Hugging Face (normalisation : chaque
 * caractère du vocabulaire gardé, sinon mis en minuscule ; ponctuation et caractères inconnus retirés ;
 * blanc (0) intercalé). Un caractère précomposé absent du vocabulaire (« à » en fon) est décomposé : on
 * garde sa lettre de base et les accents que le modèle connaît, au lieu de perdre toute la lettre.
 */
export function tokenize(text: string, lang: TtsLang): number[] {
  const { vocab, addBlank } = VOCABS[lang];
  const chars: string[] = [];
  for (const c of text.normalize('NFC')) {
    if (c in vocab) { chars.push(c); continue; }
    const lower = c.toLowerCase();
    if (lower in vocab) { chars.push(lower); continue; }
    for (const part of lower.normalize('NFD')) if (part in vocab) chars.push(part);
  }
  // Espaces en tête et en fin retirés, espaces multiples réduits (la ponctuation retirée en laisse).
  const ids = chars.join('').replace(/\s+/g, ' ').trim();
  const out = [...ids].map((c) => vocab[c]);
  if (!addBlank) return out;
  const inter = new Array<number>(out.length * 2 + 1).fill(0);
  out.forEach((id, i) => (inter[2 * i + 1] = id));
  return inter;
}

/** Morceaux lus séparément (phrases), pour rester dans la longueur que le modèle gère bien. */
export function chunks(text: string, max = 220): string[] {
  const sentences = text.replace(/\s+/g, ' ').split(/(?<=[.!?…;:])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const s of sentences) {
    if (s.length <= max) { out.push(s); continue; }
    let cur = '';
    for (const w of s.split(/(?<=,)\s+|\s+/)) {
      if ((cur + ' ' + w).trim().length > max && cur) { out.push(cur.trim()); cur = ''; }
      cur += ' ' + w;
    }
    if (cur.trim()) out.push(cur.trim());
  }
  return out;
}
