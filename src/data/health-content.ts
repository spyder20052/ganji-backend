/**
 * Messages audio clés (SMS vocaux / IVR / lecture dans l'application).
 *
 * Textes de référence en français et en anglais ; les versions en langues
 * nationales sont enregistrées par un locuteur natif (voir
 * alafia-frontend/docs/ENREGISTREMENTS.md). `langsTarget` indique les langues
 * visées pour chaque message (fon et bariba en priorité) : ce n'est pas la
 * liste des fichiers déjà livrés.
 *
 * Variables : {prenom} {date} {heure} {lieu} {vaccin} {medicament} {groupe}
 * {numero} {semaines}
 */

export type NationalLanguage = 'fon' | 'yoruba' | 'bariba' | 'dendi';

export interface AudioMessageData {
  key: string;
  fr: string;
  en: string;
  langsTarget: NationalLanguage[];
}

export const AUDIO_MESSAGES: AudioMessageData[] = [
  {
    key: 'welcome',
    fr: 'Bienvenue sur Alafia. Votre santé, près de chez vous.',
    en: 'Welcome to Alafia. Your health, close to home.',
    langsTarget: ['fon', 'bariba', 'yoruba', 'dendi'],
  },
  {
    key: 'consent.request',
    fr: 'Acceptez-vous qu\'un agent de santé consulte votre dossier ? Répondez oui ou non.',
    en: 'Do you agree to let a health worker view your record? Answer yes or no.',
    langsTarget: ['fon', 'bariba'],
  },
  {
    key: 'consent.granted',
    fr: 'Merci. Vous avez autorisé {lieu} à consulter votre dossier. Vous pouvez retirer cet accord à tout moment.',
    en: 'Thank you. You have allowed {lieu} to view your record. You can withdraw this consent at any time.',
    langsTarget: ['fon', 'bariba'],
  },
  {
    key: 'consent.revoked',
    fr: 'Votre accord a été retiré. Votre dossier n\'est plus partagé avec {lieu}.',
    en: 'Your consent has been withdrawn. Your record is no longer shared with {lieu}.',
    langsTarget: ['fon', 'bariba'],
  },
  {
    key: 'reminder.cpn',
    fr: 'Bonjour {prenom}. Votre consultation prénatale est prévue le {date} à {heure} à {lieu}. Apportez votre carnet.',
    en: 'Hello {prenom}. Your antenatal visit is on {date} at {heure} at {lieu}. Please bring your health booklet.',
    langsTarget: ['fon', 'bariba', 'yoruba'],
  },
  {
    key: 'reminder.cpn.missed',
    fr: 'Vous n\'êtes pas venue à votre consultation prénatale. Passez à {lieu} dès que possible.',
    en: 'You missed your antenatal visit. Please go to {lieu} as soon as possible.',
    langsTarget: ['fon', 'bariba'],
  },
  {
    key: 'reminder.vaccine',
    fr: 'Votre enfant doit recevoir le vaccin {vaccin} le {date} à {lieu}. La vaccination est gratuite.',
    en: 'Your child is due for the {vaccin} vaccine on {date} at {lieu}. Vaccination is free.',
    langsTarget: ['fon', 'bariba', 'yoruba', 'dendi'],
  },
  {
    key: 'reminder.vaccine.missed',
    fr: 'Le vaccin {vaccin} de votre enfant est en retard. Il n\'est pas trop tard : allez à {lieu}.',
    en: 'Your child\'s {vaccin} vaccine is overdue. It is not too late: go to {lieu}.',
    langsTarget: ['fon', 'bariba'],
  },
  {
    key: 'reminder.medication',
    fr: 'C\'est l\'heure de prendre votre {medicament}. Ne l\'arrêtez pas sans avis du soignant.',
    en: 'It is time to take your {medicament}. Do not stop it without advice from your health worker.',
    langsTarget: ['fon', 'bariba'],
  },
  {
    key: 'reminder.refill',
    fr: 'Votre traitement {medicament} se termine bientôt. Pensez à le renouveler avant le {date}.',
    en: 'Your {medicament} treatment will run out soon. Remember to refill it before {date}.',
    langsTarget: ['fon', 'bariba'],
  },
  {
    key: 'donor.call',
    fr: 'Appel au don de sang : un patient a besoin du groupe {groupe} à {lieu}. Pouvez-vous venir aujourd\'hui ?',
    en: 'Blood donation call: a patient needs blood group {groupe} at {lieu}. Can you come today?',
    langsTarget: ['fon', 'bariba', 'yoruba', 'dendi'],
  },
  {
    key: 'donor.found',
    fr: 'Bonne nouvelle : un donneur compatible a été trouvé. Présentez-vous à {lieu}.',
    en: 'Good news: a compatible donor has been found. Please go to {lieu}.',
    langsTarget: ['fon', 'bariba'],
  },
  {
    key: 'donor.thanks',
    fr: 'Merci pour votre don de sang. Vous avez peut-être sauvé une vie. Prochain don possible après le {date}.',
    en: 'Thank you for donating blood. You may have saved a life. You can donate again after {date}.',
    langsTarget: ['fon', 'bariba'],
  },
  {
    key: 'advice.emergency',
    fr: 'Signe de danger. Allez tout de suite aux urgences de l\'hôpital le plus proche : {lieu}.',
    en: 'Danger sign. Go immediately to the emergency department of the nearest hospital: {lieu}.',
    langsTarget: ['fon', 'bariba', 'yoruba', 'dendi'],
  },
  {
    key: 'advice.fever',
    fr: 'En cas de fièvre, faites le test rapide du paludisme au centre de santé avant de prendre un traitement.',
    en: 'If there is fever, get a rapid malaria test at the health centre before taking any treatment.',
    langsTarget: ['fon', 'bariba', 'yoruba', 'dendi'],
  },
  {
    key: 'advice.diarrhea',
    fr: 'En cas de diarrhée, donnez des SRO et du zinc à l\'enfant, et continuez à le nourrir.',
    en: 'In case of diarrhoea, give the child ORS and zinc, and keep feeding them.',
    langsTarget: ['fon', 'bariba'],
  },
  {
    key: 'advice.pregnancy.danger',
    fr: 'Saignement, maux de tête violents, perte des eaux ou bébé qui ne bouge plus : allez vite à la maternité.',
    en: 'Bleeding, severe headache, waters breaking or baby not moving: go to the maternity ward quickly.',
    langsTarget: ['fon', 'bariba', 'yoruba', 'dendi'],
  },
  {
    key: 'advice.bednet',
    fr: 'Dormez chaque nuit sous une moustiquaire imprégnée, surtout les enfants et les femmes enceintes.',
    en: 'Sleep under an insecticide-treated net every night, especially children and pregnant women.',
    langsTarget: ['fon', 'bariba'],
  },
  {
    key: 'appointment.confirmed',
    fr: 'Votre rendez-vous est confirmé le {date} à {heure} à {lieu}.',
    en: 'Your appointment is confirmed on {date} at {heure} at {lieu}.',
    langsTarget: ['fon', 'bariba'],
  },
  {
    key: 'pharmacy.on_duty',
    fr: 'Pharmacie de garde la plus proche : {lieu}. Numéro : {numero}.',
    en: 'Nearest on-duty pharmacy: {lieu}. Phone: {numero}.',
    langsTarget: ['fon', 'bariba'],
  },
  {
    key: 'triage.disclaimer',
    fr: 'Ce service vous oriente mais ne remplace pas un soignant. En cas de doute, consultez.',
    en: 'This service guides you but does not replace a health worker. If in doubt, see one.',
    langsTarget: ['fon', 'bariba', 'yoruba', 'dendi'],
  },
  {
    key: 'pregnancy.week',
    fr: 'Vous êtes à {semaines} semaines de grossesse. Pensez au fer-acide folique chaque jour.',
    en: 'You are {semaines} weeks pregnant. Remember to take iron and folic acid every day.',
    langsTarget: ['fon', 'bariba'],
  },
];
