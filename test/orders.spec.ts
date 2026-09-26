import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { DispatchOrderDto } from '../src/orders/orders.dto';
import {
  allowedNext,
  awaitsHandover,
  canTransition,
  checkHandoverCode,
  codeAttemptsLeft,
  deliveryFee,
  expiryHours,
  handoverStatus,
  newCodesSent,
  newHandoverCode,
  orderRef,
  receiptNumber,
  requiresPrescription,
  splitRecipients,
  type OrderStatus,
} from '../src/orders/orders.logic';

describe('commandes : frais de livraison', () => {
  it('retrait gratuit, 500 FCFA dans la commune de la pharmacie, 1 000 FCFA ailleurs', () => {
    expect(deliveryFee('RETRAIT', 'cotonou', 'cotonou')).toBe(0);
    expect(deliveryFee('RETRAIT', 'cotonou', 'calavi')).toBe(0);
    expect(deliveryFee('LIVRAISON', 'cotonou', 'cotonou')).toBe(500);
    expect(deliveryFee('LIVRAISON', 'cotonou', 'calavi')).toBe(1000);
  });

  it('commune de livraison inconnue : tarif hors commune', () => {
    expect(deliveryFee('LIVRAISON', 'cotonou', null)).toBe(1000);
    expect(deliveryFee('LIVRAISON', 'cotonou', undefined)).toBe(1000);
  });
});

describe('commandes : automate des statuts', () => {
  it('livraison : Reçue → Acceptée → Prête → En route → Livrée', () => {
    const path: OrderStatus[] = ['RECUE', 'ACCEPTEE', 'PRETE', 'EN_LIVRAISON', 'LIVREE'];
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i], path[i + 1], 'LIVRAISON')).toBe(true);
    expect(handoverStatus('LIVRAISON')).toBe('LIVREE');
  });

  it('retrait : Reçue → Acceptée → Prête → Retirée, jamais « en route »', () => {
    expect(canTransition('PRETE', 'RETIREE', 'RETRAIT')).toBe(true);
    expect(canTransition('PRETE', 'EN_LIVRAISON', 'RETRAIT')).toBe(false);
    expect(canTransition('PRETE', 'RETIREE', 'LIVRAISON')).toBe(false);
    expect(handoverStatus('RETRAIT')).toBe('RETIREE');
  });

  it('aucune étape sautée : pas de livraison avant « prête », pas de remise avant « en route »', () => {
    expect(canTransition('RECUE', 'PRETE', 'LIVRAISON')).toBe(false);
    expect(canTransition('ACCEPTEE', 'EN_LIVRAISON', 'LIVRAISON')).toBe(false);
    expect(canTransition('PRETE', 'LIVREE', 'LIVRAISON')).toBe(false);
    expect(canTransition('RECUE', 'LIVREE', 'LIVRAISON')).toBe(false);
  });

  it('le patient annule seulement tant que la pharmacie n’a pas accepté', () => {
    expect(canTransition('RECUE', 'ANNULEE', 'LIVRAISON')).toBe(true);
    for (const s of ['ACCEPTEE', 'PRETE', 'EN_LIVRAISON'] as OrderStatus[]) expect(canTransition(s, 'ANNULEE', 'LIVRAISON')).toBe(false);
  });

  it('la pharmacie refuse tant que rien n’est parti, pas une fois en route', () => {
    for (const s of ['RECUE', 'ACCEPTEE', 'PRETE'] as OrderStatus[]) expect(canTransition(s, 'REFUSEE', 'LIVRAISON')).toBe(true);
    expect(canTransition('EN_LIVRAISON', 'REFUSEE', 'LIVRAISON')).toBe(false);
  });

  it('aucune commande acceptée ne reste bloquée : échec possible jusqu’à la remise (livraison et retrait)', () => {
    for (const s of ['ACCEPTEE', 'PRETE', 'EN_LIVRAISON'] as OrderStatus[]) expect(canTransition(s, 'ECHEC', 'LIVRAISON')).toBe(true);
    for (const s of ['ACCEPTEE', 'PRETE'] as OrderStatus[]) expect(canTransition(s, 'ECHEC', 'RETRAIT')).toBe(true);
    expect(canTransition('RECUE', 'ECHEC', 'LIVRAISON')).toBe(false); // pas encore acceptée : refus ou annulation
    expect(allowedNext('ECHEC', 'LIVRAISON')).toEqual([]);
  });

  it('chaque statut non final a une sortie qui ne dépend ni du patient ni du code', () => {
    for (const mode of ['LIVRAISON', 'RETRAIT'] as const) {
      for (const s of ['RECUE', 'ACCEPTEE', 'PRETE', 'EN_LIVRAISON'] as OrderStatus[]) {
        if (mode === 'RETRAIT' && s === 'EN_LIVRAISON') continue;
        expect(allowedNext(s, mode).some((n) => ['REFUSEE', 'ECHEC', 'ANNULEE'].includes(n))).toBe(true);
      }
    }
  });

  it('les statuts finaux sont définitifs', () => {
    for (const s of ['LIVREE', 'RETIREE', 'REFUSEE', 'ANNULEE', 'ECHEC'] as OrderStatus[]) {
      expect(allowedNext(s, 'LIVRAISON')).toEqual([]);
      expect(allowedNext(s, 'RETRAIT')).toEqual([]);
    }
  });
});

describe('commandes : code de remise', () => {
  it('tire un code à 4 chiffres', () => {
    for (let i = 0; i < 200; i++) expect(newHandoverCode()).toMatch(/^\d{4}$/);
  });

  it('accepte le bon code (espaces tolérés), refuse les autres', () => {
    expect(checkHandoverCode('0417', '0417')).toBe(true);
    expect(checkHandoverCode('0417', '04 17')).toBe(true);
    expect(checkHandoverCode('0417', '417')).toBe(false);
    expect(checkHandoverCode('0417', '0418')).toBe(false);
    expect(checkHandoverCode('0417', 'abcd')).toBe(false);
    expect(checkHandoverCode('0417', '04170')).toBe(false);
  });

  it('essais restants d’après le compteur atomique (5 au plus, jamais négatif)', () => {
    expect(codeAttemptsLeft(0)).toBe(5);
    expect(codeAttemptsLeft(4)).toBe(1);
    expect(codeAttemptsLeft(5)).toBe(0);
    expect(codeAttemptsLeft(9)).toBe(0);
  });

  it('nouveau code : seulement quand la remise est attendue, compté au journal', () => {
    expect(awaitsHandover('EN_LIVRAISON', 'LIVRAISON')).toBe(true);
    expect(awaitsHandover('PRETE', 'RETRAIT')).toBe(true);
    expect(awaitsHandover('RECUE', 'LIVRAISON')).toBe(false);
    expect(awaitsHandover('LIVREE', 'LIVRAISON')).toBe(false);
    const at = new Date().toISOString();
    expect(newCodesSent([{ status: 'RECUE', at }, { status: 'NOUVEAU_CODE', at }, { status: 'NOUVEAU_CODE', at }])).toBe(2);
  });
});

describe('commandes : références, reçus, ordonnance obligatoire', () => {
  it('référence courte lisible et reçu du bac à sable', () => {
    expect(orderRef('7e1a2c01-0000-4000-8000-00000000c001')).toBe('C-7E1A2');
    expect(receiptNumber('MM')).toMatch(/^MM-[A-Z2-9]{8}$/);
    expect(receiptNumber('ES')).toMatch(/^ES-[A-Z2-9]{8}$/);
  });

  it('anticancéreux, antibiotiques, psychotropes et injectables : ordonnance obligatoire', () => {
    expect(requiresPrescription({ atc: 'L01EA01', form: 'comprimé' })).toBe(true); // imatinib
    expect(requiresPrescription({ atc: 'J01CA04', form: 'gélule' })).toBe(true); // amoxicilline
    expect(requiresPrescription({ atc: 'N05BA01', form: 'solution injectable' })).toBe(true); // diazépam
    expect(requiresPrescription({ atc: 'B05BB01', form: 'solution pour perfusion' })).toBe(true);
  });

  it('paracétamol, SRO, antipaludique oral : commande libre', () => {
    expect(requiresPrescription({ atc: 'N02BE01', form: 'comprimé' })).toBe(false);
    expect(requiresPrescription({ atc: 'A07CA', form: 'poudre pour solution buvable' })).toBe(false);
    expect(requiresPrescription({ atc: 'P01BF01', form: 'comprimé' })).toBe(false);
    expect(requiresPrescription({ atc: null, form: 'sirop' })).toBe(false);
  });
});

describe('commandes : délais de la tâche planifiée', () => {
  it('24 h sans réponse, 72 h sans remise ; 30 jours en démonstration publique', () => {
    expect(expiryHours(false)).toEqual({ unanswered: 24, undelivered: 72 });
    expect(expiryHours(true)).toEqual({ unanswered: 720, undelivered: 720 });
  });
});

describe('commandes : qui reçoit le code de remise', () => {
  it('le patient et l’auteur encore autorisé ; les autres aidants « commandes » sans le code', () => {
    const r = splitRecipients(['koffi'], ['afiavi', 'tonton'], 'afiavi');
    expect(r.holders.sort()).toEqual(['afiavi', 'koffi']);
    expect(r.others).toEqual(['tonton']);
  });

  it('un aidant révoqué (ou sans le volet « commandes ») qui avait commandé ne reçoit plus rien', () => {
    const r = splitRecipients(['koffi'], [], 'ex-aidant');
    expect(r.holders).toEqual(['koffi']);
    expect(r.others).toEqual([]);
  });

  it('commande d’un parent pour son enfant : le parent a le code', () => {
    const r = splitRecipients(['serge'], [], 'serge');
    expect(r.holders).toEqual(['serge']);
  });
});

describe('commandes : nom et téléphone du livreur (repris dans le SMS du patient)', () => {
  const check = async (courierName: string, courierPhone: string) => (await validate(plainToInstance(DispatchOrderDto, { courierName, courierPhone }))).length;

  it('accepte un nom en lettres (accents, trait d’union, apostrophe) et un numéro à 8 ou 10 chiffres', async () => {
    expect(await check('Mathias', '0197112233')).toBe(0);
    expect(await check('Jean-Baptiste D’Almeida', '01 97 11 22 33')).toBe(0);
    expect(await check('Sèdjro', '97112233')).toBe(0);
  });

  it('refuse les liens, chiffres, balises, noms trop longs et numéros non numériques', async () => {
    expect(await check('https://arnaque.bj', '0197112233')).toBeGreaterThan(0);
    expect(await check('<b>Mathias</b>', '0197112233')).toBeGreaterThan(0);
    expect(await check('Appelez le 0199', '0197112233')).toBeGreaterThan(0);
    expect(await check('A'.repeat(41), '0197112233')).toBeGreaterThan(0);
    expect(await check('Mathias', '+22901971122')).toBeGreaterThan(0);
    expect(await check('Mathias', '01-97-AB')).toBeGreaterThan(0);
  });
});
