/**
 * Calendrier vaccinal de routine de l'enfant (PEV Bénin), consultations
 * prénatales (CPN) et signes de danger pendant la grossesse.
 *
 * Données de démonstration établies d'après le calendrier PEV publié et les
 * recommandations OMS ; à faire valider par l'Agence nationale des soins de
 * santé primaires (ANSSP) avant tout usage réel.
 */

export interface VaccineScheduleData {
  code: string;
  name: string;
  ageLabel: string;
  ageDays: number;
  dose: number;
  disease: string;
}

/**
 * Hépatite B à la naissance : non incluse (introduction de la dose de
 * naissance non confirmée à la date de rédaction) — l'hépatite B est couverte
 * par le vaccin pentavalent à 6, 10 et 14 semaines.
 */
export const VACCINE_SCHEDULE: VaccineScheduleData[] = [
  // Naissance
  { code: 'BCG', name: 'BCG', ageLabel: 'À la naissance', ageDays: 0, dose: 1, disease: 'Tuberculose' },
  { code: 'VPO0', name: 'Vaccin polio oral (dose zéro)', ageLabel: 'À la naissance', ageDays: 0, dose: 0, disease: 'Poliomyélite' },

  // 6 semaines
  { code: 'PENTA1', name: 'Pentavalent (DTC-HepB-Hib) 1', ageLabel: '6 semaines', ageDays: 42, dose: 1, disease: 'Diphtérie, tétanos, coqueluche, hépatite B, Haemophilus influenzae b' },
  { code: 'VPO1', name: 'Vaccin polio oral 1', ageLabel: '6 semaines', ageDays: 42, dose: 1, disease: 'Poliomyélite' },
  { code: 'PCV1', name: 'Vaccin antipneumococcique conjugué (PCV13) 1', ageLabel: '6 semaines', ageDays: 42, dose: 1, disease: 'Pneumonies et méningites à pneumocoque' },
  { code: 'ROTA1', name: 'Vaccin antirotavirus 1', ageLabel: '6 semaines', ageDays: 42, dose: 1, disease: 'Diarrhée à rotavirus' },

  // 10 semaines
  { code: 'PENTA2', name: 'Pentavalent (DTC-HepB-Hib) 2', ageLabel: '10 semaines', ageDays: 70, dose: 2, disease: 'Diphtérie, tétanos, coqueluche, hépatite B, Haemophilus influenzae b' },
  { code: 'VPO2', name: 'Vaccin polio oral 2', ageLabel: '10 semaines', ageDays: 70, dose: 2, disease: 'Poliomyélite' },
  { code: 'PCV2', name: 'Vaccin antipneumococcique conjugué (PCV13) 2', ageLabel: '10 semaines', ageDays: 70, dose: 2, disease: 'Pneumonies et méningites à pneumocoque' },
  // Nombre de doses rotavirus selon le vaccin utilisé (2 ou 3) : à confirmer.
  { code: 'ROTA2', name: 'Vaccin antirotavirus 2', ageLabel: '10 semaines', ageDays: 70, dose: 2, disease: 'Diarrhée à rotavirus' },

  // 14 semaines
  { code: 'PENTA3', name: 'Pentavalent (DTC-HepB-Hib) 3', ageLabel: '14 semaines', ageDays: 98, dose: 3, disease: 'Diphtérie, tétanos, coqueluche, hépatite B, Haemophilus influenzae b' },
  { code: 'VPO3', name: 'Vaccin polio oral 3', ageLabel: '14 semaines', ageDays: 98, dose: 3, disease: 'Poliomyélite' },
  { code: 'PCV3', name: 'Vaccin antipneumococcique conjugué (PCV13) 3', ageLabel: '14 semaines', ageDays: 98, dose: 3, disease: 'Pneumonies et méningites à pneumocoque' },
  { code: 'VPI1', name: 'Vaccin polio inactivé 1', ageLabel: '14 semaines', ageDays: 98, dose: 1, disease: 'Poliomyélite' },

  // Vaccin antipaludique : le Bénin a introduit un vaccin contre le paludisme
  // dans le PEV en 2024 (schéma à 4 doses). Âges retenus ici : 5, 6, 7 et
  // 18 mois — à confirmer selon le calendrier national en vigueur.
  { code: 'PALU1', name: 'Vaccin antipaludique 1', ageLabel: '5 mois', ageDays: 150, dose: 1, disease: 'Paludisme' },
  { code: 'PALU2', name: 'Vaccin antipaludique 2', ageLabel: '6 mois', ageDays: 180, dose: 2, disease: 'Paludisme' },
  { code: 'PALU3', name: 'Vaccin antipaludique 3', ageLabel: '7 mois', ageDays: 210, dose: 3, disease: 'Paludisme' },

  // 9 mois
  { code: 'RR1', name: 'Rougeole-Rubéole 1', ageLabel: '9 mois', ageDays: 270, dose: 1, disease: 'Rougeole, rubéole' },
  { code: 'VAA', name: 'Vaccin anti-amaril', ageLabel: '9 mois', ageDays: 270, dose: 1, disease: 'Fièvre jaune' },
  // Seconde dose de VPI recommandée par l'OMS (introduction progressive) : si applicable.
  { code: 'VPI2', name: 'Vaccin polio inactivé 2', ageLabel: '9 mois', ageDays: 270, dose: 2, disease: 'Poliomyélite' },

  // 15 mois
  { code: 'RR2', name: 'Rougeole-Rubéole 2', ageLabel: '15 mois', ageDays: 450, dose: 2, disease: 'Rougeole, rubéole' },

  // 18 mois
  { code: 'PALU4', name: 'Vaccin antipaludique 4 (rappel)', ageLabel: '18 mois', ageDays: 540, dose: 4, disease: 'Paludisme' },
];

export interface AncVisitData {
  code: 'CPN1' | 'CPN2' | 'CPN3' | 'CPN4';
  label: string;
  /** Semaines d'aménorrhée (SA) */
  weekFrom: number;
  weekTo: number;
  content: string[];
}

/**
 * Consultations prénatales recentrées (4 CPN) selon le protocole national.
 * NB : l'OMS (recommandations 2016) préconise au moins 8 contacts prénatals ;
 * l'application peut proposer des rappels intermédiaires.
 */
export const ANC_SCHEDULE: AncVisitData[] = [
  {
    code: 'CPN1',
    label: '1re consultation prénatale (idéalement au 1er trimestre)',
    weekFrom: 0,
    weekTo: 16,
    content: [
      'Confirmation de la grossesse et calcul du terme',
      'Tension artérielle, poids, taille',
      'Test VIH, syphilis',
      'Groupe sanguin et rhésus',
      'Taux d\'hémoglobine (recherche d\'anémie)',
      'Recherche de protéines et de sucre dans les urines',
      'Fer-acide folique',
      'VAT/Td (vaccin antitétanique)',
      'MILDA (moustiquaire imprégnée d\'insecticide à longue durée d\'action)',
      'Conseils : nutrition, signes de danger, plan d\'accouchement',
    ],
  },
  {
    code: 'CPN2',
    label: '2e consultation prénatale',
    weekFrom: 24,
    weekTo: 28,
    content: [
      'Tension artérielle, poids, hauteur utérine, bruits du cœur fœtal',
      'TPI (SP) à partir de 13 SA, une dose par mois',
      'Fer-acide folique',
      'VAT/Td (2e dose si nécessaire)',
      'Déparasitage (albendazole) au 2e trimestre',
      'Recherche de protéines dans les urines',
      'Rappel des signes de danger',
    ],
  },
  {
    code: 'CPN3',
    label: '3e consultation prénatale',
    weekFrom: 32,
    weekTo: 32,
    content: [
      'Tension artérielle, poids, hauteur utérine, bruits du cœur fœtal',
      'TPI (SP), dose suivante',
      'Fer-acide folique',
      'Taux d\'hémoglobine',
      'Recherche de protéines dans les urines',
      'Préparation du plan d\'accouchement et du transport',
    ],
  },
  {
    code: 'CPN4',
    label: '4e consultation prénatale',
    weekFrom: 36,
    weekTo: 36,
    content: [
      'Tension artérielle, poids, présentation du bébé',
      'TPI (SP) si dose restante',
      'Fer-acide folique',
      'Confirmation du lieu d\'accouchement et du plan d\'urgence',
      'Conseils : allaitement maternel exclusif, planification familiale, vaccination du nouveau-né',
    ],
  },
];

export interface DangerSignData {
  code: string;
  label: string;
  pictogram: string;
  urgency: 'urgence' | 'consulter';
}

export const DANGER_SIGNS_PREGNANCY: DangerSignData[] = [
  { code: 'SAIGNEMENT', label: 'Saignement par le vagin', pictogram: 'bleeding', urgency: 'urgence' },
  { code: 'CONVULSIONS', label: 'Convulsions ou perte de connaissance', pictogram: 'convulsion', urgency: 'urgence' },
  { code: 'CEPHALEES', label: 'Maux de tête violents ou vision trouble', pictogram: 'headache', urgency: 'urgence' },
  { code: 'PERTE_EAUX', label: 'Perte des eaux avant le travail', pictogram: 'water-loss', urgency: 'urgence' },
  { code: 'DOULEUR_VENTRE', label: 'Douleur forte au ventre', pictogram: 'abdominal-pain', urgency: 'urgence' },
  { code: 'BEBE_NE_BOUGE_PLUS', label: 'Le bébé ne bouge plus ou bouge beaucoup moins', pictogram: 'no-movement', urgency: 'urgence' },
  { code: 'DIFFICULTE_RESPIRER', label: 'Difficulté à respirer', pictogram: 'breathing', urgency: 'urgence' },
  { code: 'FIEVRE', label: 'Fièvre', pictogram: 'fever', urgency: 'consulter' },
  { code: 'OEDEMES', label: 'Gonflement du visage, des mains ou des pieds', pictogram: 'swelling', urgency: 'consulter' },
  { code: 'VOMISSEMENTS', label: 'Vomissements répétés, ne peut rien garder', pictogram: 'vomiting', urgency: 'consulter' },
  { code: 'BRULURES_URINAIRES', label: 'Brûlures en urinant', pictogram: 'urine', urgency: 'consulter' },
];
