/**
 * Jeton d'estimation signé (HMAC) : le paiement se fait contre une estimation calculée par le serveur,
 * jamais contre un montant ou un libellé envoyé par le téléphone. Le jeton porte le montant à payer,
 * le libellé du reçu, la référence, la personne et une date d'expiration ; toute modification casse
 * la signature. Il ne contient aucune donnée médicale au-delà de ce qui figure sur le reçu.
 */

export const ESTIMATE_TTL_MS = 30 * 60_000;

export interface EstimateClaims {
  v: 1;
  /** Référence unique de l'estimation (reportée sur le paiement, un seul paiement par référence). */
  ref: string;
  /** Patient et compte qui ont demandé l'estimation. */
  p: string;
  u: string;
  /** Reste à payer, total et part prise en charge (FCFA). */
  amount: number;
  total: number;
  covered: number;
  /** Libellé du reçu. */
  label: string;
  /** Expiration (ms depuis l'époque). */
  exp: number;
}

type Mac = (value: string) => string;
type SafeEqual = (a: string, b: string) => boolean;

const scope = (body: string) => `estimate:v1:${body}`;

export function signEstimate(claims: EstimateClaims, mac: Mac): string {
  const body = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return `${body}.${mac(scope(body))}`;
}

export type EstimateCheck = { ok: true; claims: EstimateClaims } | { ok: false; reason: 'INVALID' | 'EXPIRED' };

export function readEstimate(token: string, mac: Mac, safeEqual: SafeEqual, now = Date.now()): EstimateCheck {
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined || !safeEqual(sig, mac(scope(body)))) return { ok: false, reason: 'INVALID' };
  let claims: EstimateClaims;
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as EstimateClaims;
  } catch {
    return { ok: false, reason: 'INVALID' };
  }
  const valid =
    claims?.v === 1 &&
    typeof claims.ref === 'string' &&
    typeof claims.p === 'string' &&
    typeof claims.u === 'string' &&
    Number.isInteger(claims.amount) &&
    typeof claims.label === 'string' &&
    Number.isFinite(claims.exp);
  if (!valid) return { ok: false, reason: 'INVALID' };
  if (claims.exp <= now) return { ok: false, reason: 'EXPIRED' };
  return { ok: true, claims };
}

/** Libellé du reçu à partir des lignes (120 caractères au plus). */
export function receiptLabel(labels: string[]): string {
  const text = labels.join(', ');
  return text.length <= 120 ? text : `${text.slice(0, 117).trimEnd()}…`;
}
