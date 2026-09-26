import { defineSms } from '../types';

// SMS : jamais le nom d'un médicament, seulement « votre commande », une référence, un code.
export const ORDERS = defineSms({
  'order.received': {
    fr: 'Ganji : commande {ref} envoyée à {pharmacy}. Code de remise : {code}. Donnez-le seulement quand vous recevez la commande.',
    en: 'Ganji: order {ref} sent to {pharmacy}. Handover code: {code}. Give it only when you receive the order.',
  },
  'order.paid': {
    fr: 'Payé : {amount} FCFA ({provider}, reçu {receipt}).',
    en: 'Paid: {amount} FCFA ({provider}, receipt {receipt}).',
  },
  'order.accepted': {
    fr: 'Ganji : {pharmacy} a accepté votre commande {ref}. Elle est en préparation.',
    en: 'Ganji: {pharmacy} accepted your order {ref}. It is being prepared.',
  },
  'order.ready.delivery': {
    fr: 'Ganji : votre commande {ref} est prête. Le livreur part bientôt.',
    en: 'Ganji: your order {ref} is ready. The courier leaves soon.',
  },
  'order.ready.pickup': {
    fr: 'Ganji : votre commande {ref} est prête chez {pharmacy}. Venez avec le code {code}.',
    en: 'Ganji: your order {ref} is ready at {pharmacy}. Come with the code {code}.',
  },
  'order.dispatched': {
    fr: 'Ganji : votre commande {ref} est en route. Livreur : {courier}, {courierPhone}. Donnez-lui le code {code} à la remise.',
    en: 'Ganji: your order {ref} is on its way. Courier: {courier}, {courierPhone}. Give the code {code} on delivery.',
  },
  'order.cash': {
    fr: 'Prévoyez {amount} FCFA en espèces.',
    en: 'Have {amount} FCFA in cash ready.',
  },
  'order.delivered': {
    fr: 'Ganji : commande {ref} remise. Reçu {receipt}. Merci !',
    en: 'Ganji: order {ref} handed over. Receipt {receipt}. Thank you!',
  },
  'order.refused': {
    fr: 'Ganji : {pharmacy} ne peut pas servir votre commande {ref}. Ouvrez Ganji pour voir pourquoi et commander ailleurs.',
    en: 'Ganji: {pharmacy} cannot fill your order {ref}. Open Ganji to see why and order elsewhere.',
  },
  'order.cancelled': {
    fr: 'Ganji : commande {ref} annulée.',
    en: 'Ganji: order {ref} cancelled.',
  },
  'order.expired': {
    fr: 'Ganji : {pharmacy} n’a pas répondu, commande {ref} annulée. Ouvrez Ganji pour commander ailleurs.',
    en: 'Ganji: {pharmacy} did not answer, order {ref} cancelled. Open Ganji to order elsewhere.',
  },
  'order.refunded': {
    fr: '{amount} FCFA remboursés sur votre compte mobile money.',
    en: '{amount} FCFA refunded to your mobile money account.',
  },
  'order.received.family': {
    fr: 'Ganji : commande {ref} envoyée à {pharmacy}.',
    en: 'Ganji: order {ref} sent to {pharmacy}.',
  },
  'order.ready.pickup.family': {
    fr: 'Ganji : la commande {ref} est prête chez {pharmacy}.',
    en: 'Ganji: order {ref} is ready at {pharmacy}.',
  },
  'order.dispatched.family': {
    fr: 'Ganji : la commande {ref} est en route. Livreur : {courier}, {courierPhone}.',
    en: 'Ganji: order {ref} is on its way. Courier: {courier}, {courierPhone}.',
  },
  'order.failed': {
    fr: 'Ganji : la commande {ref} n’a pas pu être remise. Ouvrez Ganji pour voir pourquoi et commander à nouveau.',
    en: 'Ganji: order {ref} could not be handed over. Open Ganji to see why and order again.',
  },
  'order.newcode': {
    fr: 'Ganji : nouveau code de remise pour la commande {ref} : {code}. L’ancien ne marche plus.',
    en: 'Ganji: new handover code for order {ref}: {code}. The old one no longer works.',
  },
  'order.pharmacy.reminder': {
    fr: 'Ganji : la commande {ref} attend votre réponse depuis plus de 30 min. Ouvrez l’espace pharmacie.',
    en: 'Ganji: order {ref} has been waiting for your answer for over 30 min. Open the pharmacy space.',
  },

  // Notifications de la famille (cloche) : le texte « noCode » va aux aidants qui ne reçoivent pas le code de remise.
  'order.n.received.title': { fr: 'Commande envoyée', en: 'Order sent' },
  'order.n.received.body': { fr: '{pharmacy} a reçu votre commande {ref}. Code de remise : {code}.', en: '{pharmacy} received your order {ref}. Handover code: {code}.' },
  'order.n.received.noCode': { fr: '{pharmacy} a reçu la commande {ref}.', en: '{pharmacy} received order {ref}.' },
  'order.n.accepted.title': { fr: 'Commande acceptée', en: 'Order accepted' },
  'order.n.accepted.body': { fr: '{pharmacy} prépare votre commande {ref}.', en: '{pharmacy} is preparing your order {ref}.' },
  'order.n.readyDelivery.title': { fr: 'Commande prête', en: 'Order ready' },
  'order.n.readyDelivery.body': { fr: 'Votre commande {ref} part bientôt.', en: 'Your order {ref} leaves soon.' },
  'order.n.readyPickup.title': { fr: 'Commande prête', en: 'Order ready' },
  'order.n.readyPickup.body': { fr: 'Votre commande {ref} vous attend chez {pharmacy}. Code : {code}.', en: 'Your order {ref} is waiting at {pharmacy}. Code: {code}.' },
  'order.n.readyPickup.noCode': { fr: 'La commande {ref} attend chez {pharmacy}.', en: 'Order {ref} is waiting at {pharmacy}.' },
  'order.n.dispatched.title': { fr: 'Commande en route', en: 'Order on its way' },
  'order.n.dispatched.body': { fr: 'Livreur : {courier}, {courierPhone}. Code à donner : {code}.', en: 'Courier: {courier}, {courierPhone}. Code to give: {code}.' },
  'order.n.dispatched.noCode': { fr: 'Livreur : {courier}, {courierPhone}.', en: 'Courier: {courier}, {courierPhone}.' },
  'order.n.newCode.title': { fr: 'Nouveau code de remise', en: 'New handover code' },
  'order.n.newCode.body': { fr: 'Commande {ref} : votre nouveau code est {code}.', en: 'Order {ref}: your new code is {code}.' },
  'order.n.delivered.title': { fr: 'Commande remise', en: 'Order handed over' },
  'order.n.delivered.body': { fr: 'Commande {ref} remise. Reçu {receipt}.', en: 'Order {ref} handed over. Receipt {receipt}.' },
  'order.n.refused.title': { fr: 'Commande refusée', en: 'Order declined' },
  'order.n.refused.body': { fr: '{pharmacy} : {reason}.', en: '{pharmacy}: {reason}.' },
  'order.n.failed.title': { fr: 'Commande non remise', en: 'Order not handed over' },
  'order.n.failed.body': { fr: '{pharmacy} : {reason}. Vous pouvez commander à nouveau.', en: '{pharmacy}: {reason}. You can order again.' },
  'order.n.cancelled.title': { fr: 'Commande annulée', en: 'Order cancelled' },
  'order.n.cancelled.body': { fr: 'Commande {ref} annulée.', en: 'Order {ref} cancelled.' },
  'order.n.expired.title': { fr: 'Commande annulée', en: 'Order cancelled' },
  'order.n.expired.body': { fr: '{pharmacy} n’a pas répondu à temps.', en: '{pharmacy} did not answer in time.' },
  /** Motif de Ganji quand la commande n'est pas remise à temps (les autres motifs sont écrits par la pharmacie). */
  'order.reason.late': { fr: 'Commande non remise dans les délais', en: 'Order not handed over in time' },

  // Notifications de la pharmacie.
  'order.items.one': { fr: '{n} médicament', en: '{n} medicine' },
  'order.items.other': { fr: '{n} médicaments', en: '{n} medicines' },
  'order.mode.LIVRAISON': { fr: 'livraison', en: 'delivery' },
  'order.mode.RETRAIT': { fr: 'retrait', en: 'pickup' },
  'order.n.staff.new.title': { fr: 'Nouvelle commande {ref}', en: 'New order {ref}' },
  'order.n.staff.new.body': { fr: '{patient} · {items} · {mode} · {total} FCFA', en: '{patient} · {items} · {mode} · {total} FCFA' },
  'order.n.staff.new.bodyPaid': { fr: '{patient} · {items} · {mode} · {total} FCFA (payée)', en: '{patient} · {items} · {mode} · {total} FCFA (paid)' },
  'order.n.staff.cancelled.title': { fr: 'Commande {ref} annulée', en: 'Order {ref} cancelled' },
  'order.n.staff.cancelled.body': { fr: 'Annulée par le patient avant votre réponse.', en: 'Cancelled by the patient before your answer.' },
  'order.n.staff.expired.title': { fr: 'Commande {ref} annulée', en: 'Order {ref} cancelled' },
  'order.n.staff.expired.body': { fr: 'Sans réponse de votre part : le patient a été prévenu.', en: 'No answer from you: the patient has been told.' },
  'order.n.staff.waiting.title': { fr: 'Commande {ref} en attente', en: 'Order {ref} waiting' },
  'order.n.staff.waiting.body': { fr: 'Un patient attend votre réponse depuis plus de 30 min.', en: 'A patient has been waiting for your answer for over 30 min.' },
  'order.n.staff.closed.title': { fr: 'Commande {ref} clôturée', en: 'Order {ref} closed' },
  'order.n.staff.closed.body': { fr: 'Non remise dans les délais : stock rendu, patient prévenu.', en: 'Not handed over in time: stock returned, patient told.' },
});
