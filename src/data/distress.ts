/**
 * Mots de détresse (écoute psychologique) : suicide, envie de mourir, automutilation, violences subies.
 * Un seul motif suffit à marquer la conversation urgente, à afficher la consigne de sécurité et à
 * prévenir toute la cellule d'écoute. Tous les lexiques sont appliqués à chaque message, quelle que
 * soit la langue de l'interface : on écrit souvent dans une autre langue que celle de l'application.
 *
 * Mieux vaut une alerte de trop qu'une détresse manquée : les motifs sont larges, sauf quand un mot
 * courant change de sens (« j'ai peur de mourir » chez un patient atteint d'une maladie grave n'est pas
 * une idée suicidaire ; « violon » n'est pas « viol »).
 *
 * Le texte est d'abord « plié » (foldText) : minuscules, décomposition NFD puis suppression des
 * diacritiques, donc des accents français comme des tons et points souscrits du yoruba et du fon
 * (« mo fẹ́ kú » → « mo fe ku »), apostrophes remplacées par des espaces. Les motifs s'écrivent donc
 * sans accent ni ton. Listes à faire relire par la cellule d'écoute et, pour les langues nationales,
 * par des locuteurs natifs (docs/LANGUES.md).
 */
export type DistressKind = 'SUICIDE' | 'AUTOMUTILATION' | 'VIOLENCE';
export type DistressLang = 'fr' | 'en' | 'fon' | 'yo' | 'bba' | 'ddn';
export interface DistressPattern {
  kind: DistressKind;
  re: RegExp;
}

// « Je vais mourir » ou « I'm going to die » disent souvent la peur (maladie grave), pas l'envie : exclus.
const WANT_FR = String.raw`(?:je veux|je voudrais|j ai envie de|envie de|je prefere|je prefererais|j aimerais)`;
const WANT_EN = String.raw`(?:i want to|i wanna|want to|wanna)`;

const FR: DistressPattern[] = [
  // Suicide, envie de mourir
  { kind: 'SUICIDE', re: /\bsuicid\w*/ },
  { kind: 'SUICIDE', re: /\bme (?:tuer|suicider|donner la mort|foutre en l air)\b/ },
  { kind: 'SUICIDE', re: /\ben finir\b/ },
  { kind: 'SUICIDE', re: /\bmettre fin a (?:mes jours|ma vie|tout)\b/ },
  { kind: 'SUICIDE', re: new RegExp(String.raw`${WANT_FR} (?:mourir|disparaitre|partir pour toujours)\b`) },
  { kind: 'SUICIDE', re: /\b(?:plus|pas|aucune) (?:envie|raison|force) de vivre\b/ },
  { kind: 'SUICIDE', re: /\bmarre de (?:vivre|la vie)\b/ },
  { kind: 'SUICIDE', re: /\ba quoi bon vivre\b/ },
  { kind: 'SUICIDE', re: /\bne (?:plus|jamais) me reveiller\b/ },
  { kind: 'SUICIDE', re: /\bmieux (?:sans moi|mort|morte)\b/ },
  { kind: 'SUICIDE', re: /\bdisparaitre pour toujours\b/ },
  // Automutilation
  { kind: 'AUTOMUTILATION', re: /\bme (?:faire du mal|blesser|scarifier|taillader|bruler|pendre|jeter sous|jeter du haut|couper les veines|couper les poignets)\b/ },
  { kind: 'AUTOMUTILATION', re: /\b(?:scarif|automutil)\w*/ },
  { kind: 'AUTOMUTILATION', re: /\bavaler (?:tous |toutes )?(?:mes |les |des )?(?:medicaments|cachets|comprimes)\b/ },
  { kind: 'AUTOMUTILATION', re: /\boverdose\w*/ },
  // Violences subies
  { kind: 'VIOLENCE', re: /\b(?:il|elle|ils|elles|on|mon mari|ma femme|mon pere|ma mere|mon oncle|mon patron) me (?:frappe|frappent|bat|battent|viole|violent|menace|menacent|brutalise)\b/ },
  { kind: 'VIOLENCE', re: /\bm a (?:frappe|frappee|battu|battue|violee?|agresse|agressee|menace|menacee)\b/ },
  { kind: 'VIOLENCE', re: /\b(?:viol|violee?|violences?)\b/ },
  { kind: 'VIOLENCE', re: /\bagress(?:e|ee|ion|ions)\b/ },
  { kind: 'VIOLENCE', re: /\b(?:abus sexuels?|attouchements?)\b/ },
  { kind: 'VIOLENCE', re: /\b(?:veut|va|menace de) me tuer\b/ },
  { kind: 'VIOLENCE', re: /\b(?:donne|donnent|recois|prends) des coups\b/ },
];

const EN: DistressPattern[] = [
  { kind: 'SUICIDE', re: /\bsuicid\w*/ },
  { kind: 'SUICIDE', re: new RegExp(String.raw`${WANT_EN} (?:die|disappear)\b`) },
  { kind: 'SUICIDE', re: /\bkill(?:ing)? myself\b/ },
  { kind: 'SUICIDE', re: /\bend (?:it all|my life|everything)\b/ },
  { kind: 'SUICIDE', re: /\btake my (?:own )?life\b/ },
  { kind: 'SUICIDE', re: /\bwish i (?:was|were) dead\b/ },
  { kind: 'SUICIDE', re: /\bbetter off (?:dead|without me)\b/ },
  { kind: 'SUICIDE', re: /\bno (?:reason|point) (?:to|in) (?:live|living)\b/ },
  { kind: 'SUICIDE', re: /\b(?:don t|dont|do not) want to (?:live|be alive|wake up)\b/ },
  { kind: 'SUICIDE', re: /\bdisappear forever\b/ },
  { kind: 'AUTOMUTILATION', re: /\b(?:hurt|harm|cut|burn)(?:ing)? myself\b/ },
  { kind: 'AUTOMUTILATION', re: /\bself[ -]?harm\w*/ },
  { kind: 'AUTOMUTILATION', re: /\boverdos\w*/ },
  { kind: 'VIOLENCE', re: /\b(?:he|she|they|my husband|my wife|my father|my mother) (?:hits|beats|hit|beat|abuses|abused|raped|threatens) me\b/ },
  { kind: 'VIOLENCE', re: /\b(?:rape|raped|domestic violence|violence|assaulted|sexual abuse|abusive)\b/ },
  { kind: 'VIOLENCE', re: /\b(?:threatens?|threatened) to kill\b/ },
];

/** Yoruba, sans tons ni points souscrits (« mo fẹ́ kú » → « mo fe ku »). À faire relire par un locuteur natif. */
const YO: DistressPattern[] = [
  // « mo fẹ́ kú » (je veux mourir), « mo fẹ́ pa ara mi / para mi » (je veux me tuer)
  { kind: 'SUICIDE', re: /\b(?:mo|emi) (?:fe|n fe) ku\b/ },
  { kind: 'SUICIDE', re: /\b(?:pa ara|para) mi\b/ },
  // « mi ò fẹ́ wà láàyè mọ́ », « n kò fẹ́ wà láàyè » (je ne veux plus vivre)
  { kind: 'SUICIDE', re: /\b(?:mi o|n ko|emi ko|mi ko) fe wa laaye\b/ },
  // « ìgbẹ̀mí ara ẹni » (suicide), « gbẹ̀mí ara mi » (m'ôter la vie)
  { kind: 'SUICIDE', re: /\bi?gbemi ara (?:eni|mi)\b/ },
  // « ó rẹ̀ mí láti wà láàyè » (fatigué de vivre)
  { kind: 'SUICIDE', re: /\bo re mi lati wa laaye\b/ },
  // « ṣe ara mi léṣe » (me faire du mal)
  { kind: 'AUTOMUTILATION', re: /\bse ara mi lese\b/ },
  // « ó ń lù mí », « ọkọ mi ń lù mí » (il me bat, mon mari me bat)
  { kind: 'VIOLENCE', re: /\b(?:o|oko mi|iyawo mi|baba mi|won) (?:n |maa n )?lu mi\b/ },
  // « fipá bá mi lòpọ̀ » (m'a violée), « ìfipábánilòpọ̀ » (viol)
  { kind: 'VIOLENCE', re: /\bfipa ba mi lopo\b/ },
  { kind: 'VIOLENCE', re: /\bi?fipabanilopo\b/ },
];

/** Fon, sans tons. À faire relire et compléter par un locuteur natif. */
const FON: DistressPattern[] = [
  // « Un jló ná kú », « un jló kú » (je veux mourir) : jló = vouloir, kú = mourir.
  { kind: 'SUICIDE', re: /\bun jlo (?:na )?ku\b/ },
  // TODO(fon) : se tuer, se faire du mal, violences subies (« il me frappe »), à écrire avec un locuteur natif.
];

/** Bariba (baatonum). TODO(bba) : aucun motif fiable pour l'instant, à écrire avec un locuteur natif. */
const BBA: DistressPattern[] = [];

/** Dendi. TODO(ddn) : aucun motif fiable pour l'instant, à écrire avec un locuteur natif. */
const DDN: DistressPattern[] = [];

export const DISTRESS_LEXICON: Record<DistressLang, DistressPattern[]> = { fr: FR, en: EN, fon: FON, yo: YO, bba: BBA, ddn: DDN };

/** Langues dont le lexique reste à écrire ou à compléter avec un locuteur natif. */
export const DISTRESS_TODO: DistressLang[] = (Object.keys(DISTRESS_LEXICON) as DistressLang[]).filter((l) => DISTRESS_LEXICON[l].length < 3);

/** Minuscules, sans accents ni tons (NFD puis suppression des diacritiques), apostrophes et espaces normalisés. */
export function foldText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’'`´‘]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface DistressResult {
  distress: boolean;
  kinds: DistressKind[];
  /** Lexiques qui ont reconnu le message. */
  langs: DistressLang[];
}

/** Détecte les mots de détresse d'un message, dans toutes les langues à la fois. */
export function detectDistress(text: string): DistressResult {
  const folded = foldText(text);
  const kinds = new Set<DistressKind>();
  const langs = new Set<DistressLang>();
  for (const [lang, patterns] of Object.entries(DISTRESS_LEXICON) as [DistressLang, DistressPattern[]][]) {
    for (const p of patterns) {
      if (p.re.test(folded)) {
        kinds.add(p.kind);
        langs.add(lang);
      }
    }
  }
  return { distress: kinds.size > 0, kinds: [...kinds], langs: [...langs] };
}
