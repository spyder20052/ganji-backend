import { defineSms } from '../types';

export const RIGHTS = defineSms({
  'rights.payment': {
    fr: 'Ganji : paiement de {amount} FCFA reçu. Reçu n° {receipt}. Détails dans l’application.',
    en: 'Ganji: payment of {amount} FCFA received. Receipt no. {receipt}. Details in the app.',
  },
  // Notifications dans l'application.
  'rights.n.coverage.title': { fr: 'Couverture vérifiée', en: 'Coverage verified' },
  'rights.n.coverage.body': { fr: '{scheme} : {rate} % de vos soins pris en charge.', en: '{scheme}: {rate}% of your care covered.' },
  'rights.n.payment.title': { fr: 'Paiement reçu', en: 'Payment received' },
  'rights.n.payment.body': { fr: '{amount} FCFA · {label} · reçu {receipt}', en: '{amount} FCFA · {label} · receipt {receipt}' },
});
