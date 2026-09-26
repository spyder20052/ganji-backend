import { defineSms } from '../types';

export const CIRCLE = defineSms({
  // SMS : neutres (ni traitement ni rendez-vous), un prénom au plus, rien en mode discret.
  'circle.sms.missed': {
    fr: 'Ganji : {name} n’a pas confirmé un rappel. Prenez de ses nouvelles. Répondez 1 si c’est fait.',
    en: 'Ganji: {name} has not confirmed a reminder. Please check on them. Reply 1 if it is done.',
  },
  'circle.sms.missed.discreet': {
    fr: 'Ganji : un rappel de votre proche n’a pas été confirmé. Prenez de ses nouvelles. Répondez 1 si c’est fait.',
    en: 'Ganji: a reminder for your relative has not been confirmed. Please check on them. Reply 1 if it is done.',
  },
  'circle.sms.visit': {
    fr: 'Ganji : une visite à domicile vous est demandée. Ouvrez l’application Ganji pour voir où et quand.',
    en: 'Ganji: a home visit is requested. Open the Ganji app to see where and when.',
  },
  'circle.sms.visitDone': { fr: 'Ganji : le relais est passé voir {name}. Détails dans l’application.', en: 'Ganji: the community relay visited {name}. Details in the app.' },
  'circle.sms.visitDone.discreet': {
    fr: 'Ganji : le relais est passé voir votre proche. Détails dans l’application.',
    en: 'Ganji: the community relay visited your relative. Details in the app.',
  },
  // Notifications dans l'application.
  'circle.n.missed.title': { fr: 'Rappel sans réponse', en: 'Unanswered reminder' },
  'circle.n.missed.body': {
    fr: '{name} n’a pas confirmé un rappel depuis 2 h. Prenez de ses nouvelles.',
    en: '{name} has not confirmed a reminder for 2 hours. Please check on them.',
  },
  'circle.n.self.body': {
    fr: 'Touchez « C’est fait » si c’est fait. Votre cercle de soins est prévenu.',
    en: 'Tap “Done” if it is done. Your circle of care has been told.',
  },
  'circle.n.visit.title': { fr: 'Visite à faire', en: 'Home visit to do' },
  'circle.n.visit.body': { fr: '{name}, {commune} : passer prendre des nouvelles.', en: '{name}, {commune}: drop by to check on them.' },
  'circle.n.visitPlanned.title': { fr: 'Visite du relais', en: 'Community relay visit' },
  'circle.n.visitPlanned.body': { fr: '{relay} passera prendre de vos nouvelles.', en: '{relay} will drop by to check on you.' },
  'circle.n.visitDone.title': { fr: 'Visite faite', en: 'Visit done' },
  'circle.n.visitDone.body': { fr: '{relay} est passé prendre de vos nouvelles.', en: '{relay} dropped by to check on you.' },
  'circle.n.visitDoneCg.body': { fr: '{relay} est passé voir {name}.', en: '{relay} visited {name}.' },
  'circle.n.done.title': { fr: 'C’est fait', en: 'Done' },
  'circle.n.done.body': { fr: '{name} a confirmé son rappel.', en: '{name} confirmed the reminder.' },
  'circle.n.visitCancelled.title': { fr: 'Visite annulée', en: 'Visit cancelled' },
  'circle.n.visitCancelled.body': {
    fr: '{name} a confirmé son rappel : la visite n’est plus nécessaire.',
    en: '{name} confirmed the reminder: the visit is no longer needed.',
  },
  'circle.n.visitCancelled.answered': {
    fr: '{name} a répondu à son rappel : la visite n’est plus nécessaire.',
    en: '{name} answered the reminder: the visit is no longer needed.',
  },
});
