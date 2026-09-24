import { describe, expect, it } from 'vitest';
import { CryptoService } from '../src/common/crypto.service';

describe('CryptoService', () => {
  const c = new CryptoService();

  it('chiffre et déchiffre un champ (AES-256-GCM, IV aléatoire)', () => {
    const a = c.encrypt('Leucémie myéloïde chronique')!;
    const b = c.encrypt('Leucémie myéloïde chronique')!;
    expect(a).not.toEqual(b);
    expect(a.startsWith('v1.')).toBe(true);
    expect(c.decrypt(a)).toBe('Leucémie myéloïde chronique');
  });

  it('détecte toute altération du chiffré', () => {
    const a = c.encrypt('secret')!;
    const parts = a.split('.');
    parts[3] = Buffer.from('autre').toString('base64url');
    expect(() => c.decrypt(parts.join('.'))).toThrow();
  });

  it('hache le NPI de façon stable sans le révéler', () => {
    expect(c.hashNpi('1034 5672 01')).toBe(c.hashNpi('1034567201'));
    expect(c.hashNpi('1034567201')).not.toContain('1034567201');
  });

  it('signe et vérifie (ordonnance)', () => {
    const sig = c.sign('rx-1|patient|items');
    expect(c.verify('rx-1|patient|items', sig)).toBe(true);
    expect(c.verify('rx-1|patient|items-modifiés', sig)).toBe(false);
  });

  it('génère des OTP à 6 chiffres', () => {
    for (let i = 0; i < 50; i++) expect(c.otp()).toMatch(/^\d{6}$/);
  });
});
