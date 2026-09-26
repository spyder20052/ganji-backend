import type { Lang } from '@prisma/client';
import { clock, label, sms, TZ, weekdayDate } from '../common/i18n';

/**
 * Ce que la personne choisit pour prendre rendez-vous : un service compréhensible (« Enfant », « Cœur »),
 * rattaché aux spécialités des soignants inscrits dans chaque établissement. Libellés : catalogue de textes
 * (clés rdv.service.*).
 */
export const SERVICES = {
  GENERALE: { matches: null, services: [] },
  PEDIATRIE: { matches: ['PEDIATRIE'], services: ['pediatrie'] },
  GYNECOLOGIE: { matches: ['GYNECOLOGIE', 'SAGE_FEMME'], services: ['maternite'] },
  CARDIOLOGIE: { matches: ['CARDIOLOGIE'], services: [] },
  HEMATOLOGIE: { matches: ['HEMATOLOGIE'], services: ['hematologie'] },
  DERMATOLOGIE: { matches: ['DERMATOLOGIE'], services: [] },
  ONCOLOGIE: { matches: ['ONCOLOGIE'], services: ['oncologie'] },
} as const satisfies Record<string, { matches: readonly string[] | null; services: readonly string[] }>;

export type ServiceCode = keyof typeof SERVICES;
export const SERVICE_CODES = Object.keys(SERVICES) as ServiceCode[];

/** Spécialités de soignant qui peuvent recevoir ce service (null : tout soignant). */
export function practitionerSpecialties(code: ServiceCode): readonly string[] | null {
  return SERVICES[code].matches;
}

/**
 * Soignants (médecin ou infirmier inscrit sur Ganji) qui peuvent répondre pour ce service : de la bonne
 * spécialité, ou exerçant dans un établissement qui a ce service (un CHU mère-enfant pour « Enfant »).
 */
export function staffFilter(code: ServiceCode | undefined, roles: readonly ('PRACTITIONER' | 'NURSE')[]) {
  const base = { facilityId: { not: null }, user: { role: { in: [...roles] } } };
  if (!code) return base;
  const s = SERVICES[code];
  if (!s.matches) return base;
  const bySpecialty = { specialty: { in: [...s.matches] } };
  return s.services.length ? { ...base, OR: [bySpecialty, { facility: { is: { services: { hasSome: [...s.services] } } } }] } : { ...base, ...bySpecialty };
}

/** « Consultation hématologie » : titre du rappel dans le carnet (jamais envoyé par SMS). */
export function reminderTitle(code: string) {
  return !(code in SERVICES) || code === 'GENERALE' ? 'Consultation' : `Consultation ${serviceLabel(code, 'fr')}`;
}

/** Libellé du service dans la langue du destinataire (notifications des soignants). */
export const serviceLabel = (code: string, lang: Lang = 'fr') => label('rdv.service', code, lang, code.toLowerCase());

const DAY = 86_400_000;

/** Début de la journée (heure du Bénin) contenant `d`. */
export function startOfDayBenin(d: Date): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return new Date(`${ymd}T00:00:00+01:00`);
}

/** Un souhait de date : à partir d'aujourd'hui, au plus tard dans 90 jours. */
export function checkPreferred(preferredAt: Date, now = new Date()): string | null {
  if (Number.isNaN(preferredAt.getTime())) return 'Date souhaitée invalide';
  if (preferredAt < startOfDayBenin(now)) return 'Choisissez une date à partir d’aujourd’hui.';
  if (preferredAt.getTime() > now.getTime() + 90 * DAY) return 'Choisissez une date dans les trois prochains mois.';
  return null;
}

/** Matin avant midi, après-midi ensuite (heure du Bénin). */
export function partOfDay(d: Date): 'MATIN' | 'APRES_MIDI' {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(d));
  return h < 12 ? 'MATIN' : 'APRES_MIDI';
}

/** « jeudi 3 octobre à 9 h 00 » / « Thursday 3 October at 09:00 », pour les SMS et les notifications. */
export function when(d: Date, lang: Lang = 'fr'): string {
  return sms('date.at', lang, { day: (l) => weekdayDate(d, l), time: (l) => clock(d, l) });
}

/** « jeudi 3 octobre, le matin » : le souhait de la personne, sans heure précise. */
export function preferredText(d: Date, lang: Lang = 'fr'): string {
  const part = partOfDay(d) === 'MATIN' ? 'date.morning' : 'date.afternoon';
  return sms('date.dayPart', lang, { day: (l) => weekdayDate(d, l), part: (l) => sms(part, l) });
}

export type Status = 'DEMANDE' | 'CONFIRME' | 'REFUSE' | 'ANNULE' | 'FAIT';

/** Transitions permises : l'établissement confirme (ou replace), refuse, clôt ; la personne annule. */
const NEXT: Record<Status, Status[]> = {
  DEMANDE: ['CONFIRME', 'REFUSE', 'ANNULE'],
  CONFIRME: ['CONFIRME', 'FAIT', 'ANNULE', 'REFUSE'],
  REFUSE: [],
  ANNULE: [],
  FAIT: [],
};
export const canMove = (from: string, to: Status) => (NEXT[from as Status] ?? []).includes(to);

/** Liste de la personne : à venir (confirmés), en attente, puis passés ou clos. */
export function sortForPatient<T extends { status: string; scheduledAt: Date | null; preferredAt: Date; updatedAt: Date }>(items: T[], now = new Date()) {
  const upcoming = (a: T) => a.status === 'CONFIRME' && a.scheduledAt && a.scheduledAt.getTime() >= now.getTime() - 3 * 3600_000;
  const rank = (a: T) => (upcoming(a) ? 0 : a.status === 'DEMANDE' ? 1 : 2);
  return [...items].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r) return r;
    if (rank(a) === 0) return a.scheduledAt!.getTime() - b.scheduledAt!.getTime();
    if (rank(a) === 1) return a.preferredAt.getTime() - b.preferredAt.getTime();
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });
}
