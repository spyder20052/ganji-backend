/**
 * Formations sanitaires de démonstration.
 *
 * Noms et communes réels ; positions approximatives à affiner par import
 * Healthsites/OSM (scripts/import-healthsites.ts).
 *
 * - Les numéros de téléphone sont volontairement omis (renumérotation à
 *   10 chiffres de 2024 : à renseigner depuis l'annuaire officiel).
 * - Les pharmacies n'ont pas de champ « de garde » : le tour de garde est
 *   simulé ailleurs (service pharmacies).
 * - Les noms de pharmacies du type « Pharmacie du marché de X » sont des
 *   libellés descriptifs de démonstration, pas des enseignes vérifiées.
 */

export type FacilityType =
  | 'CHU'
  | 'CHD'
  | 'HZ'
  | 'CS'
  | 'CLINIQUE'
  | 'CONFESSIONNEL'
  | 'PSYCHIATRIE'
  | 'TRANSFUSION'
  | 'PHARMACIE';

export type FacilityService =
  | 'urgences'
  | 'maternite'
  | 'pediatrie'
  | 'hematologie'
  | 'oncologie'
  | 'chirurgie'
  | 'medecine'
  | 'laboratoire'
  | 'radiologie'
  | 'psychiatrie'
  | 'transfusion'
  | 'vaccination'
  | 'consultation';

export interface FacilityData {
  name: string;
  shortName?: string;
  type: FacilityType;
  /** Nom exact d'une commune de COMMUNES (geo.ts) */
  commune: string;
  lat: number;
  lng: number;
  services: FacilityService[];
  open24h: boolean;
  phone?: string;
}

const HOPITAL_COMPLET: FacilityService[] = [
  'urgences', 'maternite', 'pediatrie', 'chirurgie', 'medecine',
  'laboratoire', 'radiologie', 'transfusion', 'vaccination', 'consultation',
];

const HOPITAL_ZONE: FacilityService[] = [
  'urgences', 'maternite', 'pediatrie', 'chirurgie', 'medecine',
  'laboratoire', 'transfusion', 'vaccination', 'consultation',
];

export const FACILITIES: FacilityData[] = [
  // ───────────── Centres hospitaliers universitaires (niveau national) ─────────────
  {
    name: 'Centre National Hospitalier et Universitaire Hubert Koutoukou Maga',
    shortName: 'CNHU-HKM',
    type: 'CHU', commune: 'Cotonou', lat: 6.36, lng: 2.412,
    services: [...HOPITAL_COMPLET, 'hematologie', 'oncologie', 'psychiatrie'],
    open24h: true,
  },
  {
    name: "Centre Hospitalier Universitaire de la Mère et de l'Enfant Lagune",
    shortName: 'CHU-MEL (ex-HOMEL)',
    type: 'CHU', commune: 'Cotonou', lat: 6.354, lng: 2.434,
    services: ['urgences', 'maternite', 'pediatrie', 'chirurgie', 'laboratoire', 'radiologie', 'transfusion', 'vaccination', 'consultation'],
    open24h: true,
  },
  {
    name: 'Centre Hospitalier Universitaire de Zone d\'Abomey-Calavi / Sô-Ava',
    shortName: 'CHUZ-AS',
    type: 'CHU', commune: 'Abomey-Calavi', lat: 6.448, lng: 2.345,
    services: HOPITAL_ZONE,
    open24h: true,
  },
  {
    name: "Hôpital d'Instruction des Armées – CHU de Cotonou",
    shortName: 'HIA-CHU Cotonou',
    type: 'CHU', commune: 'Cotonou', lat: 6.362, lng: 2.405,
    services: ['urgences', 'chirurgie', 'medecine', 'laboratoire', 'radiologie', 'consultation'],
    open24h: true,
  },
  {
    name: 'Centre National Hospitalier Universitaire de Psychiatrie de Jacquot',
    shortName: 'CNHU-Psychiatrie Jacquot',
    type: 'PSYCHIATRIE', commune: 'Cotonou', lat: 6.375, lng: 2.388,
    services: ['psychiatrie', 'consultation', 'urgences'],
    open24h: true,
  },

  // ───────────── Centres hospitaliers départementaux ─────────────
  {
    name: 'Centre Hospitalier Universitaire Départemental Ouémé-Plateau',
    shortName: 'CHUD-OP',
    type: 'CHD', commune: 'Porto-Novo', lat: 6.492, lng: 2.61,
    services: [...HOPITAL_COMPLET, 'hematologie'],
    open24h: true,
  },
  {
    name: 'Centre Hospitalier Universitaire Départemental Borgou-Alibori',
    shortName: 'CHUD-BA',
    type: 'CHD', commune: 'Parakou', lat: 9.35, lng: 2.612,
    services: [...HOPITAL_COMPLET, 'hematologie', 'psychiatrie'],
    open24h: true,
  },
  {
    name: 'Centre Hospitalier Départemental Zou-Collines',
    shortName: 'CHD-ZC',
    type: 'CHD', commune: 'Abomey', lat: 7.19, lng: 1.99,
    services: HOPITAL_COMPLET,
    open24h: true,
  },
  {
    name: "Centre Hospitalier Départemental de l'Atacora",
    shortName: 'CHD Atacora',
    type: 'CHD', commune: 'Natitingou', lat: 10.31, lng: 1.38,
    services: HOPITAL_COMPLET,
    open24h: true,
  },
  {
    name: 'Centre Hospitalier Départemental de la Donga',
    shortName: 'CHD Donga',
    type: 'CHD', commune: 'Djougou', lat: 9.712, lng: 1.672,
    services: HOPITAL_ZONE,
    open24h: true,
  },
  {
    name: 'Centre Hospitalier Départemental Mono-Couffo',
    shortName: 'CHD Mono-Couffo',
    type: 'CHD', commune: 'Lokossa', lat: 6.64, lng: 1.713,
    services: HOPITAL_COMPLET,
    open24h: true,
  },

  // ───────────── Hôpitaux de zone ─────────────
  { name: 'Hôpital de zone de Suru-Léré', shortName: 'HZ Suru-Léré', type: 'HZ', commune: 'Cotonou', lat: 6.378, lng: 2.448, services: HOPITAL_ZONE, open24h: true },
  { name: 'Hôpital de zone de Mènontin', shortName: 'HZ Mènontin', type: 'HZ', commune: 'Cotonou', lat: 6.4, lng: 2.382, services: HOPITAL_ZONE, open24h: true },
  { name: "Hôpital de zone d'Allada", shortName: 'HZ Allada', type: 'HZ', commune: 'Allada', lat: 6.668, lng: 2.152, services: HOPITAL_ZONE, open24h: true },
  { name: 'Hôpital de zone de Ouidah', shortName: 'HZ Ouidah', type: 'HZ', commune: 'Ouidah', lat: 6.37, lng: 2.085, services: HOPITAL_ZONE, open24h: true },
  { name: 'Hôpital de zone de Kandi', shortName: 'HZ Kandi', type: 'HZ', commune: 'Kandi', lat: 11.128, lng: 2.935, services: HOPITAL_ZONE, open24h: true },
  { name: 'Hôpital de zone de Malanville', shortName: 'HZ Malanville', type: 'HZ', commune: 'Malanville', lat: 11.865, lng: 3.385, services: HOPITAL_ZONE, open24h: true },
  { name: 'Hôpital de zone de Banikoara', shortName: 'HZ Banikoara', type: 'HZ', commune: 'Banikoara', lat: 11.298, lng: 2.44, services: HOPITAL_ZONE, open24h: true },
  { name: 'Hôpital de zone de Nikki', shortName: 'HZ Nikki', type: 'HZ', commune: 'Nikki', lat: 9.94, lng: 3.21, services: HOPITAL_ZONE, open24h: true },
  { name: 'Hôpital de zone de Savalou', shortName: 'HZ Savalou', type: 'HZ', commune: 'Savalou', lat: 7.93, lng: 1.975, services: HOPITAL_ZONE, open24h: true },
  { name: 'Hôpital de zone de Dassa-Zoumè', shortName: 'HZ Dassa', type: 'HZ', commune: 'Dassa-Zoumè', lat: 7.75, lng: 2.185, services: HOPITAL_ZONE, open24h: true },
  { name: 'Hôpital de zone de Savè', shortName: 'HZ Savè', type: 'HZ', commune: 'Savè', lat: 8.035, lng: 2.487, services: HOPITAL_ZONE, open24h: true },
  { name: "Hôpital de zone d'Aplahoué", shortName: 'HZ Aplahoué', type: 'HZ', commune: 'Aplahoué', lat: 6.935, lng: 1.683, services: HOPITAL_ZONE, open24h: true },
  { name: 'Hôpital de zone de Klouékanmè', shortName: 'HZ Klouékanmè', type: 'HZ', commune: 'Klouékanmè', lat: 6.98, lng: 1.843, services: HOPITAL_ZONE, open24h: true },
  { name: 'Hôpital de zone de Comè', shortName: 'HZ Comè', type: 'HZ', commune: 'Comè', lat: 6.405, lng: 1.882, services: HOPITAL_ZONE, open24h: true },
  { name: 'Hôpital de zone de Pobè', shortName: 'HZ Pobè', type: 'HZ', commune: 'Pobè', lat: 6.98, lng: 2.665, services: HOPITAL_ZONE, open24h: true },
  { name: 'Hôpital de zone de Sakété', shortName: 'HZ Sakété', type: 'HZ', commune: 'Sakété', lat: 6.737, lng: 2.66, services: HOPITAL_ZONE, open24h: true },
  { name: "Hôpital de zone d'Adjohoun", shortName: 'HZ Adjohoun', type: 'HZ', commune: 'Adjohoun', lat: 6.71, lng: 2.478, services: HOPITAL_ZONE, open24h: true },
  { name: "Hôpital de zone d'Avrankou", shortName: 'HZ Avrankou', type: 'HZ', commune: 'Avrankou', lat: 6.55, lng: 2.655, services: HOPITAL_ZONE, open24h: true },
  { name: 'Hôpital de zone de Covè', shortName: 'HZ Covè', type: 'HZ', commune: 'Covè', lat: 7.22, lng: 2.34, services: HOPITAL_ZONE, open24h: true },
  { name: "Hôpital de zone d'Abomey", shortName: 'HZ Abomey', type: 'HZ', commune: 'Abomey', lat: 7.185, lng: 1.985, services: HOPITAL_ZONE, open24h: true },
  { name: 'Hôpital de zone de Bassila', shortName: 'HZ Bassila', type: 'HZ', commune: 'Bassila', lat: 9.01, lng: 1.665, services: HOPITAL_ZONE, open24h: true },
  { name: 'Hôpital de zone de Kouandé', shortName: 'HZ Kouandé', type: 'HZ', commune: 'Kouandé', lat: 10.33, lng: 1.69, services: HOPITAL_ZONE, open24h: true },

  // ───────────── Hôpitaux confessionnels / associatifs (faisant souvent office d'HZ) ─────────────
  {
    name: 'Hôpital Saint-Jean de Dieu de Tanguiéta',
    shortName: 'HSJD Tanguiéta',
    type: 'CONFESSIONNEL', commune: 'Tanguiéta', lat: 10.618, lng: 1.268,
    services: [...HOPITAL_COMPLET, 'hematologie'],
    open24h: true,
  },
  {
    name: "Hôpital de l'Ordre de Malte de Djougou",
    shortName: 'HOM Djougou',
    type: 'CONFESSIONNEL', commune: 'Djougou', lat: 9.7, lng: 1.66,
    services: HOPITAL_ZONE,
    open24h: true,
  },
  {
    name: 'Hôpital Saint-Martin de Papané',
    shortName: 'HSM Papané',
    type: 'CONFESSIONNEL', commune: 'Tchaourou', lat: 8.93, lng: 2.78,
    services: HOPITAL_ZONE,
    open24h: true,
  },
  {
    name: 'Hôpital Évangélique de Bembèrèkè',
    shortName: 'HEB',
    type: 'CONFESSIONNEL', commune: 'Bembèrèkè', lat: 10.225, lng: 2.665,
    services: HOPITAL_ZONE,
    open24h: true,
  },
  {
    name: 'Hôpital La Croix de Zinvié',
    shortName: 'HLC Zinvié',
    type: 'CONFESSIONNEL', commune: 'Abomey-Calavi', lat: 6.62, lng: 2.34,
    services: HOPITAL_ZONE,
    open24h: true,
  },
  {
    name: 'Hôpital Bethesda de Cotonou',
    shortName: 'Bethesda',
    type: 'CONFESSIONNEL', commune: 'Cotonou', lat: 6.38, lng: 2.4,
    services: ['urgences', 'maternite', 'pediatrie', 'chirurgie', 'medecine', 'laboratoire', 'radiologie', 'consultation'],
    open24h: true,
  },

  // ───────────── Centres de santé communaux (chaque commune en dispose) ─────────────
  { name: 'Centre de santé communal de Sô-Ava', shortName: 'CSC Sô-Ava', type: 'CS', commune: 'Sô-Ava', lat: 6.465, lng: 2.4, services: ['consultation', 'maternite', 'vaccination', 'laboratoire'], open24h: false },
  { name: 'Centre de santé communal de Toffo', shortName: 'CSC Toffo', type: 'CS', commune: 'Toffo', lat: 6.85, lng: 2.08, services: ['consultation', 'maternite', 'vaccination', 'laboratoire'], open24h: false },
  { name: 'Centre de santé communal de Karimama', shortName: 'CSC Karimama', type: 'CS', commune: 'Karimama', lat: 12.068, lng: 3.18, services: ['consultation', 'maternite', 'vaccination'], open24h: false },
  { name: 'Centre de santé communal de Djougou', shortName: 'CSC Djougou', type: 'CS', commune: 'Djougou', lat: 9.712, lng: 1.672,
    services: ['consultation', 'maternite', 'vaccination', 'laboratoire', 'pediatrie'], open24h: false },
  { name: 'Centre de santé communal de Ouaké', shortName: 'CSC Ouaké', type: 'CS', commune: 'Ouaké', lat: 9.66, lng: 1.39, services: ['consultation', 'maternite', 'vaccination'], open24h: false },
  { name: 'Centre de santé communal de Grand-Popo', shortName: 'CSC Grand-Popo', type: 'CS', commune: 'Grand-Popo', lat: 6.283, lng: 1.822, services: ['consultation', 'maternite', 'vaccination', 'laboratoire'], open24h: false },

  // ───────────── Transfusion sanguine (ANTS et services départementaux) ─────────────
  { name: 'Agence Nationale pour la Transfusion Sanguine (siège)', shortName: 'ANTS', type: 'TRANSFUSION', commune: 'Cotonou', lat: 6.362, lng: 2.414, services: ['transfusion', 'laboratoire'], open24h: false },
  { name: 'Service départemental de transfusion sanguine Atlantique-Littoral (Cotonou)', shortName: 'SDTS Atlantique-Littoral', type: 'TRANSFUSION', commune: 'Cotonou', lat: 6.361, lng: 2.413, services: ['transfusion', 'laboratoire'], open24h: true },
  { name: 'Service départemental de transfusion sanguine Ouémé-Plateau (Porto-Novo)', shortName: 'SDTS Ouémé-Plateau', type: 'TRANSFUSION', commune: 'Porto-Novo', lat: 6.493, lng: 2.611, services: ['transfusion', 'laboratoire'], open24h: true },
  { name: 'Service départemental de transfusion sanguine Borgou-Alibori (Parakou)', shortName: 'SDTS Borgou-Alibori', type: 'TRANSFUSION', commune: 'Parakou', lat: 9.351, lng: 2.613, services: ['transfusion', 'laboratoire'], open24h: true },
  { name: 'Service départemental de transfusion sanguine Zou-Collines (Abomey)', shortName: 'SDTS Zou-Collines', type: 'TRANSFUSION', commune: 'Abomey', lat: 7.191, lng: 1.991, services: ['transfusion', 'laboratoire'], open24h: true },
  { name: 'Service départemental de transfusion sanguine Atacora-Donga (Natitingou)', shortName: 'SDTS Atacora-Donga', type: 'TRANSFUSION', commune: 'Natitingou', lat: 10.311, lng: 1.381, services: ['transfusion', 'laboratoire'], open24h: true },
  { name: 'Service départemental de transfusion sanguine Mono-Couffo (Lokossa)', shortName: 'SDTS Mono-Couffo', type: 'TRANSFUSION', commune: 'Lokossa', lat: 6.641, lng: 1.714, services: ['transfusion', 'laboratoire'], open24h: true },

  // ───────────── Pharmacies d'officine ─────────────
  // Cotonou
  { name: 'Pharmacie Camp Guézo', type: 'PHARMACIE', commune: 'Cotonou', lat: 6.363, lng: 2.408, services: [], open24h: false },
  { name: 'Pharmacie Jonquet', type: 'PHARMACIE', commune: 'Cotonou', lat: 6.366, lng: 2.426, services: [], open24h: false },
  { name: "Pharmacie de l'Étoile", type: 'PHARMACIE', commune: 'Cotonou', lat: 6.37, lng: 2.43, services: [], open24h: false },
  { name: 'Pharmacie Les Cocotiers', type: 'PHARMACIE', commune: 'Cotonou', lat: 6.356, lng: 2.39, services: [], open24h: false },
  { name: 'Pharmacie Saint-Michel', type: 'PHARMACIE', commune: 'Cotonou', lat: 6.372, lng: 2.436, services: [], open24h: false },
  { name: 'Pharmacie Haie Vive', type: 'PHARMACIE', commune: 'Cotonou', lat: 6.354, lng: 2.396, services: [], open24h: false },
  { name: 'Pharmacie Gbégamey', type: 'PHARMACIE', commune: 'Cotonou', lat: 6.368, lng: 2.412, services: [], open24h: false },
  { name: 'Pharmacie Sainte-Rita', type: 'PHARMACIE', commune: 'Cotonou', lat: 6.385, lng: 2.425, services: [], open24h: false },
  { name: 'Pharmacie du quartier Fidjrossè (Cotonou)', type: 'PHARMACIE', commune: 'Cotonou', lat: 6.36, lng: 2.37, services: [], open24h: false },
  // Porto-Novo
  { name: 'Pharmacie du quartier Ouando (Porto-Novo)', type: 'PHARMACIE', commune: 'Porto-Novo', lat: 6.505, lng: 2.62, services: [], open24h: false },
  { name: 'Pharmacie du quartier Tokpota (Porto-Novo)', type: 'PHARMACIE', commune: 'Porto-Novo', lat: 6.49, lng: 2.605, services: [], open24h: false },
  // Abomey-Calavi
  { name: 'Pharmacie du carrefour Calavi-Kpota (Abomey-Calavi)', type: 'PHARMACIE', commune: 'Abomey-Calavi', lat: 6.45, lng: 2.355, services: [], open24h: false },
  { name: 'Pharmacie du quartier Godomey (Abomey-Calavi)', type: 'PHARMACIE', commune: 'Abomey-Calavi', lat: 6.41, lng: 2.33, services: [], open24h: false },
  // Parakou
  { name: 'Pharmacie du marché Arzèkè (Parakou)', type: 'PHARMACIE', commune: 'Parakou', lat: 9.343, lng: 2.625, services: [], open24h: false },
  { name: 'Pharmacie du quartier Albarika (Parakou)', type: 'PHARMACIE', commune: 'Parakou', lat: 9.35, lng: 2.63, services: [], open24h: false },
  // Autres villes
  { name: 'Pharmacie du marché central de Djougou', type: 'PHARMACIE', commune: 'Djougou', lat: 9.705, lng: 1.668, services: [], open24h: false },
  { name: 'Pharmacie du centre-ville de Natitingou', type: 'PHARMACIE', commune: 'Natitingou', lat: 10.305, lng: 1.378, services: [], open24h: false },
  { name: 'Pharmacie du marché de Kandi', type: 'PHARMACIE', commune: 'Kandi', lat: 11.132, lng: 2.938, services: [], open24h: false },
  { name: 'Pharmacie du marché de Bohicon', type: 'PHARMACIE', commune: 'Bohicon', lat: 7.178, lng: 2.068, services: [], open24h: false },
  { name: 'Pharmacie du centre-ville de Lokossa', type: 'PHARMACIE', commune: 'Lokossa', lat: 6.638, lng: 1.718, services: [], open24h: false },
];
