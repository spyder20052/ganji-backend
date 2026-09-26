import { defineSms } from '../types';

export const AUTH = defineSms({
  'auth.otp': {
    fr: 'Ganji : votre code de connexion est {code}. Il expire dans 5 minutes. Ne le communiquez à personne.',
    en: 'Ganji: your login code is {code}. It expires in 5 minutes. Do not share it with anyone.',
  },
  'auth.newLogin': {
    fr: "Ganji : nouvelle connexion à votre compte. Si ce n'est pas vous, appelez le relais de votre commune.",
    en: 'Ganji: new login to your account. If this was not you, call the community relay of your area.',
  },
});
