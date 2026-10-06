import { defineSms } from '../types';

/** Signes de danger : les proches et le relais sont appelés à l'aide, sans que le SMS dise ni grossesse ni signe. */
export const MATERNAL = defineSms({
  'maternal.help': {
    fr: "Ganji : {prenom} a besoin d'aide maintenant. Merci de l'appeler et de l'accompagner au centre de santé le plus proche.",
    en: 'Ganji: {prenom} needs help now. Please call her and go with her to the nearest health centre.',
  },
});
