import { defineSms } from '../types';

/** Alertes des soignants (journal de symptômes, télé-expertise) : un nom, jamais le symptôme ni la discipline. */
export const CARE = defineSms({
  'care.symptomAlert': {
    fr: "Ganji : {name} a signalé un signe d'alerte. Ouvrez son carnet.",
    en: 'Ganji: {name} reported a warning sign. Open their health record.',
  },
  'care.tele.new': { fr: "Ganji : nouvelle demande d'avis de {from}.", en: 'Ganji: new request for advice from {from}.' },
  'care.tele.newUrgent': { fr: "Ganji : nouvelle demande d'avis URGENTE de {from}.", en: 'Ganji: new URGENT request for advice from {from}.' },
  'care.tele.answered': { fr: "Ganji : {name} a répondu à votre demande d'avis.", en: 'Ganji: {name} answered your request for advice.' },
  // Notifications dans l'application (cloche) des soignants.
  'care.n.symptom.title': { fr: 'Signe d’alerte signalé', en: 'Warning sign reported' },
  'care.n.symptom.body': { fr: '{name} a signalé un signe d’alerte dans son journal. Ouvrez son carnet.', en: '{name} reported a warning sign in their diary. Open their record.' },
  'care.n.tele.new.title': { fr: 'Nouvelle demande d’avis', en: 'New request for advice' },
  'care.n.tele.urgent.title': { fr: 'Demande d’avis URGENTE', en: 'URGENT request for advice' },
  'care.n.tele.new.body': { fr: '{from} demande un avis en {specialty}. Ouvrez la demande pour lire le dossier et répondre.', en: '{from} asks for advice in {specialty}. Open the request to read the record and answer.' },
  'care.n.tele.answered.title': { fr: 'Avis reçu', en: 'Advice received' },
  'care.n.tele.answered.body': { fr: '{name} a répondu à votre demande d’avis. La réponse est inscrite dans le carnet du patient.', en: '{name} answered your request for advice. The answer is in the patient’s record.' },
});
