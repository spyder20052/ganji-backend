/**
 * Référentiel géographique du Bénin : 12 départements et 77 communes.
 *
 * Découpage administratif en vigueur (loi n° 97-028 du 15 janvier 1999,
 * chefs-lieux fixés en 2016). Coordonnées = centroïde approximatif pour les
 * départements, ville principale (chef-lieu de commune) pour les communes,
 * précision visée ~0,05°. Populations : RGPH4 2013 (INSAE, résultats
 * définitifs), à revérifier auprès de l'INStaD avant publication.
 */

export interface DepartmentData {
  code: string;
  name: string;
  chefLieu: string;
  lat: number;
  lng: number;
  population2013?: number;
}

export interface CommuneData {
  name: string;
  /** Code du département (DepartmentData.code) */
  department: string;
  lat: number;
  lng: number;
}

export const DEPARTMENTS: DepartmentData[] = [
  { code: 'ALI', name: 'Alibori', chefLieu: 'Kandi', lat: 11.45, lng: 2.85, population2013: 868046 },
  { code: 'ATA', name: 'Atacora', chefLieu: 'Natitingou', lat: 10.6, lng: 1.55, population2013: 772262 },
  { code: 'ATL', name: 'Atlantique', chefLieu: 'Allada', lat: 6.62, lng: 2.18, population2013: 1398229 },
  { code: 'BOR', name: 'Borgou', chefLieu: 'Parakou', lat: 9.9, lng: 2.9, population2013: 1214249 },
  { code: 'COL', name: 'Collines', chefLieu: 'Dassa-Zoumè', lat: 8.2, lng: 2.2, population2013: 717477 },
  { code: 'COU', name: 'Couffo', chefLieu: 'Aplahoué', lat: 7.0, lng: 1.78, population2013: 745328 },
  { code: 'DON', name: 'Donga', chefLieu: 'Djougou', lat: 9.4, lng: 1.65, population2013: 543130 },
  { code: 'LIT', name: 'Littoral', chefLieu: 'Cotonou', lat: 6.37, lng: 2.42, population2013: 679012 },
  { code: 'MON', name: 'Mono', chefLieu: 'Lokossa', lat: 6.5, lng: 1.83, population2013: 497243 },
  { code: 'OUE', name: 'Ouémé', chefLieu: 'Porto-Novo', lat: 6.62, lng: 2.53, population2013: 1100404 },
  { code: 'PLA', name: 'Plateau', chefLieu: 'Pobè', lat: 7.0, lng: 2.63, population2013: 622372 },
  { code: 'ZOU', name: 'Zou', chefLieu: 'Abomey', lat: 7.2, lng: 2.15, population2013: 851580 },
];

/**
 * Les 77 communes du Bénin (6 + 9 + 8 + 8 + 6 + 6 + 4 + 1 + 6 + 9 + 5 + 9 = 77).
 * Le nombre est vérifié au seed : COMMUNES.length === 77.
 */
export const COMMUNES: CommuneData[] = [
  // Alibori (6)
  { name: 'Banikoara', department: 'ALI', lat: 11.3, lng: 2.44 },
  { name: 'Gogounou', department: 'ALI', lat: 10.84, lng: 2.84 },
  { name: 'Kandi', department: 'ALI', lat: 11.13, lng: 2.94 },
  { name: 'Karimama', department: 'ALI', lat: 12.07, lng: 3.18 },
  { name: 'Malanville', department: 'ALI', lat: 11.86, lng: 3.39 },
  { name: 'Ségbana', department: 'ALI', lat: 10.93, lng: 3.69 },

  // Atacora (9)
  { name: 'Boukoumbé', department: 'ATA', lat: 10.18, lng: 1.1 },
  { name: 'Cobly', department: 'ATA', lat: 10.47, lng: 0.98 },
  { name: 'Kérou', department: 'ATA', lat: 10.83, lng: 2.11 },
  { name: 'Kouandé', department: 'ATA', lat: 10.33, lng: 1.69 },
  { name: 'Matéri', department: 'ATA', lat: 10.7, lng: 1.06 },
  { name: 'Natitingou', department: 'ATA', lat: 10.3, lng: 1.38 },
  { name: 'Péhunco', department: 'ATA', lat: 10.23, lng: 1.95 },
  { name: 'Tanguiéta', department: 'ATA', lat: 10.62, lng: 1.27 },
  { name: 'Toucountouna', department: 'ATA', lat: 10.49, lng: 1.38 },

  // Atlantique (8)
  { name: 'Abomey-Calavi', department: 'ATL', lat: 6.45, lng: 2.35 },
  { name: 'Allada', department: 'ATL', lat: 6.67, lng: 2.15 },
  { name: 'Kpomassè', department: 'ATL', lat: 6.41, lng: 2.0 },
  { name: 'Ouidah', department: 'ATL', lat: 6.36, lng: 2.08 },
  { name: 'Sô-Ava', department: 'ATL', lat: 6.47, lng: 2.4 },
  { name: 'Toffo', department: 'ATL', lat: 6.85, lng: 2.08 },
  { name: 'Tori-Bossito', department: 'ATL', lat: 6.5, lng: 2.15 },
  { name: 'Zè', department: 'ATL', lat: 6.78, lng: 2.3 },

  // Borgou (8)
  { name: 'Bembèrèkè', department: 'BOR', lat: 10.23, lng: 2.66 },
  { name: 'Kalalé', department: 'BOR', lat: 10.29, lng: 3.38 },
  { name: "N'Dali", department: 'BOR', lat: 9.86, lng: 2.72 },
  { name: 'Nikki', department: 'BOR', lat: 9.94, lng: 3.21 },
  { name: 'Parakou', department: 'BOR', lat: 9.34, lng: 2.63 },
  { name: 'Pèrèrè', department: 'BOR', lat: 9.8, lng: 2.99 },
  { name: 'Sinendé', department: 'BOR', lat: 10.35, lng: 2.38 },
  { name: 'Tchaourou', department: 'BOR', lat: 8.89, lng: 2.6 },

  // Collines (6)
  { name: 'Bantè', department: 'COL', lat: 8.42, lng: 1.88 },
  { name: 'Dassa-Zoumè', department: 'COL', lat: 7.75, lng: 2.18 },
  { name: 'Glazoué', department: 'COL', lat: 7.97, lng: 2.24 },
  { name: 'Ouèssè', department: 'COL', lat: 8.49, lng: 2.43 },
  { name: 'Savalou', department: 'COL', lat: 7.93, lng: 1.98 },
  { name: 'Savè', department: 'COL', lat: 8.03, lng: 2.49 },

  // Couffo (6)
  { name: 'Aplahoué', department: 'COU', lat: 6.93, lng: 1.68 },
  { name: 'Djakotomey', department: 'COU', lat: 6.9, lng: 1.72 },
  { name: 'Dogbo', department: 'COU', lat: 6.8, lng: 1.78 },
  { name: 'Klouékanmè', department: 'COU', lat: 6.98, lng: 1.84 },
  { name: 'Lalo', department: 'COU', lat: 6.91, lng: 1.89 },
  { name: 'Toviklin', department: 'COU', lat: 7.0, lng: 1.79 },

  // Donga (4)
  { name: 'Bassila', department: 'DON', lat: 9.01, lng: 1.67 },
  { name: 'Copargo', department: 'DON', lat: 9.84, lng: 1.55 },
  { name: 'Djougou', department: 'DON', lat: 9.71, lng: 1.67 },
  { name: 'Ouaké', department: 'DON', lat: 9.66, lng: 1.39 },

  // Littoral (1)
  { name: 'Cotonou', department: 'LIT', lat: 6.37, lng: 2.42 },

  // Mono (6)
  { name: 'Athiémé', department: 'MON', lat: 6.58, lng: 1.67 },
  { name: 'Bopa', department: 'MON', lat: 6.59, lng: 1.98 },
  { name: 'Comè', department: 'MON', lat: 6.41, lng: 1.88 },
  { name: 'Grand-Popo', department: 'MON', lat: 6.28, lng: 1.82 },
  { name: 'Houéyogbé', department: 'MON', lat: 6.54, lng: 1.87 },
  { name: 'Lokossa', department: 'MON', lat: 6.64, lng: 1.72 },

  // Ouémé (9)
  { name: 'Adjarra', department: 'OUE', lat: 6.53, lng: 2.67 },
  { name: 'Adjohoun', department: 'OUE', lat: 6.71, lng: 2.48 },
  { name: 'Aguégués', department: 'OUE', lat: 6.45, lng: 2.53 },
  { name: 'Akpro-Missérété', department: 'OUE', lat: 6.57, lng: 2.6 },
  { name: 'Avrankou', department: 'OUE', lat: 6.55, lng: 2.65 },
  { name: 'Bonou', department: 'OUE', lat: 6.9, lng: 2.45 },
  { name: 'Dangbo', department: 'OUE', lat: 6.58, lng: 2.55 },
  { name: 'Porto-Novo', department: 'OUE', lat: 6.5, lng: 2.62 },
  { name: 'Sèmè-Kpodji', department: 'OUE', lat: 6.37, lng: 2.62 },

  // Plateau (5)
  { name: 'Adja-Ouèrè', department: 'PLA', lat: 6.98, lng: 2.6 },
  { name: 'Ifangni', department: 'PLA', lat: 6.65, lng: 2.72 },
  { name: 'Kétou', department: 'PLA', lat: 7.36, lng: 2.6 },
  { name: 'Pobè', department: 'PLA', lat: 6.98, lng: 2.66 },
  { name: 'Sakété', department: 'PLA', lat: 6.74, lng: 2.66 },

  // Zou (9)
  { name: 'Abomey', department: 'ZOU', lat: 7.18, lng: 1.99 },
  { name: 'Agbangnizoun', department: 'ZOU', lat: 7.08, lng: 1.96 },
  { name: 'Bohicon', department: 'ZOU', lat: 7.18, lng: 2.07 },
  { name: 'Covè', department: 'ZOU', lat: 7.22, lng: 2.34 },
  { name: 'Djidja', department: 'ZOU', lat: 7.34, lng: 1.93 },
  { name: 'Ouinhi', department: 'ZOU', lat: 7.09, lng: 2.49 },
  { name: 'Za-Kpota', department: 'ZOU', lat: 7.23, lng: 2.2 },
  { name: 'Zagnanado', department: 'ZOU', lat: 7.27, lng: 2.35 },
  { name: 'Zogbodomey', department: 'ZOU', lat: 7.08, lng: 2.18 },
];
