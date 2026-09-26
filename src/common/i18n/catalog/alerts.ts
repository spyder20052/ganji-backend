import { defineSms } from '../types';

export const ALERTS = defineSms({
  /** Alerte du ministère diffusée par SMS : titre et message tels que rédigés par le ministère. */
  'alerts.broadcast': { fr: 'Ganji · {title} : {message}', en: 'Ganji · {title}: {message}' },
  'alerts.cluster.title': { fr: 'Regroupement de cas : {syndrome} à {commune}', en: 'Case cluster: {syndrome} in {commune}' },
  'alerts.cluster.sms': { fr: 'Ganji surveillance : {title}. Voir le tableau de bord.', en: 'Ganji surveillance: {title}. See the dashboard.' },
  'alerts.syndrome.DIARRHEE': { fr: 'diarrhées aiguës', en: 'acute diarrhoea' },
  'alerts.syndrome.FIEVRE_ERUPTION': { fr: 'fièvre avec éruption', en: 'fever with rash' },
  'alerts.syndrome.TOUX': { fr: 'toux et fièvre', en: 'cough and fever' },
  'alerts.syndrome.PARALYSIE': { fr: 'paralysie soudaine', en: 'sudden paralysis' },
  'alerts.syndrome.FIEVRE_HEMORRAGIQUE': { fr: 'fièvre avec saignements', en: 'fever with bleeding' },
  'alerts.syndrome.DECES_INEXPLIQUE': { fr: 'décès inexpliqué', en: 'unexplained death' },
});
