import { defineSms } from '../types';

/** Morceaux de dates glissés dans les textes (le jour et l'heure sont formatés selon la langue, voir dates.ts). */
export const COMMON = defineSms({
  'date.at': { fr: '{day} à {time}', en: '{day} at {time}' },
  'date.dayPart': { fr: '{day}, {part}', en: '{day}, {part}' },
  'date.morning': { fr: 'le matin', en: 'morning' },
  'date.afternoon': { fr: 'l’après-midi', en: 'afternoon' },
});
