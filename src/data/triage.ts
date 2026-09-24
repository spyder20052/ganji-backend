/**
 * Arbre de démonstration, à valider et dater par des médecins référents avant
 * tout usage réel. Ne remplace pas un diagnostic.
 *
 * Orientation (où aller, avec quelle urgence) — jamais un diagnostic.
 * Inspiré des signes généraux de danger de la PCIME (OMS/UNICEF) et de la
 * logique d'orientation NHS 111, adapté au contexte béninois (paludisme,
 * fièvre de l'enfant, grossesse).
 *
 * Règles :
 * - tout signe de danger → URGENCE ;
 * - fièvre sans signe de danger → CENTRE_SANTE + flag TDR_PALU (test de
 *   diagnostic rapide du paludisme) ;
 * - au plus 4 questions par parcours.
 */

export type TriageOutcome = 'MAISON' | 'PHARMACIE' | 'CENTRE_SANTE' | 'URGENCE';

export interface TriageAnswer {
  label: string;
  pictogram: string;
  next?: string;
  outcome?: TriageOutcome;
  flags?: string[];
}

export interface TriageQuestion {
  id: string;
  text: string;
  pictogram: string;
  audioKey: string;
  answers: TriageAnswer[];
}

export const TRIAGE_START = 'who';

export const TRIAGE_TREE: Record<string, TriageQuestion> = {
  who: {
    id: 'who',
    text: 'Qui est malade ?',
    pictogram: 'people',
    audioKey: 'triage.who',
    answers: [
      { label: 'Un enfant de moins de 5 ans', pictogram: 'child', next: 'child_danger', flags: ['ENFANT_MOINS_5'] },
      { label: 'Un adulte ou un enfant de plus de 5 ans', pictogram: 'adult', next: 'adult_danger' },
      { label: 'Une femme enceinte', pictogram: 'pregnant', next: 'preg_danger', flags: ['GROSSESSE'] },
      { label: 'Une personne âgée', pictogram: 'elderly', next: 'adult_danger', flags: ['PERSONNE_AGEE'] },
    ],
  },

  // ─────────── Enfant de moins de 5 ans (signes généraux de danger PCIME) ───────────
  child_danger: {
    id: 'child_danger',
    text: "L'enfant a-t-il un de ces signes ?",
    pictogram: 'warning',
    audioKey: 'triage.child_danger',
    answers: [
      { label: 'Convulsions (il tremble, se raidit)', pictogram: 'convulsion', outcome: 'URGENCE', flags: ['CONVULSIONS'] },
      { label: 'Ne peut pas boire ni téter', pictogram: 'no-drink', outcome: 'URGENCE', flags: ['NE_PEUT_PAS_BOIRE'] },
      { label: 'Très endormi, difficile à réveiller ou inconscient', pictogram: 'lethargy', outcome: 'URGENCE', flags: ['LETHARGIE'] },
      { label: 'Vomit tout ce qu\'il avale', pictogram: 'vomiting', outcome: 'URGENCE', flags: ['VOMIT_TOUT'] },
      { label: 'Respire très vite ou avec difficulté (ventre qui se creuse)', pictogram: 'breathing', outcome: 'URGENCE', flags: ['DETRESSE_RESPIRATOIRE'] },
      { label: 'Aucun de ces signes', pictogram: 'check', next: 'child_symptom' },
    ],
  },

  child_symptom: {
    id: 'child_symptom',
    text: 'Quel est le problème principal ?',
    pictogram: 'question',
    audioKey: 'triage.child_symptom',
    answers: [
      { label: 'Fièvre (corps chaud)', pictogram: 'fever', next: 'child_fever' },
      { label: 'Diarrhée', pictogram: 'diarrhea', next: 'child_diarrhea' },
      { label: 'Toux', pictogram: 'cough', next: 'child_cough' },
      { label: 'Blessure ou brûlure', pictogram: 'injury', next: 'injury' },
      { label: 'Autre problème', pictogram: 'other', outcome: 'CENTRE_SANTE' },
    ],
  },

  child_fever: {
    id: 'child_fever',
    text: 'Depuis combien de temps et avec quels signes ?',
    pictogram: 'fever',
    audioKey: 'triage.child_fever',
    answers: [
      { label: 'Cou raide (ne peut pas baisser la tête)', pictogram: 'stiff-neck', outcome: 'URGENCE', flags: ['RAIDEUR_NUQUE'] },
      { label: 'Fièvre depuis plus de 2 jours', pictogram: 'calendar', outcome: 'URGENCE', flags: ['FIEVRE_PROLONGEE', 'TDR_PALU'] },
      { label: 'Fièvre depuis moins de 2 jours, l\'enfant joue et boit', pictogram: 'fever', outcome: 'CENTRE_SANTE', flags: ['TDR_PALU'] },
    ],
  },

  child_diarrhea: {
    id: 'child_diarrhea',
    text: 'Comment est la diarrhée ?',
    pictogram: 'diarrhea',
    audioKey: 'triage.child_diarrhea',
    answers: [
      { label: 'Il y a du sang dans les selles', pictogram: 'blood-stool', outcome: 'URGENCE', flags: ['SANG_SELLES'] },
      { label: 'Yeux enfoncés, peau qui reste plissée quand on la pince', pictogram: 'dehydration', outcome: 'URGENCE', flags: ['DESHYDRATATION'] },
      { label: 'Diarrhée depuis 14 jours ou plus', pictogram: 'calendar', outcome: 'CENTRE_SANTE', flags: ['DIARRHEE_PERSISTANTE'] },
      { label: 'Diarrhée simple, l\'enfant boit bien', pictogram: 'ors', outcome: 'PHARMACIE', flags: ['SRO_ZINC'] },
    ],
  },

  child_cough: {
    id: 'child_cough',
    text: 'Comment est la toux ?',
    pictogram: 'cough',
    audioKey: 'triage.child_cough',
    answers: [
      { label: 'Respiration rapide ou sifflante', pictogram: 'breathing', outcome: 'URGENCE', flags: ['DETRESSE_RESPIRATOIRE'] },
      { label: 'Toux avec fièvre', pictogram: 'fever', outcome: 'CENTRE_SANTE', flags: ['TDR_PALU'] },
      { label: 'Toux depuis 14 jours ou plus', pictogram: 'calendar', outcome: 'CENTRE_SANTE', flags: ['TOUX_CHRONIQUE'] },
      { label: 'Simple rhume, respire normalement', pictogram: 'check', outcome: 'MAISON' },
    ],
  },

  // ─────────── Adulte / personne âgée ───────────
  adult_danger: {
    id: 'adult_danger',
    text: 'La personne a-t-elle un de ces signes ?',
    pictogram: 'warning',
    audioKey: 'triage.adult_danger',
    answers: [
      { label: 'Convulsions ou perte de connaissance', pictogram: 'convulsion', outcome: 'URGENCE', flags: ['CONVULSIONS'] },
      { label: 'Difficulté à respirer', pictogram: 'breathing', outcome: 'URGENCE', flags: ['DETRESSE_RESPIRATOIRE'] },
      { label: 'Saignement abondant qui ne s\'arrête pas', pictogram: 'bleeding', outcome: 'URGENCE', flags: ['HEMORRAGIE'] },
      { label: 'Douleur forte dans la poitrine', pictogram: 'chest-pain', outcome: 'URGENCE', flags: ['DOULEUR_THORACIQUE'] },
      { label: 'Bouche déviée, bras ou jambe faible, parole difficile', pictogram: 'stroke', outcome: 'URGENCE', flags: ['AVC_SUSPECT'] },
      { label: 'Aucun de ces signes', pictogram: 'check', next: 'adult_symptom' },
    ],
  },

  adult_symptom: {
    id: 'adult_symptom',
    text: 'Quel est le problème principal ?',
    pictogram: 'question',
    audioKey: 'triage.adult_symptom',
    answers: [
      { label: 'Fièvre', pictogram: 'fever', next: 'adult_fever' },
      { label: 'Diarrhée', pictogram: 'diarrhea', next: 'adult_diarrhea' },
      { label: 'Toux ou gêne pour respirer', pictogram: 'cough', next: 'adult_cough' },
      { label: 'Saignement', pictogram: 'bleeding', next: 'bleeding' },
      { label: 'Douleur', pictogram: 'pain', next: 'pain' },
      { label: 'Blessure ou brûlure', pictogram: 'injury', next: 'injury' },
      { label: 'Tristesse, angoisse, grande détresse', pictogram: 'mind', next: 'mental' },
    ],
  },

  adult_fever: {
    id: 'adult_fever',
    text: 'Avec la fièvre, y a-t-il un de ces signes ?',
    pictogram: 'fever',
    audioKey: 'triage.adult_fever',
    answers: [
      { label: 'Cou raide ou confusion (ne répond pas bien)', pictogram: 'stiff-neck', outcome: 'URGENCE', flags: ['RAIDEUR_NUQUE'] },
      { label: 'Vomit tout, ne peut rien garder', pictogram: 'vomiting', outcome: 'URGENCE', flags: ['VOMIT_TOUT'] },
      { label: 'Yeux ou peau jaunes, urines très foncées', pictogram: 'jaundice', outcome: 'URGENCE', flags: ['ICTERE'] },
      { label: 'Non, seulement la fièvre (avec ou sans maux de tête)', pictogram: 'fever', outcome: 'CENTRE_SANTE', flags: ['TDR_PALU'] },
    ],
  },

  adult_diarrhea: {
    id: 'adult_diarrhea',
    text: 'Comment est la diarrhée ?',
    pictogram: 'diarrhea',
    audioKey: 'triage.adult_diarrhea',
    answers: [
      { label: 'Il y a du sang dans les selles', pictogram: 'blood-stool', outcome: 'URGENCE', flags: ['SANG_SELLES'] },
      { label: 'Très nombreuses selles liquides, grande soif, vertiges', pictogram: 'dehydration', outcome: 'URGENCE', flags: ['DESHYDRATATION'] },
      { label: 'Diarrhée depuis plus de 3 jours', pictogram: 'calendar', outcome: 'CENTRE_SANTE' },
      { label: 'Diarrhée simple', pictogram: 'ors', outcome: 'PHARMACIE', flags: ['SRO'] },
    ],
  },

  adult_cough: {
    id: 'adult_cough',
    text: 'Comment est la toux ?',
    pictogram: 'cough',
    audioKey: 'triage.adult_cough',
    answers: [
      { label: 'Crache du sang', pictogram: 'blood-cough', outcome: 'CENTRE_SANTE', flags: ['HEMOPTYSIE', 'DEPISTAGE_TB'] },
      { label: 'Toux depuis 2 semaines ou plus, amaigrissement, sueurs la nuit', pictogram: 'calendar', outcome: 'CENTRE_SANTE', flags: ['DEPISTAGE_TB'] },
      { label: 'Toux avec fièvre', pictogram: 'fever', outcome: 'CENTRE_SANTE', flags: ['TDR_PALU'] },
      { label: 'Toux légère ou rhume', pictogram: 'check', outcome: 'PHARMACIE' },
    ],
  },

  bleeding: {
    id: 'bleeding',
    text: "D'où vient le saignement ?",
    pictogram: 'bleeding',
    audioKey: 'triage.bleeding',
    answers: [
      { label: 'Vomit du sang ou selles noires', pictogram: 'blood-vomit', outcome: 'URGENCE', flags: ['HEMORRAGIE_DIGESTIVE'] },
      { label: 'Saignement du nez qui ne s\'arrête pas après 20 minutes', pictogram: 'nose', outcome: 'URGENCE', flags: ['EPISTAXIS'] },
      { label: 'Saignement vaginal en dehors des règles', pictogram: 'bleeding', outcome: 'CENTRE_SANTE', flags: ['GYNECO'] },
      { label: 'Petite coupure ou saignement du nez qui s\'arrête', pictogram: 'bandage', outcome: 'MAISON' },
    ],
  },

  pain: {
    id: 'pain',
    text: 'Où et comment est la douleur ?',
    pictogram: 'pain',
    audioKey: 'triage.pain',
    answers: [
      { label: 'Douleur très forte au ventre, ventre dur', pictogram: 'abdominal-pain', outcome: 'URGENCE', flags: ['ABDOMEN_AIGU'] },
      { label: 'Crise douloureuse chez une personne drépanocytaire', pictogram: 'sickle-cell', outcome: 'URGENCE', flags: ['CRISE_DREPANOCYTAIRE'] },
      { label: 'Douleur qui dure depuis plus de 3 jours', pictogram: 'calendar', outcome: 'CENTRE_SANTE' },
      { label: 'Douleur modérée (tête, dos, dents, règles)', pictogram: 'pill', outcome: 'PHARMACIE' },
    ],
  },

  injury: {
    id: 'injury',
    text: 'Comment est la blessure ?',
    pictogram: 'injury',
    audioKey: 'triage.injury',
    answers: [
      { label: 'Choc à la tête, os cassé ou plaie profonde', pictogram: 'fracture', outcome: 'URGENCE', flags: ['TRAUMATISME'] },
      { label: 'Brûlure large, au visage ou aux mains', pictogram: 'burn', outcome: 'URGENCE', flags: ['BRULURE_GRAVE'] },
      { label: 'Morsure d\'animal (chien, serpent)', pictogram: 'bite', outcome: 'URGENCE', flags: ['MORSURE'] },
      { label: 'Petite plaie ou petite brûlure', pictogram: 'bandage', outcome: 'PHARMACIE', flags: ['PANSEMENT'] },
    ],
  },

  mental: {
    id: 'mental',
    text: 'Comment vous sentez-vous ?',
    pictogram: 'mind',
    audioKey: 'triage.mental',
    answers: [
      { label: 'J\'ai des idées de me faire du mal ou de mourir', pictogram: 'crisis', outcome: 'URGENCE', flags: ['CRISE', 'ECOUTE'] },
      { label: 'Tristesse, peur ou angoisse depuis plusieurs semaines', pictogram: 'sad', outcome: 'CENTRE_SANTE', flags: ['ECOUTE'] },
      { label: 'Stress passager, besoin de parler', pictogram: 'talk', outcome: 'CENTRE_SANTE', flags: ['ECOUTE'] },
    ],
  },

  // ─────────── Femme enceinte ───────────
  preg_danger: {
    id: 'preg_danger',
    text: 'Avez-vous un de ces signes ?',
    pictogram: 'pregnant',
    audioKey: 'triage.preg_danger',
    answers: [
      { label: 'Saignement par le vagin', pictogram: 'bleeding', outcome: 'URGENCE', flags: ['SAIGNEMENT_GROSSESSE'] },
      { label: 'Convulsions, maux de tête violents ou vision trouble', pictogram: 'headache', outcome: 'URGENCE', flags: ['PRE_ECLAMPSIE'] },
      { label: 'Perte des eaux ou douleur forte au ventre', pictogram: 'water-loss', outcome: 'URGENCE', flags: ['TRAVAIL_OU_RUPTURE'] },
      { label: 'Le bébé ne bouge plus', pictogram: 'no-movement', outcome: 'URGENCE', flags: ['MOUVEMENTS_FOETAUX'] },
      { label: 'Aucun de ces signes', pictogram: 'check', next: 'preg_other' },
    ],
  },

  preg_other: {
    id: 'preg_other',
    text: 'Quel est votre souci ?',
    pictogram: 'pregnant',
    audioKey: 'triage.preg_other',
    answers: [
      { label: 'Fièvre', pictogram: 'fever', outcome: 'CENTRE_SANTE', flags: ['TDR_PALU', 'GROSSESSE'] },
      { label: 'Gonflement du visage ou des mains', pictogram: 'swelling', outcome: 'CENTRE_SANTE', flags: ['TENSION_ARTERIELLE'] },
      { label: 'Brûlures en urinant, pertes anormales', pictogram: 'urine', outcome: 'CENTRE_SANTE' },
      { label: 'Nausées, fatigue légère, ou je veux faire ma CPN', pictogram: 'calendar', outcome: 'CENTRE_SANTE', flags: ['CPN'] },
    ],
  },
};

export const TRIAGE_ADVICE: Record<TriageOutcome, { title: string; advice: string[]; serviceNeeded?: string }> = {
  MAISON: {
    title: 'Soins à la maison',
    advice: [
      'Reposez-vous et buvez souvent de l\'eau propre.',
      'Pour un enfant : continuez l\'allaitement et les repas.',
      'En cas de diarrhée, donnez des SRO (sels de réhydratation orale).',
      'Dormez sous une moustiquaire imprégnée.',
      'Revenez vers un centre de santé si un signe de danger apparaît ou si cela ne va pas mieux dans 2 jours.',
    ],
  },
  PHARMACIE: {
    title: 'Conseil en pharmacie',
    advice: [
      'Allez dans une pharmacie proche ou de garde et expliquez les signes.',
      'Pour une diarrhée d\'enfant : SRO et zinc pendant 10 jours.',
      'Ne prenez pas d\'antibiotique sans ordonnance.',
      'Suivez les doses indiquées, ne dépassez pas la dose de paracétamol.',
      'Si la fièvre apparaît ou si cela ne va pas mieux, allez au centre de santé.',
    ],
  },
  CENTRE_SANTE: {
    title: 'Consultez un centre de santé aujourd\'hui',
    advice: [
      'Allez au centre de santé le plus proche aujourd\'hui, sans attendre plusieurs jours.',
      'En cas de fièvre, demandez le test rapide du paludisme (TDR) : il est souvent gratuit pour les enfants de moins de 5 ans et les femmes enceintes dans les formations sanitaires publiques.',
      'Ne prenez pas de médicament contre le paludisme sans test.',
      'Apportez votre carnet de santé et la liste de vos médicaments.',
      'Si un signe de danger apparaît en chemin, allez directement aux urgences.',
    ],
    serviceNeeded: 'consultation',
  },
  URGENCE: {
    title: 'Urgence : partez maintenant',
    advice: [
      'Rendez-vous immédiatement aux urgences de l\'hôpital le plus proche.',
      'Si la personne ne peut pas être transportée, appelez les secours (sapeurs-pompiers : 118).',
      'Ne donnez rien à boire ni à manger à une personne inconsciente ou qui convulse ; couchez-la sur le côté.',
      'Pour un enfant qui peut boire : continuez à le faire boire ou téter pendant le trajet.',
      'Emportez le carnet de santé et les médicaments déjà pris.',
    ],
    serviceNeeded: 'urgences',
  },
};
