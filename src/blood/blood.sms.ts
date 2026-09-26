import type { Lang } from '@prisma/client';
import { defineSms } from '../common/sms';

/** SMS et messages vocaux du don de sang : jamais de maladie, seulement un lieu, un groupe, une consigne. */
defineSms({
  'blood.donor.call': {
    fr: 'Ganji : {name}, votre don de sang ({group}) peut sauver une vie à {place}, à {km} km. Répondez 1 pour OUI ou 2 pour NON.',
    en: 'Ganji: {name}, your blood donation ({group}) can save a life at {place}, {km} km away. Reply 1 for YES or 2 for NO.',
  },
  'blood.donor.voice': {
    fr: 'Appel vocal : appel au don de sang à {place}. Tapez 1 pour oui, 2 pour non.',
    en: 'Voice call: blood donation needed at {place}. Press 1 for yes, 2 for no.',
  },
  'blood.donor.rdv': {
    fr: 'Ganji : merci {name} ! Rendez-vous {when} à {place}, service de transfusion. Venez avec une pièce d’identité, après avoir mangé.',
    en: 'Ganji: thank you {name}! Appointment {when} at {place}, blood transfusion unit. Bring an ID card and eat before coming.',
  },
  'blood.donor.declined': {
    fr: 'Ganji : merci de votre réponse. Nous vous solliciterons une autre fois.',
    en: 'Ganji: thank you for your answer. We will ask you another time.',
  },
  'blood.donor.covered': {
    fr: 'Ganji : merci ! Le besoin de sang à {place} est couvert. Inutile de vous déplacer.',
    en: 'Ganji: thank you! The blood need at {place} is covered. No need to come.',
  },
  'blood.donor.gave': {
    fr: 'Ganji : merci pour votre don, {name} ! Vous avez peut-être sauvé une vie. Prochain don possible à partir du {date}.',
    en: 'Ganji: thank you for your donation, {name}! You may have saved a life. You can give again from {date}.',
  },
  // Famille : rien qui révèle un soin (ni don, ni hôpital, ni date) ; en mode discret, pas même le prénom.
  'blood.family.news': {
    fr: 'Ganji : bonne nouvelle pour {prenom}, ouvrez l’application.',
    en: 'Ganji: good news for {prenom}, open the app.',
  },
  'blood.family.news.voice': {
    fr: 'Message vocal : bonne nouvelle pour {prenom}. Ouvrez l’application Ganji.',
    en: 'Voice message: good news for {prenom}. Open the Ganji app.',
  },
  'blood.family.discreet': {
    fr: 'Ganji : vous avez un nouveau message. Ouvrez l’application.',
    en: 'Ganji: you have a new message. Open the app.',
  },
  'blood.ants.request': {
    fr: 'Ganji ANTS : nouvelle demande de {qty} poche(s) de {product} {group} à {place} ({urgency}). Ouvrez Ganji pour réserver des poches.',
    en: 'Ganji ANTS: new request for {qty} unit(s) of {product} {group} at {place} ({urgency}). Open Ganji to reserve units.',
  },
  'blood.requester.donor': {
    fr: 'Ganji : un donneur {group} a dit oui pour votre demande à {place}. Rendez-vous {when}. Suivi en direct dans Ganji.',
    en: 'Ganji: a {group} donor said yes to your request at {place}. Appointment {when}. Live follow-up in Ganji.',
  },
  'blood.requester.reserved': {
    fr: 'Ganji : {site} a réservé {n} poche(s) pour votre demande à {place}. Suivi en direct dans Ganji.',
    en: 'Ganji: {site} reserved {n} unit(s) for your request at {place}. Live follow-up in Ganji.',
  },
});

const TZ = 'Africa/Porto-Novo';

/** « lundi 12 octobre à 09:00 » dans la langue du destinataire (français par défaut). */
export function whenIn(d: Date, lang?: Lang | null) {
  return d.toLocaleString(lang === 'en' ? 'en-GB' : 'fr-FR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}

export function dayIn(d: Date, lang?: Lang | null) {
  return d.toLocaleDateString(lang === 'en' ? 'en-GB' : 'fr-FR', { timeZone: TZ, day: 'numeric', month: 'long' });
}

export const PRODUCT_LABEL: Record<string, string> = { CGR: 'globules rouges', PLAQUETTES: 'plaquettes', PLASMA: 'plasma' };
export const PRODUCT_LABEL_EN: Record<string, string> = { CGR: 'red cells', PLAQUETTES: 'platelets', PLASMA: 'plasma' };
export const URGENCY_LABEL: Record<string, string> = { VITALE: 'urgence vitale', URGENTE: 'urgente', PROGRAMMEE: 'programmée' };
export const URGENCY_LABEL_EN: Record<string, string> = { VITALE: 'life-threatening', URGENTE: 'urgent', PROGRAMMEE: 'planned' };

export function productIn(p: string, lang?: Lang | null) {
  return (lang === 'en' ? PRODUCT_LABEL_EN : PRODUCT_LABEL)[p] ?? p;
}
export function urgencyIn(u: string, lang?: Lang | null) {
  return (lang === 'en' ? URGENCY_LABEL_EN : URGENCY_LABEL)[u] ?? u;
}
