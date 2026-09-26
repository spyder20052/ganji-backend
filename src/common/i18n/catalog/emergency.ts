import { defineSms } from '../types';

/** Urgence : la personne, ses proches, les relais et le contrôle a posteriori (bris de glace). */
export const EMERGENCY = defineSms({
  'emergency.cardRead': {
    fr: "Ganji : votre carte d'urgence vient d'être consultée. Si ce n'est pas normal, contactez-nous.",
    en: 'Ganji: your emergency card has just been viewed. If this is not expected, contact us.',
  },
  'emergency.breakGlass': {
    fr: "Ganji : un soignant ({name}) a ouvert votre dossier en urgence. Motif enregistré. Vous pouvez le voir dans votre journal d'accès.",
    en: 'Ganji: a health worker ({name}) opened your record in an emergency. The reason is recorded. You can see it in your access log.',
  },
  'emergency.breakGlass.control': { fr: 'Contrôle : accès bris de glace par {name}', en: 'Audit: break-glass access by {name}' },
  'emergency.sos': { fr: "Ganji SOS : {prenom} a besoin d'aide.", en: 'Ganji SOS: {prenom} needs help.' },
  'emergency.sos.position': { fr: "Ganji SOS : {prenom} a besoin d'aide. Position : {url}", en: 'Ganji SOS: {prenom} needs help. Location: {url}' },
});
