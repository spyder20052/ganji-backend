import { ALERTS } from './alerts';
import { APPOINTMENTS } from './appointments';
import { AUTH } from './auth';
import { BLOOD } from './blood';
import { CARE } from './care';
import { CHANNELS } from './channels';
import { CIRCLE } from './circle';
import { COMMON } from './common';
import { EMERGENCY } from './emergency';
import { LISTEN } from './listen';
import { MATERNAL } from './maternal';
import { MEDICATIONS } from './medications';
import { ORDERS } from './orders';
import { PATIENTS } from './patients';
import { PROFILE } from './profile';
import { RIGHTS } from './rights';

/** Catalogue par module : un fichier par module métier, clés préfixées par le module. */
export const CATALOG_PARTS = {
  common: COMMON,
  auth: AUTH,
  appointments: APPOINTMENTS,
  alerts: ALERTS,
  blood: BLOOD,
  care: CARE,
  channels: CHANNELS,
  circle: CIRCLE,
  emergency: EMERGENCY,
  listen: LISTEN,
  maternal: MATERNAL,
  medications: MEDICATIONS,
  orders: ORDERS,
  patients: PATIENTS,
  profile: PROFILE,
  rights: RIGHTS,
};

type Parts = typeof CATALOG_PARTS;
type Merge<U> = (U extends unknown ? (part: U) => void : never) extends (part: infer I) => void ? I : never;

/**
 * Tous les textes envoyés à une personne (SMS, voix, notifications, USSD), en français et en anglais.
 * Une clé en double entre deux modules est refusée par le test du catalogue (test/i18n.spec.ts).
 */
export const SMS = Object.assign({}, ...Object.values(CATALOG_PARTS)) as Merge<Parts[keyof Parts]>;

export type TextKey = keyof typeof SMS & string;
