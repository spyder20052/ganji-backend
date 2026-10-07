/**
 * Règles de la demande de sang sans base de données (testées dans test/blood.spec.ts) :
 * automate des statuts, créneau de collecte proposé au donneur, canal d'alerte.
 *
 * OUVERTE → DONNEURS_ALERTES → DONNEUR_TROUVE → POCHES_RESERVEES (besoin couvert) → SERVIE ;
 * ANNULEE à tout moment avant SERVIE.
 */
import type { Donor } from '@prisma/client';

/** Demande encore à couvrir : on peut alerter des donneurs, réserver des poches, se proposer. */
export const NEEDS_BLOOD = ['OUVERTE', 'DONNEURS_ALERTES', 'DONNEUR_TROUVE'];
/** Statuts d'une demande que l'on peut clore par « transfusion faite ». */
export const SERVABLE = [...NEEDS_BLOOD, 'POCHES_RESERVEES'];
export const FINAL_STATUSES = ['SERVIE', 'ANNULEE'];
/** Appels au don sans réponse expirés par la tâche planifiée après deux jours. */
export const DONOR_ALERT_TTL_MS = 48 * 3_600_000;

export type Urgency = 'VITALE' | 'URGENTE' | 'PROGRAMMEE';

const HOUR = 3_600_000;
/** Bénin : UTC+1 toute l'année. Collecte de 8 h à 16 h. */
const BENIN_OFFSET = HOUR;
const COLLECT_FROM = 8;
const COLLECT_TO = 16;

/** Heure (Bénin) donnée, le jour (Bénin) de `d`. */
function atBenin(d: Date, hour: number): Date {
  const local = new Date(d.getTime() + BENIN_OFFSET);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour) - BENIN_OFFSET);
}

/** Heure ronde suivante, au plus tôt dans une heure. */
function nextRoundHour(now: Date): Date {
  const d = new Date(now.getTime() + HOUR);
  d.setUTCMinutes(0, 0, 0);
  return d.getTime() <= now.getTime() ? new Date(d.getTime() + HOUR) : d;
}

/**
 * Créneau de collecte proposé au n-ième donneur qui dit oui (rang 0, 1, 2…), selon l'urgence :
 * - VITALE : dès que possible, de jour (prochaine heure ronde, 8 h-16 h), et toujours avant l'échéance ;
 * - URGENTE : aujourd'hui s'il reste du temps de collecte, sinon demain matin ;
 * - PROGRAMMEE : demain à partir de 8 h, un donneur par heure.
 * Les donneurs se succèdent d'une heure en heure pour ne pas engorger la salle de prélèvement.
 */
export function nextSlot(index: number, urgency: string, neededBy: Date | null, now = new Date()): Date {
  const rank = Math.min(Math.max(index, 0), 8);
  const tomorrowMorning = atBenin(new Date(now.getTime() + 24 * HOUR), COLLECT_FROM);
  let base: Date;
  if (urgency === 'VITALE') {
    const soon = nextRoundHour(now);
    const todayOpen = atBenin(now, COLLECT_FROM);
    const todayClose = atBenin(now, COLLECT_TO);
    base = soon < todayOpen ? todayOpen : soon <= todayClose ? soon : tomorrowMorning;
    // Avant l'échéance s'il le faut, même la nuit : une urgence vitale ne se remet pas au lendemain.
    if (neededBy && base > neededBy) base = neededBy > soon ? soon : neededBy;
    const slot = new Date(base.getTime() + rank * HOUR);
    return neededBy && slot > neededBy && base < neededBy ? neededBy : slot;
  }
  if (urgency === 'URGENTE') {
    const soon = nextRoundHour(now);
    const todayClose = atBenin(now, COLLECT_TO);
    base = soon >= atBenin(now, COLLECT_FROM) && new Date(soon.getTime() + rank * HOUR) <= todayClose ? soon : tomorrowMorning;
    return new Date(base.getTime() + rank * HOUR);
  }
  return new Date(tomorrowMorning.getTime() + rank * HOUR);
}

/**
 * Canal par lequel un donneur est réellement alerté : notification dans l'application s'il a un compte,
 * message vocal (en plus du SMS) pour un téléphone simple en langue nationale, SMS sinon.
 */
export function donorChannel(d: Pick<Donor, 'hasSmartphone' | 'lang' | 'userId'>): 'APP' | 'SMS' | 'VOICE' {
  if (d.userId) return 'APP';
  return !d.hasSmartphone && d.lang !== 'fr' && d.lang !== 'en' ? 'VOICE' : 'SMS';
}

/** Un donneur sans smartphone qui ne lit ni le français ni l'anglais reçoit aussi un appel vocal. */
export function wantsVoice(d: Pick<Donor, 'hasSmartphone' | 'lang'>): boolean {
  return !d.hasSmartphone && d.lang !== 'fr' && d.lang !== 'en';
}

// ─── Constantes partagées par les services du module ─────────────

/** Donneurs alertés au plus pour une demande. */
export const MAX_ALERTS = 14;
/** Stock « proche » d'un hôpital : sites de transfusion à moins de 60 km. */
export const STOCK_RADIUS_KM = 60;
/** Échéance par défaut d'une demande sans date : le lendemain à la même heure. */
export const DEFAULT_NEEDED_BY_MS = 24 * 3600_000;
/** Une demande dont l'échéance est passée depuis plus de six heures n'est plus proposée aux donneurs. */
export const NEARBY_GRACE_MS = 6 * 3600_000;
export const URGENCY_RANK: Record<string, number> = { VITALE: 0, URGENTE: 1, PROGRAMMEE: 2 };

export const INELIGIBLE_MESSAGE: Record<string, string> = {
  TOO_YOUNG: 'Il faut avoir au moins 18 ans pour donner son sang.',
  TOO_OLD: 'Au-delà de 60 ans, le don n’est plus possible. Merci de votre générosité !',
  WEIGHT: 'Il faut peser au moins 50 kg pour donner son sang. Merci de votre générosité !',
  PREGNANCY: 'Pas de don de sang pendant la grossesse. Vos proches peuvent donner.',
  CONDITION: 'Votre santé ne permet pas le don pour le moment. Vos proches peuvent donner pour vous.',
};

export type Place = { shortName: string | null; name: string };
/** Nom court d'un établissement s'il en a un, sinon son nom complet. */
export const placeOf = (f: Place) => f.shortName ?? f.name;
