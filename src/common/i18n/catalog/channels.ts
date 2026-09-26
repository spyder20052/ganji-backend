import { defineSms } from '../types';

/**
 * Rappels par SMS, réponses automatiques aux SMS et menu USSD. La tâche planifiée peut partir plusieurs heures
 * avant : chaque rappel donne donc le jour et l'heure (« ven. 26 sept., 13:00 »), jamais « c'est l'heure ».
 * Mode discret (téléphone partagé) : ni prénom, ni nature du soin, ni lieu.
 */
export const CHANNELS = defineSms({
  'rappel.discret.prise': { fr: 'Ganji : rappel {quand}. Répondez 1 quand c’est fait.', en: 'Ganji: reminder {quand}. Reply 1 when done.' },
  'rappel.discret.rdv': { fr: 'Ganji : vous avez un rendez-vous {quand}. Répondez 1 pour confirmer.', en: 'Ganji: you have an appointment {quand}. Reply 1 to confirm.' },
  'rappel.cpn': { fr: 'Ganji : {prenom}, consultation prénatale {quand}{lieu}. Répondez 1 pour confirmer.', en: 'Ganji: {prenom}, antenatal visit {quand}{lieu}. Reply 1 to confirm.' },
  'rappel.vaccin': { fr: 'Ganji : vaccin de votre enfant {quand}{lieu}. Apportez le carnet. Répondez 1 pour confirmer.', en: 'Ganji: your child’s vaccine {quand}{lieu}. Bring the health book. Reply 1 to confirm.' },
  'rappel.prise': { fr: 'Ganji : {prenom}, prise de votre traitement {quand}. Répondez 1 quand c’est fait.', en: 'Ganji: {prenom}, time for your treatment {quand}. Reply 1 when done.' },
  'rappel.analyse': { fr: 'Ganji : {prenom}, analyse {quand}{lieu}. Répondez 1 pour confirmer.', en: 'Ganji: {prenom}, lab test {quand}{lieu}. Reply 1 to confirm.' },
  'rappel.rdv': { fr: 'Ganji : {prenom}, rendez-vous {quand}{lieu}. Répondez 1 pour confirmer.', en: 'Ganji: {prenom}, appointment {quand}{lieu}. Reply 1 to confirm.' },
  /** Message vocal : le texte lu par la voix, dans la langue de la personne. */
  'voice.message': { fr: 'Message vocal ({lang}) : {text}', en: 'Voice message ({lang}): {text}' },

  // Réponses automatiques aux SMS entrants.
  'sms.reply.confirmed': { fr: 'Ganji : merci, votre confirmation est bien enregistrée.', en: 'Ganji: thank you, your confirmation has been recorded.' },
  'sms.reply.nothing': {
    fr: 'Ganji : aucune demande en attente pour ce numéro. Tapez RDV pour votre prochain rendez-vous.',
    en: 'Ganji: nothing is pending for this number. Send RDV for your next appointment.',
  },
  'sms.reply.stop': {
    fr: 'Ganji : vous ne recevrez plus d’appels au don. Envoyez DON pour vous réinscrire.',
    en: 'Ganji: you will no longer receive blood donation calls. Send DON to sign up again.',
  },
  'sms.reply.don': {
    fr: 'Ganji : merci ! Vous êtes de nouveau disponible pour les appels au don.',
    en: 'Ganji: thank you! You are available for blood donation calls again.',
  },
  'sms.reply.help': {
    fr: 'Ganji : commandes possibles : 1 (oui), 2 (non), RDV, DON, STOP. Pour une urgence, appelez le 118.',
    en: 'Ganji: possible commands: 1 (yes), 2 (no), RDV, DON, STOP. In an emergency, call 118.',
  },
  'sms.rdv.noRecord': { fr: 'Ganji : aucun carnet lié à ce numéro.', en: 'Ganji: no health record is linked to this number.' },
  'sms.rdv.next': { fr: 'Ganji : prochain rendez-vous {when}.', en: 'Ganji: next appointment {when}.' },
  'sms.rdv.nextAt': { fr: 'Ganji : prochain rendez-vous {when} à {place}.', en: 'Ganji: next appointment {when} at {place}.' },
  'sms.rdv.none': { fr: 'Ganji : aucun rendez-vous prévu.', en: 'Ganji: no appointment planned.' },

  // Menu USSD *229*25# (le code ajoute CON ou END devant le texte).
  'ussd.menu': {
    fr: 'Ganji\n1. Mon prochain RDV\n2. Répondre à un appel au don\n3. Pharmacie de garde\n4. Urgence',
    en: 'Ganji\n1. My next appointment\n2. Answer a blood donation call\n3. Pharmacy on duty\n4. Emergency',
  },
  'ussd.don.none': { fr: 'Aucun appel au don en attente.', en: 'No blood donation call pending.' },
  'ussd.don.ask': {
    fr: 'Don de sang à {place}\n1. Oui, je viens\n2. Non, pas cette fois',
    en: 'Blood donation at {place}\n1. Yes, I am coming\n2. No, not this time',
  },
  'ussd.don.thanksRdv': { fr: 'Merci ! RDV {when}.', en: 'Thank you! Appointment {when}.' },
  'ussd.don.thanks': { fr: 'Merci pour votre réponse.', en: 'Thank you for your answer.' },
  'ussd.pharmacies': { fr: 'Pharmacies de garde :\n{list}', en: 'Pharmacies on duty:\n{list}' },
  'ussd.emergency': {
    fr: 'Urgence : appelez le 118 (pompiers). Allez à l’hôpital le plus proche. Montrez votre carte QR Ganji.',
    en: 'Emergency: call 118 (fire brigade). Go to the nearest hospital. Show your Ganji QR card.',
  },
});
