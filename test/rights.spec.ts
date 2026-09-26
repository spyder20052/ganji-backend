import { describe, expect, it } from 'vitest';
import { isValidArch, luhnCheckDigit, normalizeArch, SandboxCoverageRegistry } from '../src/rights/coverage-registry';
import { CryptoService } from '../src/common/crypto.service';
import { ESTIMATE_TTL_MS, readEstimate, receiptLabel, signEstimate } from '../src/rights/estimate-token';
import { maskPhone } from '../src/rights/rights.service';
import { TARIFFS } from '../src/data/tariffs';
import { KOFFI_ARCH } from '../prisma/seed-ext/rights';

const person = { firstName: 'Koffi', lastName: 'Agossou', birthDate: new Date('1992-03-14') };

describe('droits : registre de couverture (bac à sable)', () => {
  it('numéro ARCH : forme canonique et chiffre de contrôle de Luhn', () => {
    expect(normalizeArch('arch 2024 1535')).toBe('ARCH-20241535');
    expect(normalizeArch('20241535')).toBe('ARCH-20241535');
    expect(normalizeArch('ARCH-123')).toBeNull();
    expect(luhnCheckDigit('2024153')).toBe(5);
    expect(isValidArch(KOFFI_ARCH)).toBe(true);
    expect(isValidArch('ARCH-20241536')).toBe(false);
  });

  it('ARCH valide → ACTIF 70 %, jusqu’au 31 décembre', async () => {
    const r = await new SandboxCoverageRegistry().check({ scheme: 'ARCH', number: 'arch-2024-1535', person });
    expect(r).toMatchObject({ status: 'ACTIF', rate: 70, number: 'ARCH-20241535', reason: null, source: 'bac à sable' });
    expect(r.validUntil?.getUTCMonth()).toBe(11);
  });

  it('ARCH invalide → en attente, avec la prochaine étape', async () => {
    const r = await new SandboxCoverageRegistry().check({ scheme: 'ARCH', number: 'ARCH-12345678', person });
    expect(r).toMatchObject({ status: 'EN_ATTENTE', rate: 0, reason: 'NUMERO_INVALIDE' });
    expect(r.nextStep).toContain('guichet ARCH');
  });

  it('mutuelle → en attente (non raccordée) : la carte se montre à l’accueil', async () => {
    const r = await new SandboxCoverageRegistry().check({ scheme: 'MUTUELLE', number: 'ms-00412', person });
    expect(r).toMatchObject({ status: 'EN_ATTENTE', reason: 'NON_RACCORDE', number: 'MS-00412' });
  });
});

describe('droits : grille et reçu', () => {
  it('grille indicative : codes uniques, prix entiers positifs, césarienne gratuite', () => {
    expect(new Set(TARIFFS.map((t) => t.code)).size).toBe(TARIFFS.length);
    for (const t of TARIFFS) expect(Number.isInteger(t.priceFcfa) && t.priceFcfa >= 0).toBe(true);
    expect(TARIFFS.find((t) => t.code === 'ACT-CES')?.priceFcfa).toBe(0);
    for (const code of ['CONS-GEN', 'CONS-SPE', 'LAB-NFS', 'LAB-GE', 'LAB-TDR', 'LAB-GLY', 'LAB-CREA', 'IMG-ECHO-ABD', 'IMG-RXT', 'HOSP-JOUR', 'ACT-ACC', 'ACT-SANG']) {
      expect(TARIFFS.some((t) => t.code === code), code).toBe(true);
    }
  });

  it('le numéro de téléphone du reçu est masqué', () => {
    expect(maskPhone('0190000001')).toBe('01 •• •• 00 01');
    expect(maskPhone(null)).toBeNull();
  });
});

describe('droits : paiement contre une estimation signée', () => {
  const crypto = new CryptoService();
  const mac = (v: string) => crypto.hmac(v);
  const eq = (a: string, b: string) => crypto.safeEqual(a, b);
  const now = Date.now();
  const claims = { v: 1 as const, ref: 'EST-1A2B3C4D', p: 'patient-1', u: 'user-1', amount: 1710, total: 5700, covered: 3990, label: 'Consultation, NFS', exp: now + ESTIMATE_TTL_MS };

  it('un jeton intact se relit avec le montant et le libellé du serveur', () => {
    const check = readEstimate(signEstimate(claims, mac), mac, eq, now);
    expect(check).toEqual({ ok: true, claims });
  });

  it('montant, libellé ou personne modifiés : signature invalide', () => {
    const token = signEstimate(claims, mac);
    const [, sig] = token.split('.');
    for (const forged of [{ ...claims, amount: 50 }, { ...claims, label: 'Autre chose' }, { ...claims, p: 'patient-2' }]) {
      const body = Buffer.from(JSON.stringify(forged)).toString('base64url');
      expect(readEstimate(`${body}.${sig}`, mac, eq, now)).toEqual({ ok: false, reason: 'INVALID' });
    }
    expect(readEstimate('pas-un-jeton', mac, eq, now)).toEqual({ ok: false, reason: 'INVALID' });
    expect(readEstimate(`${token}.x`, mac, eq, now)).toEqual({ ok: false, reason: 'INVALID' });
    // Signé avec une autre clé.
    expect(readEstimate(signEstimate(claims, (v) => `x${v.length}`), mac, eq, now)).toEqual({ ok: false, reason: 'INVALID' });
  });

  it('jeton expiré après 30 minutes', () => {
    const token = signEstimate(claims, mac);
    expect(readEstimate(token, mac, eq, now + ESTIMATE_TTL_MS + 1)).toEqual({ ok: false, reason: 'EXPIRED' });
  });

  it('libellé du reçu : 120 caractères au plus', () => {
    expect(receiptLabel(['Consultation', 'NFS'])).toBe('Consultation, NFS');
    const long = receiptLabel(Array.from({ length: 20 }, () => 'Numération formule sanguine (NFS)'));
    expect(long.length).toBeLessThanOrEqual(120);
    expect(long.endsWith('…')).toBe(true);
  });
});
