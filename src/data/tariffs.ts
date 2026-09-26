/**
 * Grille de tarifs des actes dans les formations sanitaires publiques du Bénin
 * (centres de santé, hôpitaux de zone, CHD, CNHU), pour estimer le reste à charge.
 *
 * TARIFS INDICATIFS : ordres de grandeur relevés dans les formations publiques et
 * arrondis, pour la démonstration. Ils varient selon le niveau de l'établissement
 * (un CNHU facture plus qu'un centre de santé) et doivent être remplacés par la
 * grille officielle du ministère de la Santé avant tout usage réel.
 * La césarienne est à 0 : elle est gratuite dans les hôpitaux publics (politique
 * nationale de gratuité de la césarienne, depuis 2009).
 */

export type TariffCategory = 'CONSULTATION' | 'ANALYSE' | 'IMAGERIE' | 'HOSPITALISATION' | 'ACTE';

export interface TariffData {
  code: string;
  label: string;
  category: TariffCategory;
  priceFcfa: number;
}

export const TARIFFS: TariffData[] = [
  // ── Consultations ──
  { code: 'CONS-CS', label: 'Consultation au centre de santé', category: 'CONSULTATION', priceFcfa: 1000 },
  { code: 'CONS-GEN', label: 'Consultation de médecine générale (hôpital)', category: 'CONSULTATION', priceFcfa: 2000 },
  { code: 'CONS-SPE', label: 'Consultation de spécialiste', category: 'CONSULTATION', priceFcfa: 5000 },
  { code: 'CONS-URG', label: 'Consultation aux urgences', category: 'CONSULTATION', priceFcfa: 3000 },

  // ── Analyses de laboratoire ──
  { code: 'LAB-NFS', label: 'Numération formule sanguine (NFS)', category: 'ANALYSE', priceFcfa: 3500 },
  { code: 'LAB-GE', label: 'Goutte épaisse (paludisme)', category: 'ANALYSE', priceFcfa: 1000 },
  { code: 'LAB-TDR', label: 'Test rapide du paludisme (TDR)', category: 'ANALYSE', priceFcfa: 500 },
  { code: 'LAB-GLY', label: 'Glycémie', category: 'ANALYSE', priceFcfa: 1000 },
  { code: 'LAB-CREA', label: 'Créatinine', category: 'ANALYSE', priceFcfa: 2500 },
  { code: 'LAB-GRP', label: 'Groupe sanguin et rhésus', category: 'ANALYSE', priceFcfa: 2000 },
  { code: 'LAB-ECBU', label: 'Examen des urines (ECBU)', category: 'ANALYSE', priceFcfa: 5000 },
  { code: 'LAB-TRANS', label: 'Transaminases (foie)', category: 'ANALYSE', priceFcfa: 4000 },

  // ── Imagerie ──
  { code: 'IMG-RXT', label: 'Radiographie du thorax', category: 'IMAGERIE', priceFcfa: 8000 },
  { code: 'IMG-ECHO-ABD', label: 'Échographie abdominale', category: 'IMAGERIE', priceFcfa: 12000 },
  { code: 'IMG-ECHO-OBS', label: 'Échographie de grossesse', category: 'IMAGERIE', priceFcfa: 7500 },

  // ── Hospitalisation ──
  { code: 'HOSP-JOUR', label: 'Hospitalisation, par jour (salle commune)', category: 'HOSPITALISATION', priceFcfa: 3000 },
  { code: 'HOSP-JOUR-CHU', label: 'Hospitalisation, par jour (CHU)', category: 'HOSPITALISATION', priceFcfa: 6000 },

  // ── Actes ──
  { code: 'ACT-ACC', label: 'Accouchement simple', category: 'ACTE', priceFcfa: 10000 },
  { code: 'ACT-CES', label: 'Césarienne (gratuite à l’hôpital public)', category: 'ACTE', priceFcfa: 0 },
  { code: 'ACT-SANG', label: 'Poche de sang (frais de cession)', category: 'ACTE', priceFcfa: 5000 },
  { code: 'ACT-TRANSF', label: 'Pose d’une transfusion', category: 'ACTE', priceFcfa: 2000 },
  { code: 'ACT-PANS', label: 'Pansement simple', category: 'ACTE', priceFcfa: 1000 },
  { code: 'ACT-INJ', label: 'Injection', category: 'ACTE', priceFcfa: 300 },
  { code: 'ACT-SUT', label: 'Suture d’une plaie', category: 'ACTE', priceFcfa: 3000 },
];
