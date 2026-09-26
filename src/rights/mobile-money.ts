/**
 * Paiement mobile (MTN MoMo, Moov Money, Celtiis Cash). Interface + fournisseur : la démonstration
 * utilise un BAC À SABLE qui accepte tout paiement sans rien débiter ; un agrégateur réel se branche
 * en changeant le fournisseur MOBILE_MONEY. Ganji ne demande jamais le code secret : la personne
 * confirme sur son propre téléphone (demande de paiement envoyée par l'opérateur).
 */
import { randomBytes } from 'node:crypto';

export const PROVIDERS = ['MTN_MOMO', 'MOOV_MONEY', 'CELTIIS_CASH'] as const;
export type Provider = (typeof PROVIDERS)[number];

export const PROVIDER_LABEL: Record<Provider | 'ESPECES', string> = {
  MTN_MOMO: 'MTN Mobile Money',
  MOOV_MONEY: 'Moov Money',
  CELTIIS_CASH: 'Celtiis Cash',
  ESPECES: 'Espèces',
};

export interface CollectRequest {
  provider: Provider;
  phone: string;
  amountFcfa: number;
  reference: string;
  label: string;
}

export interface CollectResult {
  status: 'REUSSI' | 'ECHOUE';
  transactionId: string;
  message?: string;
}

export interface MobileMoneyGateway {
  readonly mode: 'sandbox' | 'live';
  collect(req: CollectRequest): Promise<CollectResult>;
}

export const MOBILE_MONEY = Symbol('MOBILE_MONEY');

export class SandboxMobileMoney implements MobileMoneyGateway {
  readonly mode = 'sandbox' as const;

  async collect(req: CollectRequest): Promise<CollectResult> {
    return { status: 'REUSSI', transactionId: `SBX-${req.provider}-${randomBytes(5).toString('hex').toUpperCase()}` };
  }
}

export function mobileMoneyFactory(): MobileMoneyGateway {
  const which = process.env.MOBILE_MONEY ?? 'sandbox';
  if (which !== 'sandbox') throw new Error(`Passerelle de paiement inconnue : ${which}`);
  return new SandboxMobileMoney();
}
