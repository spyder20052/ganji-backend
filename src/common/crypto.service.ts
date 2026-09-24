import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Chiffrement applicatif par champ (AES-256-GCM) et empreintes HMAC-SHA256.
 * Format chiffré : v1.<iv b64url>.<tag b64url>.<données b64url>
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;
  private readonly hmacKey: Buffer;

  constructor() {
    this.key = CryptoService.loadKey('FIELD_ENCRYPTION_KEY');
    this.hmacKey = CryptoService.loadKey('HMAC_KEY');
  }

  private static loadKey(name: string): Buffer {
    const raw = process.env[name];
    if (raw) {
      const buf = Buffer.from(raw, 'base64');
      if (buf.length !== 32) throw new Error(`${name} doit faire 32 octets encodés en base64`);
      return buf;
    }
    if (process.env.NODE_ENV === 'production' && process.env.DEMO_MODE !== 'true') {
      throw new Error(`${name} manquant`);
    }
    // Clé de développement déterministe : uniquement hors production.
    return createHmac('sha256', 'alafia-dev-only').update(name).digest();
  }

  encrypt(plain: string | null | undefined): string | null {
    if (plain === null || plain === undefined) return null;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv.toString('base64url'), tag.toString('base64url'), data.toString('base64url')].join('.');
  }

  decrypt(payload: string | null | undefined): string | null {
    if (!payload) return null;
    const [v, iv, tag, data] = payload.split('.');
    if (v !== 'v1' || !iv || !tag || !data) return null;
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  }

  hmac(value: string): string {
    return createHmac('sha256', this.hmacKey).update(value).digest('base64url');
  }

  hashNpi(npi: string): string {
    return this.hmac(`npi:${npi.replace(/\D/g, '')}`);
  }

  sign(value: string): string {
    return this.hmac(`sig:${value}`).slice(0, 32);
  }

  verify(value: string, signature: string): boolean {
    const expected = Buffer.from(this.sign(value));
    const given = Buffer.from(signature);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  otp(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  safeEqual(a: string, b: string): boolean {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    return ba.length === bb.length && timingSafeEqual(ba, bb);
  }
}
