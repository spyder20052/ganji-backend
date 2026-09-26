import { defineSms } from '../types';

export const LISTEN = defineSms({
  // SMS : neutre, rien sur l'écoute ni sur ce qui a été écrit.
  'listen.reply': { fr: "Ganji : vous avez un nouveau message dans l'application.", en: 'Ganji: you have a new message in the app.' },
  // Notifications dans l'application (personne qui écrit).
  'listen.n.reply.title': { fr: 'Nouveau message', en: 'New message' },
  'listen.n.reply.body': { fr: 'L’écoute vous a répondu. Ouvrez la conversation.', en: 'The listening line has replied. Open the conversation.' },
  'listen.n.closed.title': { fr: 'Conversation close', en: 'Conversation closed' },
  'listen.n.closed.body': { fr: 'L’écoutante a clos la conversation. Vous pouvez en ouvrir une autre à tout moment.', en: 'The listener closed the conversation. You can open a new one at any time.' },
  // Notifications de la cellule d'écoute.
  'listen.n.urgent.title': { fr: 'Écoute : détresse signalée', en: 'Listening line: distress detected' },
  'listen.n.urgent.body': { fr: 'Une personne a écrit des mots de détresse. Répondez en priorité.', en: 'Someone wrote words of distress. Reply first.' },
  'listen.n.new.title': { fr: 'Écoute : nouvelle conversation', en: 'Listening line: new conversation' },
  'listen.n.new.body': { fr: 'Une personne attend une réponse.', en: 'Someone is waiting for a reply.' },
  'listen.n.message.title': { fr: 'Écoute : nouveau message', en: 'Listening line: new message' },
  'listen.n.message.body': { fr: 'La personne que vous accompagnez a écrit.', en: 'The person you are supporting has written.' },
  'listen.n.callback.title': { fr: 'Écoute : rappel demandé', en: 'Listening line: call-back requested' },
  'listen.n.callback.body': { fr: 'Une personne demande à être rappelée.', en: 'Someone asked to be called back.' },
});
