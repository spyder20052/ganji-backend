import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { InferenceSession as Session } from 'onnxruntime-node';
import { PrismaService } from '../prisma/prisma.service';
import { chunks, spellDigits, tokenize, TTS_MODELS, VOCABS, type TtsLang } from './tts.text';

/** Modèles ONNX (MMS-TTS de Meta, convertis et allégés : scripts/voix/export_onnx.py), publiés en release GitHub. */
const MODELS_URL = process.env.TTS_MODELS_URL ?? 'https://github.com/spyder20052/ganji-backend/releases/download/tts-models-v1';
/** Dossier local des modèles : TTS_MODEL_DIR en développement, sinon /tmp (seul dossier inscriptible sur Vercel). */
const MODEL_DIR = process.env.TTS_MODEL_DIR ?? '/tmp/ganji-tts';
export const MAX_CHARS = 1500;

/**
 * Voix de synthèse en fon, yoruba, bariba et dendi : lit le texte réel de la page dans la langue choisie.
 * Le modèle d'une langue est téléchargé au premier usage puis gardé en mémoire ; chaque texte lu est
 * mis en cache (MP3 32 kbit/s, environ 4 Ko par seconde : supportable en 2G).
 */
@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);
  private readonly sessions = new Map<TtsLang, Promise<Session>>();

  constructor(private readonly prisma: PrismaService) {}

  async speak(lang: TtsLang, raw: string): Promise<{ data: Buffer; cached: boolean }> {
    const text = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS);
    const key = createHash('sha256').update(`${lang}\n${text}`).digest('hex');
    const hit = await this.prisma.ttsClip.findUnique({ where: { key } });
    if (hit) return { data: Buffer.from(hit.data), cached: true };

    const session = await this.session(lang);
    const rate = VOCABS[lang].samplingRate;
    const pieces: Float32Array[] = [];
    for (const part of chunks(spellDigits(text, lang))) {
      const ids = tokenize(part, lang);
      if (ids.length < 3) continue;
      const { Tensor } = await import('onnxruntime-node');
      const out = await session.run({ input_ids: new Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]) });
      pieces.push(out.waveform.data as Float32Array, new Float32Array(Math.round(rate * 0.3)));
    }
    if (!pieces.length) throw new ServiceUnavailableException('Rien à lire dans cette langue');
    const data = encodeMp3(pieces, rate);
    await this.prisma.ttsClip.upsert({ where: { key }, update: {}, create: { key, lang, chars: text.length, mime: 'audio/mpeg', data: new Uint8Array(data) } }).catch(() => undefined);
    return { data, cached: false };
  }

  private session(lang: TtsLang): Promise<Session> {
    let s = this.sessions.get(lang);
    if (!s) {
      s = this.load(lang).catch((e) => {
        this.sessions.delete(lang);
        this.logger.error(`Voix ${lang} indisponible : ${(e as Error).message}`);
        throw new ServiceUnavailableException('Voix indisponible pour le moment');
      });
      this.sessions.set(lang, s);
    }
    return s;
  }

  private async load(lang: TtsLang): Promise<Session> {
    const file = join(MODEL_DIR, `${TTS_MODELS[lang]}.onnx`);
    if (!existsSync(file)) {
      mkdirSync(MODEL_DIR, { recursive: true });
      const res = await fetch(`${MODELS_URL}/${TTS_MODELS[lang]}.onnx`);
      if (!res.ok || !res.body) throw new Error(`téléchargement du modèle : HTTP ${res.status}`);
      const tmp = `${file}.part`;
      await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmp));
      renameSync(tmp, file);
    }
    const { InferenceSession } = await import('onnxruntime-node');
    return InferenceSession.create(file, { intraOpNumThreads: 2, graphOptimizationLevel: 'all' });
  }
}

/** MP3 mono 32 kbit/s à partir des morceaux de voix (flottants -1..1). */
function encodeMp3(pieces: Float32Array[], rate: number): Buffer {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const lame = require('lamejs') as { Mp3Encoder: new (ch: number, rate: number, kbps: number) => { encodeBuffer(s: Int16Array): Int8Array; flush(): Int8Array } };
  const enc = new lame.Mp3Encoder(1, rate, 32);
  const out: Buffer[] = [];
  for (const p of pieces) {
    const s = new Int16Array(p.length);
    for (let i = 0; i < p.length; i++) s[i] = Math.max(-32768, Math.min(32767, Math.round(p[i] * 32767)));
    for (let i = 0; i < s.length; i += 1152) out.push(Buffer.from(enc.encodeBuffer(s.subarray(i, i + 1152))));
  }
  out.push(Buffer.from(enc.flush()));
  return Buffer.concat(out);
}
