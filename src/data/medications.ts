/**
 * Médicaments de référence (sélection de démonstration).
 *
 * Source d'inspiration : Liste modèle OMS des médicaments essentiels et Liste
 * nationale des médicaments essentiels (LNME) du Bénin, dénomination commune
 * internationale (DCI) uniquement, aucune marque.
 *
 * PRIX : `indicativePriceFcfa` est un prix INDICATIF ET SIMULÉ (ordre de
 * grandeur secteur public, par boîte/flacon/ampoule usuelle), arrondi. Il ne
 * reflète pas le barème officiel de la CAME et doit être remplacé par des
 * données réelles avant tout usage. Prix 0 = produit délivré gratuitement dans
 * le cadre d'un programme national (VIH, tuberculose), sous réserve de
 * vérification.
 */

export interface MedicationData {
  dci: string;
  form: string;
  strength: string;
  atc?: string;
  category: string;
  indicativePriceFcfa?: number;
  essential: boolean;
  chronic?: boolean;
}

export const MEDICATIONS: MedicationData[] = [
  // ── Antipaludiques ──
  { dci: 'Artéméther + luméfantrine', form: 'comprimé', strength: '20 mg / 120 mg (boîte de 24)', atc: 'P01BF01', category: 'Antipaludique', indicativePriceFcfa: 1500, essential: true },
  { dci: 'Artéméther + luméfantrine', form: 'comprimé dispersible', strength: '20 mg / 120 mg (enfant, boîte de 6)', atc: 'P01BF01', category: 'Antipaludique', indicativePriceFcfa: 500, essential: true },
  { dci: 'Artésunate + amodiaquine', form: 'comprimé', strength: '100 mg / 270 mg', atc: 'P01BF03', category: 'Antipaludique', indicativePriceFcfa: 1000, essential: true },
  { dci: 'Artésunate', form: 'poudre pour injection', strength: '60 mg', atc: 'P01BE03', category: 'Antipaludique (paludisme grave)', indicativePriceFcfa: 1500, essential: true },
  { dci: 'Artésunate', form: 'suppositoire rectal', strength: '100 mg (traitement pré-transfert)', atc: 'P01BE03', category: 'Antipaludique (paludisme grave)', indicativePriceFcfa: 1000, essential: true },
  { dci: 'Sulfadoxine + pyriméthamine', form: 'comprimé', strength: '500 mg / 25 mg (TPI)', atc: 'P01BD51', category: 'Antipaludique (prévention femme enceinte)', indicativePriceFcfa: 300, essential: true },
  { dci: 'Quinine (dichlorhydrate)', form: 'solution injectable', strength: '300 mg/mL, ampoule de 2 mL', atc: 'P01BC01', category: 'Antipaludique (paludisme grave)', indicativePriceFcfa: 300, essential: true },
  { dci: 'Quinine (sulfate)', form: 'comprimé', strength: '300 mg', atc: 'P01BC01', category: 'Antipaludique', indicativePriceFcfa: 1000, essential: true },

  // ── Antibiotiques / anti-infectieux ──
  { dci: 'Amoxicilline', form: 'gélule', strength: '500 mg', atc: 'J01CA04', category: 'Antibiotique', indicativePriceFcfa: 1000, essential: true },
  { dci: 'Amoxicilline', form: 'comprimé dispersible', strength: '250 mg (pneumonie de l\'enfant)', atc: 'J01CA04', category: 'Antibiotique', indicativePriceFcfa: 500, essential: true },
  { dci: 'Amoxicilline + acide clavulanique', form: 'comprimé', strength: '500 mg / 125 mg', atc: 'J01CR02', category: 'Antibiotique', indicativePriceFcfa: 3500, essential: true },
  { dci: 'Cotrimoxazole (sulfaméthoxazole + triméthoprime)', form: 'comprimé', strength: '400 mg / 80 mg', atc: 'J01EE01', category: 'Antibiotique', indicativePriceFcfa: 500, essential: true },
  { dci: 'Ceftriaxone', form: 'poudre pour injection', strength: '1 g', atc: 'J01DD04', category: 'Antibiotique', indicativePriceFcfa: 1000, essential: true },
  { dci: 'Ampicilline', form: 'poudre pour injection', strength: '1 g', atc: 'J01CA01', category: 'Antibiotique', indicativePriceFcfa: 500, essential: true },
  { dci: 'Benzathine benzylpénicilline', form: 'poudre pour injection', strength: '2,4 MUI', atc: 'J01CE08', category: 'Antibiotique', indicativePriceFcfa: 1000, essential: true },
  { dci: 'Phénoxyméthylpénicilline (pénicilline V)', form: 'comprimé', strength: '250 mg (prophylaxie drépanocytose)', atc: 'J01CE02', category: 'Antibiotique', indicativePriceFcfa: 1000, essential: true, chronic: true },
  { dci: 'Cloxacilline', form: 'gélule', strength: '500 mg', atc: 'J01CF02', category: 'Antibiotique', indicativePriceFcfa: 1500, essential: true },
  { dci: 'Ciprofloxacine', form: 'comprimé', strength: '500 mg', atc: 'J01MA02', category: 'Antibiotique', indicativePriceFcfa: 1000, essential: true },
  { dci: 'Métronidazole', form: 'comprimé', strength: '250 mg', atc: 'P01AB01', category: 'Anti-infectieux', indicativePriceFcfa: 500, essential: true },
  { dci: 'Gentamicine', form: 'solution injectable', strength: '40 mg/mL, ampoule de 2 mL', atc: 'J01GB03', category: 'Antibiotique', indicativePriceFcfa: 300, essential: true },
  { dci: 'Doxycycline', form: 'comprimé', strength: '100 mg', atc: 'J01AA02', category: 'Antibiotique', indicativePriceFcfa: 500, essential: true },
  { dci: 'Azithromycine', form: 'comprimé', strength: '500 mg', atc: 'J01FA10', category: 'Antibiotique', indicativePriceFcfa: 2000, essential: true },
  { dci: 'Fluconazole', form: 'gélule', strength: '150 mg', atc: 'J02AC01', category: 'Antifongique', indicativePriceFcfa: 1000, essential: true },
  { dci: 'Albendazole', form: 'comprimé', strength: '400 mg', atc: 'P02CA03', category: 'Antiparasitaire (vermifuge)', indicativePriceFcfa: 200, essential: true },
  { dci: 'Praziquantel', form: 'comprimé', strength: '600 mg', atc: 'P02BA01', category: 'Antiparasitaire (bilharziose)', indicativePriceFcfa: 500, essential: true },

  // ── Analgésiques ──
  { dci: 'Paracétamol', form: 'comprimé', strength: '500 mg', atc: 'N02BE01', category: 'Analgésique / antipyrétique', indicativePriceFcfa: 200, essential: true },
  { dci: 'Paracétamol', form: 'sirop', strength: '120 mg / 5 mL', atc: 'N02BE01', category: 'Analgésique / antipyrétique', indicativePriceFcfa: 500, essential: true },
  { dci: 'Ibuprofène', form: 'comprimé', strength: '400 mg', atc: 'M01AE01', category: 'Anti-inflammatoire / analgésique', indicativePriceFcfa: 500, essential: true },
  { dci: 'Morphine', form: 'solution buvable', strength: '10 mg / 5 mL', atc: 'N02AA01', category: 'Analgésique opioïde (soins palliatifs)', indicativePriceFcfa: 5000, essential: true },

  // ── Réhydratation, nutrition, hématinique ──
  { dci: 'Sels de réhydratation orale (SRO, osmolarité réduite)', form: 'poudre pour solution buvable', strength: 'sachet pour 1 L', atc: 'A07CA', category: 'Réhydratation', indicativePriceFcfa: 100, essential: true },
  { dci: 'Zinc (sulfate)', form: 'comprimé dispersible', strength: '20 mg', atc: 'A12CB01', category: 'Diarrhée de l\'enfant (avec SRO)', indicativePriceFcfa: 500, essential: true },
  { dci: 'Sulfate ferreux + acide folique', form: 'comprimé', strength: '60 mg fer / 400 µg', atc: 'B03AD03', category: 'Antianémique (grossesse)', indicativePriceFcfa: 500, essential: true },
  { dci: 'Acide folique', form: 'comprimé', strength: '5 mg', atc: 'B03BB01', category: 'Antianémique (drépanocytose)', indicativePriceFcfa: 300, essential: true, chronic: true },
  { dci: 'Rétinol (vitamine A)', form: 'capsule', strength: '200 000 UI', atc: 'A11CA01', category: 'Vitamine (supplémentation enfant)', essential: true },

  // ── Drépanocytose / hématologie / oncologie ──
  { dci: 'Hydroxyurée (hydroxycarbamide)', form: 'gélule', strength: '500 mg', atc: 'L01XX05', category: 'Drépanocytose / hématologie', indicativePriceFcfa: 10000, essential: true, chronic: true },
  { dci: 'Imatinib', form: 'comprimé', strength: '400 mg', atc: 'L01EA01', category: 'Oncologie (leucémie myéloïde chronique)', essential: true, chronic: true },
  { dci: 'Méthotrexate', form: 'comprimé', strength: '2,5 mg', atc: 'L01BA01', category: 'Oncologie / immunosuppresseur', indicativePriceFcfa: 3000, essential: true, chronic: true },
  { dci: 'Cyclophosphamide', form: 'poudre pour injection', strength: '500 mg', atc: 'L01AA01', category: 'Oncologie', indicativePriceFcfa: 5000, essential: true },
  { dci: 'Vincristine', form: 'solution injectable', strength: '1 mg / mL', atc: 'L01CA02', category: 'Oncologie', indicativePriceFcfa: 5000, essential: true },
  { dci: 'Doxorubicine', form: 'poudre pour injection', strength: '50 mg', atc: 'L01DB01', category: 'Oncologie', indicativePriceFcfa: 10000, essential: true },
  { dci: 'Tamoxifène', form: 'comprimé', strength: '20 mg', atc: 'L02BA01', category: 'Oncologie (cancer du sein)', indicativePriceFcfa: 3000, essential: true, chronic: true },
  { dci: 'Allopurinol', form: 'comprimé', strength: '100 mg', atc: 'M04AA01', category: 'Hématologie / goutte', indicativePriceFcfa: 1000, essential: true, chronic: true },

  // ── Diabète ──
  { dci: 'Metformine', form: 'comprimé', strength: '500 mg', atc: 'A10BA02', category: 'Antidiabétique', indicativePriceFcfa: 1500, essential: true, chronic: true },
  { dci: 'Glibenclamide', form: 'comprimé', strength: '5 mg', atc: 'A10BB01', category: 'Antidiabétique', indicativePriceFcfa: 500, essential: true, chronic: true },
  { dci: 'Gliclazide', form: 'comprimé', strength: '80 mg', atc: 'A10BB09', category: 'Antidiabétique', indicativePriceFcfa: 1500, essential: true, chronic: true },
  { dci: 'Insuline humaine isophane (NPH)', form: 'suspension injectable', strength: '100 UI/mL, flacon 10 mL', atc: 'A10AC01', category: 'Antidiabétique (insuline)', indicativePriceFcfa: 5000, essential: true, chronic: true },
  { dci: 'Insuline humaine rapide (soluble)', form: 'solution injectable', strength: '100 UI/mL, flacon 10 mL', atc: 'A10AB01', category: 'Antidiabétique (insuline)', indicativePriceFcfa: 5000, essential: true, chronic: true },
  { dci: 'Glucose hypertonique', form: 'solution injectable', strength: '50 %, 50 mL', atc: 'B05BA03', category: 'Urgence (hypoglycémie)', indicativePriceFcfa: 500, essential: true },

  // ── Cardiovasculaire ──
  { dci: 'Amlodipine', form: 'comprimé', strength: '5 mg', atc: 'C08CA01', category: 'Antihypertenseur', indicativePriceFcfa: 1500, essential: true, chronic: true },
  { dci: 'Hydrochlorothiazide', form: 'comprimé', strength: '25 mg', atc: 'C03AA03', category: 'Antihypertenseur (diurétique)', indicativePriceFcfa: 1000, essential: true, chronic: true },
  { dci: 'Énalapril', form: 'comprimé', strength: '10 mg', atc: 'C09AA02', category: 'Antihypertenseur (IEC)', indicativePriceFcfa: 1500, essential: true, chronic: true },
  { dci: 'Losartan', form: 'comprimé', strength: '50 mg', atc: 'C09CA01', category: 'Antihypertenseur (ARA II)', indicativePriceFcfa: 2000, essential: true, chronic: true },
  { dci: 'Nifédipine', form: 'comprimé à libération prolongée', strength: '20 mg', atc: 'C08CA05', category: 'Antihypertenseur', indicativePriceFcfa: 1500, essential: true, chronic: true },
  { dci: 'Furosémide', form: 'comprimé', strength: '40 mg', atc: 'C03CA01', category: 'Diurétique', indicativePriceFcfa: 500, essential: true },
  { dci: 'Simvastatine', form: 'comprimé', strength: '20 mg', atc: 'C10AA01', category: 'Hypolipémiant', indicativePriceFcfa: 2000, essential: true, chronic: true },
  { dci: 'Acide acétylsalicylique', form: 'comprimé', strength: '100 mg', atc: 'B01AC06', category: 'Antiagrégant plaquettaire', indicativePriceFcfa: 500, essential: true, chronic: true },

  // ── VIH (programme national) ──
  { dci: 'Ténofovir + lamivudine + dolutégravir (TLD)', form: 'comprimé', strength: '300 mg / 300 mg / 50 mg', atc: 'J05AR27', category: 'Antirétroviral', indicativePriceFcfa: 0, essential: true, chronic: true },
  { dci: 'Dolutégravir', form: 'comprimé dispersible', strength: '10 mg (pédiatrique)', atc: 'J05AJ03', category: 'Antirétroviral', indicativePriceFcfa: 0, essential: true, chronic: true },

  // ── Tuberculose (programme national) ──
  { dci: 'Rifampicine + isoniazide + pyrazinamide + éthambutol (RHZE)', form: 'comprimé', strength: '150 mg / 75 mg / 400 mg / 275 mg', atc: 'J04AM06', category: 'Antituberculeux (phase intensive)', indicativePriceFcfa: 0, essential: true, chronic: true },
  { dci: 'Rifampicine + isoniazide (RH)', form: 'comprimé', strength: '150 mg / 75 mg', atc: 'J04AM02', category: 'Antituberculeux (phase de continuation)', indicativePriceFcfa: 0, essential: true, chronic: true },
  { dci: 'Isoniazide', form: 'comprimé', strength: '300 mg (traitement préventif)', atc: 'J04AC01', category: 'Antituberculeux (prévention)', indicativePriceFcfa: 0, essential: true, chronic: true },

  // ── Santé maternelle et reproductive ──
  { dci: 'Ocytocine', form: 'solution injectable', strength: '10 UI / mL', atc: 'H01BB02', category: 'Santé maternelle (prévention de l\'hémorragie du post-partum)', indicativePriceFcfa: 500, essential: true },
  { dci: 'Misoprostol', form: 'comprimé', strength: '200 µg', atc: 'G02AD06', category: 'Santé maternelle (hémorragie du post-partum)', indicativePriceFcfa: 500, essential: true },
  { dci: 'Acide tranexamique', form: 'solution injectable', strength: '100 mg/mL, ampoule de 10 mL', atc: 'B02AA02', category: 'Santé maternelle (hémorragie du post-partum)', indicativePriceFcfa: 1000, essential: true },
  { dci: 'Sulfate de magnésium', form: 'solution injectable', strength: '500 mg/mL (50 %), ampoule de 10 mL', atc: 'B05XA05', category: 'Santé maternelle (pré-éclampsie / éclampsie)', indicativePriceFcfa: 500, essential: true },
  { dci: 'Méthyldopa', form: 'comprimé', strength: '250 mg', atc: 'C02AB01', category: 'Antihypertenseur (grossesse)', indicativePriceFcfa: 1500, essential: true, chronic: true },
  { dci: 'Médroxyprogestérone (acétate)', form: 'suspension injectable', strength: '150 mg / mL (trimestriel)', atc: 'G03AC06', category: 'Planification familiale', indicativePriceFcfa: 500, essential: true },
  { dci: 'Lévonorgestrel + éthinylestradiol', form: 'comprimé', strength: '150 µg / 30 µg', atc: 'G03AA07', category: 'Planification familiale', indicativePriceFcfa: 300, essential: true, chronic: true },
  { dci: 'Lévonorgestrel', form: 'comprimé', strength: '1,5 mg (contraception d\'urgence)', atc: 'G03AD01', category: 'Planification familiale', indicativePriceFcfa: 1000, essential: true },

  // ── Neurologie (épilepsie, convulsions) ──
  { dci: 'Phénobarbital', form: 'comprimé', strength: '100 mg', atc: 'N03AA02', category: 'Antiépileptique', indicativePriceFcfa: 500, essential: true, chronic: true },
  { dci: 'Carbamazépine', form: 'comprimé', strength: '200 mg', atc: 'N03AF01', category: 'Antiépileptique', indicativePriceFcfa: 2000, essential: true, chronic: true },
  { dci: 'Valproate de sodium', form: 'comprimé gastro-résistant', strength: '200 mg', atc: 'N03AG01', category: 'Antiépileptique', indicativePriceFcfa: 2500, essential: true, chronic: true },
  { dci: 'Diazépam', form: 'solution injectable', strength: '5 mg/mL, ampoule de 2 mL', atc: 'N05BA01', category: 'Urgence (convulsions)', indicativePriceFcfa: 300, essential: true },

  // ── Santé mentale ──
  { dci: 'Fluoxétine', form: 'gélule', strength: '20 mg', atc: 'N06AB03', category: 'Antidépresseur', indicativePriceFcfa: 2000, essential: true, chronic: true },
  { dci: 'Amitriptyline', form: 'comprimé', strength: '25 mg', atc: 'N06AA09', category: 'Antidépresseur', indicativePriceFcfa: 1000, essential: true, chronic: true },
  { dci: 'Halopéridol', form: 'comprimé', strength: '5 mg', atc: 'N05AD01', category: 'Antipsychotique', indicativePriceFcfa: 1000, essential: true, chronic: true },
  { dci: 'Halopéridol', form: 'solution injectable', strength: '5 mg / mL', atc: 'N05AD01', category: 'Antipsychotique (urgence)', indicativePriceFcfa: 500, essential: true },
  { dci: 'Chlorpromazine', form: 'comprimé', strength: '100 mg', atc: 'N05AA01', category: 'Antipsychotique', indicativePriceFcfa: 1000, essential: true, chronic: true },
  { dci: 'Rispéridone', form: 'comprimé', strength: '2 mg', atc: 'N05AX08', category: 'Antipsychotique', indicativePriceFcfa: 2500, essential: true, chronic: true },

  // ── Respiratoire, allergie, corticoïdes ──
  { dci: 'Salbutamol', form: 'aérosol doseur', strength: '100 µg / dose', atc: 'R03AC02', category: 'Antiasthmatique', indicativePriceFcfa: 3000, essential: true, chronic: true },
  { dci: 'Béclométasone', form: 'aérosol doseur', strength: '100 µg / dose', atc: 'R03BA01', category: 'Antiasthmatique (fond)', indicativePriceFcfa: 4000, essential: true, chronic: true },
  { dci: 'Prednisolone', form: 'comprimé', strength: '5 mg', atc: 'H02AB06', category: 'Corticoïde', indicativePriceFcfa: 500, essential: true },
  { dci: 'Dexaméthasone', form: 'solution injectable', strength: '4 mg / mL', atc: 'H02AB02', category: 'Corticoïde', indicativePriceFcfa: 300, essential: true },
  { dci: 'Épinéphrine (adrénaline)', form: 'solution injectable', strength: '1 mg / mL', atc: 'C01CA24', category: 'Urgence (anaphylaxie)', indicativePriceFcfa: 500, essential: true },
  { dci: 'Chlorphénamine', form: 'comprimé', strength: '4 mg', atc: 'R06AB04', category: 'Antihistaminique', indicativePriceFcfa: 300, essential: true },

  // ── Digestif ──
  { dci: 'Oméprazole', form: 'gélule', strength: '20 mg', atc: 'A02BC01', category: 'Antiulcéreux', indicativePriceFcfa: 1000, essential: true },
  { dci: 'Métoclopramide', form: 'comprimé', strength: '10 mg', atc: 'A03FA01', category: 'Antiémétique', indicativePriceFcfa: 500, essential: true },

  // ── Solutés et antiseptiques ──
  { dci: 'Ringer lactate', form: 'solution pour perfusion', strength: '500 mL', atc: 'B05BB01', category: 'Soluté de remplissage', indicativePriceFcfa: 800, essential: true },
  { dci: 'Chlorure de sodium', form: 'solution pour perfusion', strength: '0,9 %, 500 mL', atc: 'B05BB01', category: 'Soluté de remplissage', indicativePriceFcfa: 700, essential: true },
  { dci: 'Povidone iodée', form: 'solution', strength: '10 %, flacon 125 mL', atc: 'D08AG02', category: 'Antiseptique', indicativePriceFcfa: 1000, essential: true },
];
