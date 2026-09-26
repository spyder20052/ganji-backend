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
});
