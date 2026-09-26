import { defineSms } from '../types';

/** Don de sang : jamais de maladie, seulement un lieu, un groupe, une consigne. */
export const BLOOD = defineSms({
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
  // Morceaux glissés dans les textes.
  'blood.group.compatible': { fr: '{group}, compatible', en: '{group}, compatible' },
  'blood.product.CGR': { fr: 'globules rouges', en: 'red cells' },
  'blood.product.PLAQUETTES': { fr: 'plaquettes', en: 'platelets' },
  'blood.product.PLASMA': { fr: 'plasma', en: 'plasma' },
  'blood.urgency.VITALE': { fr: 'urgence vitale', en: 'life-threatening' },
  'blood.urgency.URGENTE': { fr: 'urgente', en: 'urgent' },
  'blood.urgency.PROGRAMMEE': { fr: 'programmée', en: 'planned' },
  // Notifications dans l'application.
  'blood.n.ants.title': { fr: 'Demande de sang {group} · {place}', en: 'Blood request {group} · {place}' },
  'blood.n.ants.body.one': {
    fr: '{n} poche de {product} {group}, {urgency}, avant {when}. Demandée par {requester}.',
    en: '{n} unit of {product} {group}, {urgency}, before {when}. Requested by {requester}.',
  },
  'blood.n.ants.body.other': {
    fr: '{n} poches de {product} {group}, {urgency}, avant {when}. Demandée par {requester}.',
    en: '{n} units of {product} {group}, {urgency}, before {when}. Requested by {requester}.',
  },
  'blood.n.call.title': { fr: 'Votre sang peut sauver une vie', en: 'Your blood can save a life' },
  'blood.n.call.body': {
    fr: '{place}, à {km} km : un patient a besoin de votre groupe ({group}). Répondez oui ou non.',
    en: '{place}, {km} km away: a patient needs your blood group ({group}). Answer yes or no.',
  },
  'blood.n.rdv.title': { fr: 'Merci ! Votre rendez-vous de don', en: 'Thank you! Your donation appointment' },
  'blood.n.rdv.body': {
    fr: '{when} à {place}, service de transfusion. Venez après avoir mangé, avec une pièce d’identité.',
    en: '{when} at {place}, blood transfusion unit. Eat before coming and bring an ID card.',
  },
  'blood.n.found.title': { fr: 'Donneur trouvé pour {prenom}', en: 'Donor found for {prenom}' },
  // Qui a dit oui, et comment : texte de la notification du soignant, repris pour la banque de sang.
  'blood.n.found.volunteer': {
    fr: '{donor} ({group}, {km} km) s’est proposé. Rendez-vous {when} à {place}.',
    en: '{donor} ({group}, {km} km) volunteered. Appointment {when} at {place}.',
  },
  'blood.n.found.APP': {
    fr: '{donor} ({group}, {km} km) a dit oui dans l’application. Rendez-vous {when} à {place}.',
    en: '{donor} ({group}, {km} km) said yes in the app. Appointment {when} at {place}.',
  },
  'blood.n.found.SMS': {
    fr: '{donor} ({group}, {km} km) a répondu 1 par SMS. Rendez-vous {when} à {place}.',
    en: '{donor} ({group}, {km} km) replied 1 by SMS. Appointment {when} at {place}.',
  },
  'blood.n.found.USSD': {
    fr: '{donor} ({group}, {km} km) a répondu par USSD. Rendez-vous {when} à {place}.',
    en: '{donor} ({group}, {km} km) replied by USSD. Appointment {when} at {place}.',
  },
  'blood.n.toReceive.title': { fr: 'Donneur à recevoir · {place}', en: 'Donor to receive · {place}' },
  'blood.n.toReceive.body': { fr: '{summary} Demande {group}, {product}.', en: '{summary} Request {group}, {product}.' },
  'blood.n.family.title': { fr: 'Bonne nouvelle pour {prenom}', en: 'Good news for {prenom}' },
  'blood.n.family.body': { fr: 'Un donneur a dit oui. Détails dans la page Sang.', en: 'A donor said yes. Details on the Blood page.' },
  'blood.n.family.discreet.title': { fr: 'Nouveau message', en: 'New message' },
  'blood.n.family.discreet.body': { fr: 'Ouvrez la page Sang.', en: 'Open the Blood page.' },
  'blood.n.reserved.title.one': { fr: '{n} poche réservée pour {prenom}', en: '{n} unit reserved for {prenom}' },
  'blood.n.reserved.title.other': { fr: '{n} poches réservées pour {prenom}', en: '{n} units reserved for {prenom}' },
  'blood.n.reserved.body': { fr: '{site} a mis de côté {units} ({product}).', en: '{site} set aside {units} ({product}).' },
  'blood.n.reserved.bodyCovered': {
    fr: '{site} a mis de côté {units} ({product}). Le besoin est couvert.',
    en: '{site} set aside {units} ({product}). The need is covered.',
  },
  'blood.n.thanks.title': { fr: 'Merci pour votre don !', en: 'Thank you for your donation!' },
  'blood.n.thanks.body': {
    fr: 'Vous avez peut-être sauvé une vie. Prochain don possible à partir du {date}.',
    en: 'You may have saved a life. You can give again from {date}.',
  },
});
