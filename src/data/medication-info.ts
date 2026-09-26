/**
 * Fiches d'information simplifiées sur les médicaments (assistant de traitement).
 *
 * Contenu : résumé en mots simples des notices officielles (RCP / notice patient) et des
 * recommandations OMS pour les médicaments de src/data/medications.ts prescrits dans la
 * démonstration et les plus courants. Chaque phrase reste prudente et renvoie vers un soignant.
 * À FAIRE RELIRE ET VALIDER PAR UN PHARMACIEN avant tout usage réel.
 * L'assistant ne répond qu'à partir de ces fiches et de l'ordonnance du patient : il n'invente
 * jamais d'interaction ni de posologie (« demandez au pharmacien »).
 */

export interface Text2 {
  fr: string;
  en: string;
}

export interface MedicationInfo {
  /** Début de la DCI, sans accents, en minuscules (« artemether + lumefantrine »). */
  match: string;
  name: Text2;
  /** À quoi il sert. */
  purpose: Text2;
  /** Comment le prendre. */
  how: Text2;
  /** Dose oubliée. */
  missed: Text2;
  /** Effets indésirables fréquents. */
  sideEffects: Text2;
  /** Quand appeler un soignant. */
  callDoctor: Text2;
  /** Précaution écrite dans la notice (aliment, boisson…). Jamais une liste d'interactions. */
  caution?: Text2;
}

const NO_DOUBLE_FR = 'Ne prenez jamais deux doses d’un coup pour rattraper.';
const NO_DOUBLE_EN = 'Never take two doses at once to catch up.';

export const MEDICATION_INFO: MedicationInfo[] = [
  {
    match: 'imatinib',
    name: { fr: 'Imatinib', en: 'Imatinib' },
    purpose: {
      fr: 'C’est le traitement de fond de votre maladie du sang : il freine les cellules malades.',
      en: 'It is the long-term treatment of your blood disease: it slows down the sick cells.',
    },
    how: {
      fr: 'Une fois par jour, pendant un repas, avec un grand verre d’eau. Avalez le comprimé entier.',
      en: 'Once a day, with a meal and a large glass of water. Swallow the tablet whole.',
    },
    missed: {
      fr: `Prenez-le dès que vous y pensez, sauf s’il est presque l’heure de la prise suivante : sautez-la alors. ${NO_DOUBLE_FR}`,
      en: `Take it as soon as you remember, unless it is almost time for the next dose: then skip it. ${NO_DOUBLE_EN}`,
    },
    sideEffects: {
      fr: 'Nausées, gonflement autour des yeux ou des chevilles, crampes, diarrhée, fatigue, boutons sur la peau.',
      en: 'Nausea, swelling around the eyes or ankles, cramps, diarrhoea, tiredness, skin rash.',
    },
    callDoctor: {
      fr: 'Appelez votre médecin si vous saignez, avez des bleus sans raison, de la fièvre, prenez du poids très vite ou respirez mal.',
      en: 'Call your doctor if you bleed, bruise for no reason, have a fever, gain weight very fast or breathe badly.',
    },
  },
  {
    match: 'allopurinol',
    name: { fr: 'Allopurinol', en: 'Allopurinol' },
    purpose: {
      fr: 'Il fait baisser l’acide urique dans le sang, pour protéger les reins et les articulations.',
      en: 'It lowers uric acid in the blood, to protect the kidneys and joints.',
    },
    how: {
      fr: 'Une fois par jour, après un repas, avec un grand verre d’eau. Buvez beaucoup d’eau dans la journée.',
      en: 'Once a day, after a meal, with a large glass of water. Drink plenty of water during the day.',
    },
    missed: {
      fr: `Prenez-le dès que vous y pensez, sauf s’il est presque l’heure de la prise suivante. ${NO_DOUBLE_FR}`,
      en: `Take it as soon as you remember, unless it is almost time for the next dose. ${NO_DOUBLE_EN}`,
    },
    sideEffects: { fr: 'Maux de ventre, nausées, diarrhée.', en: 'Stomach ache, nausea, diarrhoea.' },
    callDoctor: {
      fr: 'Arrêtez-le et appelez votre médecin tout de suite en cas de boutons sur la peau, de fièvre ou de plaies dans la bouche.',
      en: 'Stop it and call your doctor at once if you get a skin rash, a fever or sores in the mouth.',
    },
  },
  {
    match: 'paracetamol',
    name: { fr: 'Paracétamol', en: 'Paracetamol' },
    purpose: { fr: 'Il calme la douleur et fait baisser la fièvre.', en: 'It eases pain and brings down fever.' },
    how: {
      fr: 'Laissez au moins 4 à 6 heures entre deux prises. Adulte : pas plus de 3 grammes par jour (6 comprimés de 500 mg), sauf avis du médecin.',
      en: 'Leave at least 4 to 6 hours between two doses. Adults: no more than 3 grams a day (6 tablets of 500 mg) unless your doctor says so.',
    },
    missed: {
      fr: 'Pas de rattrapage : reprenez-le seulement si la douleur ou la fièvre revient, en gardant l’écart de 4 à 6 heures.',
      en: 'No catching up: take it again only if pain or fever comes back, keeping the 4 to 6 hour gap.',
    },
    sideEffects: {
      fr: 'Rarement des boutons sur la peau. Trop de paracétamol abîme le foie.',
      en: 'Rarely a skin rash. Too much paracetamol damages the liver.',
    },
    callDoctor: {
      fr: 'Consultez si la fièvre dure plus de 3 jours ou la douleur plus de 5 jours, ou si vous en avez pris trop.',
      en: 'See a doctor if the fever lasts more than 3 days or the pain more than 5 days, or if you took too much.',
    },
  },
  {
    match: 'amoxicilline',
    name: { fr: 'Amoxicilline', en: 'Amoxicillin' },
    purpose: {
      fr: 'C’est un antibiotique : il tue les microbes (bactéries) qui causent l’infection.',
      en: 'It is an antibiotic: it kills the germs (bacteria) that cause the infection.',
    },
    how: {
      fr: 'À heures régulières, avec ou sans repas. Prenez tout le traitement, même si vous allez mieux.',
      en: 'At regular times, with or without food. Finish the whole course, even if you feel better.',
    },
    missed: {
      fr: `Prenez-la dès que vous y pensez, puis attendez quelques heures avant la suivante. ${NO_DOUBLE_FR}`,
      en: `Take it as soon as you remember, then wait a few hours before the next one. ${NO_DOUBLE_EN}`,
    },
    sideEffects: { fr: 'Diarrhée, nausées, boutons sur la peau.', en: 'Diarrhoea, nausea, skin rash.' },
    callDoctor: {
      fr: 'Gonflement du visage, gêne pour respirer ou boutons partout : c’est une allergie, appelez le 118.',
      en: 'Swollen face, trouble breathing or rash all over: this is an allergy, call 118.',
    },
  },
  {
    match: 'artemether + lumefantrine',
    name: { fr: 'Artéméther + luméfantrine', en: 'Artemether + lumefantrine' },
    purpose: { fr: 'Il soigne le paludisme simple.', en: 'It treats simple malaria.' },
    how: {
      fr: '6 prises en 3 jours : au début, 8 heures après, puis matin et soir les 2 jours suivants. Avec un repas ou du lait.',
      en: '6 doses over 3 days: at the start, 8 hours later, then morning and evening for the next 2 days. With food or milk.',
    },
    missed: {
      fr: `Prenez la dose oubliée dès que possible, puis continuez jusqu’à la fin des 6 prises. ${NO_DOUBLE_FR}`,
      en: `Take the missed dose as soon as possible, then carry on until all 6 doses are taken. ${NO_DOUBLE_EN}`,
    },
    sideEffects: { fr: 'Maux de tête, vertiges, perte d’appétit, fatigue.', en: 'Headache, dizziness, loss of appetite, tiredness.' },
    callDoctor: {
      fr: 'Si vous vomissez dans l’heure qui suit la prise, ou si la fièvre continue après 3 jours, retournez au centre de santé.',
      en: 'If you vomit within an hour of a dose, or if the fever goes on after 3 days, go back to the health centre.',
    },
  },
  {
    match: 'metformine',
    name: { fr: 'Metformine', en: 'Metformin' },
    purpose: { fr: 'Elle aide le corps à mieux utiliser le sucre du sang.', en: 'It helps the body use the sugar in the blood better.' },
    how: {
      fr: 'Pendant ou juste après le repas, pour éviter les maux de ventre.',
      en: 'During or just after a meal, to avoid stomach ache.',
    },
    missed: {
      fr: `Sautez la dose oubliée et prenez la suivante à l’heure habituelle, avec le repas. ${NO_DOUBLE_FR}`,
      en: `Skip the missed dose and take the next one at the usual time, with food. ${NO_DOUBLE_EN}`,
    },
    sideEffects: {
      fr: 'Maux de ventre, diarrhée, goût de métal, surtout au début.',
      en: 'Stomach ache, diarrhoea, metallic taste, mostly at the start.',
    },
    callDoctor: {
      fr: 'Consultez vite en cas de vomissements, de grande fatigue avec douleurs dans les muscles ou de respiration rapide.',
      en: 'See a doctor quickly if you vomit, feel very weak with muscle pain, or breathe fast.',
    },
  },
  {
    match: 'glibenclamide',
    name: { fr: 'Glibenclamide', en: 'Glibenclamide' },
    purpose: { fr: 'Il fait baisser le sucre dans le sang.', en: 'It lowers the sugar in the blood.' },
    how: { fr: 'Juste avant le repas. Ne sautez pas de repas.', en: 'Just before a meal. Do not skip meals.' },
    missed: {
      fr: 'Si le repas est passé, sautez la dose et prenez la suivante normalement. Ne doublez jamais : risque de malaise par manque de sucre.',
      en: 'If the meal is over, skip the dose and take the next one as usual. Never double up: risk of fainting from low sugar.',
    },
    sideEffects: {
      fr: 'Malaise par manque de sucre : sueurs, tremblements, faim, vertiges.',
      en: 'Low-sugar spells: sweating, shaking, hunger, dizziness.',
    },
    callDoctor: {
      fr: 'En cas de malaise, mangez ou buvez tout de suite quelque chose de sucré, puis prévenez le soignant. Si le malaise ne passe pas, appelez le 118.',
      en: 'If you feel faint, eat or drink something sweet at once, then tell your health worker. If it does not pass, call 118.',
    },
  },
  {
    match: 'amlodipine',
    name: { fr: 'Amlodipine', en: 'Amlodipine' },
    purpose: { fr: 'Elle fait baisser la tension artérielle.', en: 'It lowers blood pressure.' },
    how: { fr: 'Une fois par jour, à la même heure, avec ou sans repas.', en: 'Once a day, at the same time, with or without food.' },
    missed: {
      fr: `Sautez la dose oubliée et prenez la suivante à l’heure habituelle. ${NO_DOUBLE_FR}`,
      en: `Skip the missed dose and take the next one at the usual time. ${NO_DOUBLE_EN}`,
    },
    sideEffects: { fr: 'Chevilles gonflées, maux de tête, bouffées de chaleur.', en: 'Swollen ankles, headache, hot flushes.' },
    callDoctor: {
      fr: 'Consultez en cas de vertiges forts, de malaise ou de cœur qui bat très vite.',
      en: 'See a doctor if you have strong dizziness, faint, or your heart beats very fast.',
    },
  },
  {
    match: 'hydroxyuree',
    name: { fr: 'Hydroxyurée', en: 'Hydroxyurea' },
    purpose: {
      fr: 'Traitement de fond de certaines maladies du sang, comme la drépanocytose : il réduit les crises.',
      en: 'Long-term treatment for some blood diseases, such as sickle cell disease: it reduces crises.',
    },
    how: {
      fr: 'Une fois par jour, à la même heure. Avalez la gélule entière avec de l’eau, sans l’ouvrir. Lavez-vous les mains après.',
      en: 'Once a day, at the same time. Swallow the capsule whole with water, without opening it. Wash your hands afterwards.',
    },
    missed: {
      fr: `Ne rattrapez pas : prenez la dose habituelle le lendemain à l’heure prévue. ${NO_DOUBLE_FR}`,
      en: `Do not catch up: take your usual dose the next day at the planned time. ${NO_DOUBLE_EN}`,
    },
    sideEffects: { fr: 'Nausées, fatigue, peau ou ongles plus foncés.', en: 'Nausea, tiredness, darker skin or nails.' },
    callDoctor: {
      fr: 'Appelez votre médecin en cas de fièvre, de saignement, de bleus ou de grande fatigue : il faut vérifier la prise de sang.',
      en: 'Call your doctor if you have a fever, bleeding, bruises or great tiredness: your blood test must be checked.',
    },
  },
  {
    match: 'acide folique',
    name: { fr: 'Acide folique', en: 'Folic acid' },
    purpose: { fr: 'Vitamine qui aide à fabriquer les globules rouges.', en: 'A vitamin that helps make red blood cells.' },
    how: { fr: 'Une fois par jour, avec un verre d’eau.', en: 'Once a day, with a glass of water.' },
    missed: {
      fr: `Prenez-le dès que vous y pensez, ou le lendemain à l’heure habituelle. ${NO_DOUBLE_FR}`,
      en: `Take it when you remember, or the next day at the usual time. ${NO_DOUBLE_EN}`,
    },
    sideEffects: { fr: 'Très rares : nausées.', en: 'Very rare: nausea.' },
    callDoctor: {
      fr: 'Consultez si vous êtes très pâle, essoufflé ou très fatigué.',
      en: 'See a doctor if you are very pale, out of breath or very tired.',
    },
  },
  {
    match: 'sulfate ferreux',
    name: { fr: 'Fer + acide folique', en: 'Iron + folic acid' },
    purpose: {
      fr: 'Fer et vitamine contre l’anémie, surtout pendant la grossesse.',
      en: 'Iron and a vitamin against anaemia, especially during pregnancy.',
    },
    how: {
      fr: 'Une fois par jour, de préférence entre les repas, avec de l’eau. Pas avec du thé ou du café.',
      en: 'Once a day, ideally between meals, with water. Not with tea or coffee.',
    },
    missed: {
      fr: `Prenez-le le lendemain à l’heure habituelle. ${NO_DOUBLE_FR}`,
      en: `Take it the next day at the usual time. ${NO_DOUBLE_EN}`,
    },
    sideEffects: { fr: 'Selles noires (c’est normal), constipation, maux de ventre.', en: 'Black stools (this is normal), constipation, stomach ache.' },
    callDoctor: {
      fr: 'Consultez si vous êtes très essoufflée, très pâle, ou si les maux de ventre sont forts.',
      en: 'See a health worker if you are very breathless, very pale, or have strong stomach pain.',
    },
  },
  {
    match: 'ibuprofene',
    name: { fr: 'Ibuprofène', en: 'Ibuprofen' },
    purpose: { fr: 'Il calme la douleur, l’inflammation et la fièvre.', en: 'It eases pain, inflammation and fever.' },
    how: {
      fr: 'Pendant un repas, avec un grand verre d’eau. Au moins 6 heures entre deux prises.',
      en: 'With a meal and a large glass of water. At least 6 hours between two doses.',
    },
    missed: {
      fr: 'Pas de rattrapage : reprenez-le seulement si la douleur revient.',
      en: 'No catching up: take it again only if the pain comes back.',
    },
    sideEffects: { fr: 'Maux d’estomac, nausées.', en: 'Stomach ache, nausea.' },
    callDoctor: {
      fr: 'Arrêtez et consultez en cas de selles noires, de vomissements de sang ou de boutons sur la peau.',
      en: 'Stop and see a doctor if you have black stools, vomit blood or get a skin rash.',
    },
    caution: {
      fr: 'Pas d’ibuprofène pendant la grossesse sans avis médical.',
      en: 'No ibuprofen during pregnancy without medical advice.',
    },
  },
  {
    match: 'cotrimoxazole',
    name: { fr: 'Cotrimoxazole', en: 'Co-trimoxazole' },
    purpose: {
      fr: 'Antibiotique qui soigne ou évite certaines infections.',
      en: 'An antibiotic that treats or prevents some infections.',
    },
    how: { fr: 'À heures régulières, avec un grand verre d’eau. Buvez beaucoup.', en: 'At regular times, with a large glass of water. Drink plenty.' },
    missed: {
      fr: `Prenez-le dès que vous y pensez, sauf s’il est presque l’heure de la prise suivante. ${NO_DOUBLE_FR}`,
      en: `Take it as soon as you remember, unless it is almost time for the next dose. ${NO_DOUBLE_EN}`,
    },
    sideEffects: { fr: 'Nausées, perte d’appétit, boutons sur la peau.', en: 'Nausea, loss of appetite, skin rash.' },
    callDoctor: {
      fr: 'Arrêtez et consultez tout de suite en cas de boutons, de cloques sur la peau ou de plaies dans la bouche.',
      en: 'Stop and see a doctor at once if you get a rash, skin blisters or sores in the mouth.',
    },
  },
  {
    match: 'metronidazole',
    name: { fr: 'Métronidazole', en: 'Metronidazole' },
    purpose: {
      fr: 'Il soigne certaines infections (microbes et parasites de l’intestin).',
      en: 'It treats some infections (germs and gut parasites).',
    },
    how: { fr: 'Pendant ou après le repas. Prenez tout le traitement.', en: 'During or after a meal. Finish the whole course.' },
    missed: {
      fr: `Prenez-le dès que vous y pensez, sauf s’il est presque l’heure de la prise suivante. ${NO_DOUBLE_FR}`,
      en: `Take it as soon as you remember, unless it is almost time for the next dose. ${NO_DOUBLE_EN}`,
    },
    sideEffects: { fr: 'Goût de métal, nausées, urines foncées.', en: 'Metallic taste, nausea, dark urine.' },
    callDoctor: {
      fr: 'Consultez en cas de fourmillements dans les mains ou les pieds, ou de boutons sur la peau.',
      en: 'See a doctor if you feel tingling in your hands or feet, or get a skin rash.',
    },
    caution: { fr: 'Pas d’alcool pendant tout le traitement.', en: 'No alcohol during the whole treatment.' },
  },
  {
    match: 'omeprazole',
    name: { fr: 'Oméprazole', en: 'Omeprazole' },
    purpose: { fr: 'Il protège l’estomac en réduisant l’acidité.', en: 'It protects the stomach by reducing acid.' },
    how: { fr: 'Le matin, avant le petit-déjeuner. Avalez la gélule entière.', en: 'In the morning, before breakfast. Swallow the capsule whole.' },
    missed: {
      fr: `Prenez-la dès que vous y pensez, sauf s’il est presque l’heure de la prise suivante. ${NO_DOUBLE_FR}`,
      en: `Take it as soon as you remember, unless it is almost time for the next dose. ${NO_DOUBLE_EN}`,
    },
    sideEffects: { fr: 'Maux de tête, maux de ventre, diarrhée.', en: 'Headache, stomach ache, diarrhoea.' },
    callDoctor: {
      fr: 'Consultez si vous vomissez du sang, avez des selles noires ou maigrissez sans raison.',
      en: 'See a doctor if you vomit blood, have black stools or lose weight for no reason.',
    },
  },
  {
    match: 'hydrochlorothiazide',
    name: { fr: 'Hydrochlorothiazide', en: 'Hydrochlorothiazide' },
    purpose: { fr: 'Il fait baisser la tension en faisant uriner davantage.', en: 'It lowers blood pressure by making you pass more urine.' },
    how: { fr: 'Le matin, pour ne pas vous lever la nuit pour uriner.', en: 'In the morning, so you do not get up at night to pass urine.' },
    missed: {
      fr: `Prenez-le dès que vous y pensez dans la matinée, sinon attendez le lendemain. ${NO_DOUBLE_FR}`,
      en: `Take it when you remember in the morning, otherwise wait until the next day. ${NO_DOUBLE_EN}`,
    },
    sideEffects: { fr: 'Envie d’uriner plus souvent, vertiges en se levant, crampes.', en: 'Passing urine more often, dizziness when standing up, cramps.' },
    callDoctor: {
      fr: 'Consultez en cas de grande faiblesse, de crampes fortes ou de malaise.',
      en: 'See a doctor if you feel very weak, have strong cramps or faint.',
    },
  },
  {
    match: 'phenoxymethylpenicilline',
    name: { fr: 'Pénicilline V', en: 'Penicillin V' },
    purpose: {
      fr: 'Antibiotique donné chaque jour pour éviter les infections graves chez l’enfant drépanocytaire.',
      en: 'An antibiotic given every day to prevent serious infections in children with sickle cell disease.',
    },
    how: {
      fr: 'Deux fois par jour, matin et soir, à heures régulières, de préférence en dehors des repas.',
      en: 'Twice a day, morning and evening, at regular times, ideally away from meals.',
    },
    missed: {
      fr: `Donnez-la dès que vous y pensez, sauf s’il est presque l’heure de la prise suivante. ${NO_DOUBLE_FR}`,
      en: `Give it as soon as you remember, unless it is almost time for the next dose. ${NO_DOUBLE_EN}`,
    },
    sideEffects: { fr: 'Nausées, diarrhée.', en: 'Nausea, diarrhoea.' },
    callDoctor: {
      fr: 'Fièvre chez un enfant drépanocytaire : allez au centre de santé le jour même. Visage gonflé ou gêne pour respirer : appelez le 118.',
      en: 'Fever in a child with sickle cell disease: go to the health centre the same day. Swollen face or trouble breathing: call 118.',
    },
  },
  {
    match: 'salbutamol',
    name: { fr: 'Salbutamol', en: 'Salbutamol' },
    purpose: { fr: 'Il ouvre les bronches et soulage vite la crise d’asthme.', en: 'It opens the airways and quickly eases an asthma attack.' },
    how: {
      fr: 'Au moment de la gêne : secouez, soufflez, puis inspirez lentement en appuyant une fois. Une deuxième bouffée si besoin.',
      en: 'When you feel short of breath: shake, breathe out, then breathe in slowly while pressing once. A second puff if needed.',
    },
    missed: {
      fr: 'Il se prend en cas de gêne, pas à heure fixe : rien à rattraper.',
      en: 'It is taken when you feel short of breath, not at a set time: nothing to catch up.',
    },
    sideEffects: { fr: 'Tremblements, cœur qui bat vite, maux de tête.', en: 'Shaking, fast heartbeat, headache.' },
    callDoctor: {
      fr: 'Si la gêne ne passe pas après les bouffées, ou si les lèvres bleuissent, appelez le 118.',
      en: 'If the breathlessness does not pass after the puffs, or the lips turn blue, call 118.',
    },
  },
  {
    match: 'sels de rehydratation',
    name: { fr: 'Sels de réhydratation orale (SRO)', en: 'Oral rehydration salts (ORS)' },
    purpose: { fr: 'Ils remplacent l’eau et le sel perdus par la diarrhée.', en: 'They replace the water and salt lost through diarrhoea.' },
    how: {
      fr: 'Un sachet dans 1 litre d’eau potable. Faites boire par petites gorgées après chaque selle liquide. Jetez la solution après 24 heures.',
      en: 'One sachet in 1 litre of safe water. Give small sips after each loose stool. Throw the solution away after 24 hours.',
    },
    missed: {
      fr: 'Pas d’horaire fixe : continuez à faire boire tant que la diarrhée dure.',
      en: 'No set time: keep giving it to drink as long as the diarrhoea lasts.',
    },
    sideEffects: {
      fr: 'Parfois des vomissements : attendez 10 minutes, puis reprenez plus lentement.',
      en: 'Sometimes vomiting: wait 10 minutes, then start again more slowly.',
    },
    callDoctor: {
      fr: 'Allez vite au centre de santé si l’enfant ne boit plus, vomit tout, a du sang dans les selles ou dort beaucoup trop.',
      en: 'Go to the health centre quickly if the child stops drinking, vomits everything, has blood in the stools or is very sleepy.',
    },
  },
  {
    match: 'zinc',
    name: { fr: 'Zinc', en: 'Zinc' },
    purpose: { fr: 'Il aide l’enfant à guérir plus vite de la diarrhée.', en: 'It helps the child recover faster from diarrhoea.' },
    how: {
      fr: 'Une fois par jour pendant 10 à 14 jours, dissous dans un peu d’eau ou de lait maternel, même si la diarrhée s’arrête.',
      en: 'Once a day for 10 to 14 days, dissolved in a little water or breast milk, even if the diarrhoea stops.',
    },
    missed: {
      fr: `Donnez-le dès que vous y pensez, puis continuez normalement le lendemain. ${NO_DOUBLE_FR}`,
      en: `Give it as soon as you remember, then carry on as usual the next day. ${NO_DOUBLE_EN}`,
    },
    sideEffects: { fr: 'Parfois des vomissements juste après la prise.', en: 'Sometimes vomiting just after the dose.' },
    callDoctor: {
      fr: 'Allez vite au centre de santé si l’enfant ne boit plus, vomit tout ou a du sang dans les selles.',
      en: 'Go to the health centre quickly if the child stops drinking, vomits everything or has blood in the stools.',
    },
  },
];

function fold(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Fiche d'un médicament d'après sa DCI (la correspondance la plus longue l'emporte). */
export function infoFor(dci: string): MedicationInfo | null {
  const d = fold(dci);
  let best: MedicationInfo | null = null;
  for (const info of MEDICATION_INFO) {
    if (d.startsWith(info.match) && (!best || info.match.length > best.match.length)) best = info;
  }
  return best;
}
