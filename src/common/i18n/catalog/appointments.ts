import { defineSms } from '../types';

// Jamais la spécialité ni le motif dans un SMS : un lieu, une date, une consigne.
export const APPOINTMENTS = defineSms({
  'rdv.confirmed': {
    fr: 'Ganji : votre rendez-vous est confirmé le {when} à {place}. Ouvrez Ganji pour les détails.',
    en: 'Ganji: your appointment is confirmed for {when} at {place}. Open Ganji for details.',
  },
  'rdv.confirmed.other': {
    fr: 'Ganji : le rendez-vous de {prenom} est confirmé le {when} à {place}.',
    en: "Ganji: {prenom}'s appointment is confirmed for {when} at {place}.",
  },
  'rdv.refused': {
    fr: 'Ganji : {place} ne peut pas vous recevoir à la date demandée. Ouvrez Ganji pour voir la réponse et choisir une autre date.',
    en: 'Ganji: {place} cannot see you on the requested date. Open Ganji to read the reply and choose another date.',
  },
  'rdv.refused.other': {
    fr: 'Ganji : {place} ne peut pas recevoir {prenom} à la date demandée. Ouvrez Ganji pour voir la réponse.',
    en: 'Ganji: {place} cannot see {prenom} on the requested date. Open Ganji to read the reply.',
  },
  'rdv.discreet': { fr: 'Ganji : vous avez un nouveau message. Ouvrez l’application.', en: 'Ganji: you have a new message. Open the app.' },
  // Services tels que la personne les choisit (notifications des soignants seulement, jamais par SMS).
  'rdv.service.GENERALE': { fr: 'consultation', en: 'consultation' },
  'rdv.service.PEDIATRIE': { fr: 'pédiatrie', en: 'paediatrics' },
  'rdv.service.GYNECOLOGIE': { fr: 'santé de la femme', en: "women's health" },
  'rdv.service.CARDIOLOGIE': { fr: 'cardiologie', en: 'cardiology' },
  'rdv.service.HEMATOLOGIE': { fr: 'hématologie', en: 'haematology' },
  'rdv.service.DERMATOLOGIE': { fr: 'dermatologie', en: 'dermatology' },
  'rdv.service.ONCOLOGIE': { fr: 'oncologie', en: 'oncology' },
  // Notifications dans l'application.
  'rdv.n.request.title': { fr: 'Nouvelle demande de rendez-vous', en: 'New appointment request' },
  'rdv.n.request.body': { fr: '{who} · {service} · {preferred}', en: '{who} · {service} · {preferred}' },
  'rdv.n.cancelled.title': { fr: 'Rendez-vous annulé', en: 'Appointment cancelled' },
  'rdv.n.cancelled.body': { fr: '{who} · {date}', en: '{who} · {date}' },
  'rdv.n.confirmed.title': { fr: 'Rendez-vous confirmé', en: 'Appointment confirmed' },
  'rdv.n.confirmed.body': { fr: '{place} · {when}', en: '{place} · {when}' },
  'rdv.n.confirmed.bodyAnswer': { fr: '{place} · {when} · {answer}', en: '{place} · {when} · {answer}' },
  'rdv.n.refused.title': { fr: 'Rendez-vous impossible', en: 'Appointment not possible' },
  'rdv.n.refused.body': { fr: '{place} : {answer}', en: '{place} : {answer}' },
});
