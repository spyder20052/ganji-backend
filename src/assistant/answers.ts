/**
 * Réponses de l'assistant de traitement, sans service d'IA externe : détection de l'intention par
 * mots-clés (français et anglais), puis réponse construite UNIQUEMENT à partir des ordonnances en
 * cours du patient et des fiches de src/data/medication-info.ts. Toujours courte, toujours sourcée,
 * toujours avec une ligne de sécurité. Signes de danger → 118 ; mélange de médicaments → pharmacien.
 */
import { infoFor, type MedicationInfo } from '../data/medication-info';
import type { DosagePlan, Meal } from './dosage';

export type Lang2 = 'fr' | 'en';

export type Intent =
  | 'DANGER'
  | 'DIAGNOSIS'
  | 'MISSED'
  | 'INTERACTION'
  | 'CHANGE_DOSE'
  | 'DURATION'
  | 'STOP'
  | 'SIDE_EFFECTS'
  | 'FOOD'
  | 'WHEN'
  | 'HOW'
  | 'PURPOSE'
  | 'OTHER_MEDICINE'
  | 'UNKNOWN';

/** Un médicament d'une ordonnance en cours, tel que l'assistant le connaît. */
export interface MedContext {
  dci: string;
  strength: string;
  dosage: string;
  duration: string;
  plan: DosagePlan;
  prescriber: string;
  issuedAt: Date;
  /** Fin prévue du traitement (null : au long cours ou durée inconnue). */
  until: Date | null;
  /** Heures des rappels actifs (plan de prises), s'il existe. */
  reminderTimes: string[];
  /** Prochaine prise prévue (plan de prises), s'il existe. */
  nextDose: Date | null;
  /** Le plan de prises actif a été créé depuis cette ordonnance. */
  planned?: boolean;
}

export interface AnswerSource {
  kind: 'ORDONNANCE' | 'FICHE' | 'CONSIGNE';
  label: string;
}

export interface Answer {
  intent: Intent;
  urgent: boolean;
  lines: { medication?: string; text: string }[];
  answer: string;
  sources: AnswerSource[];
  safety: string;
}

export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’'`´]/g, ' ')
    .replace(/[^a-z0-9/ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Ordre significatif : le danger d'abord, puis l'oubli (qui contient souvent « doubler »), le mélange
// (« une tisane en même temps, c'est grave ? »), puis le diagnostic, etc.
const INTENTS: [Intent, RegExp][] = [
  [
    'DANGER',
    /\b(?:saign\w*|du sang dans|sang dans|vomi\w* du sang|respire mal|du mal a respirer|ne respire|essouffl\w*|etouff\w*|evanoui\w*|perdu connaissance|convuls\w*|visage gonfle|gonflement du visage|levres gonflees|gorge gonflee|boutons partout|cloques|jaunisse|yeux jaunes|forte fievre|fievre a 40|douleur (?:dans la |a la )?poitrine|paralys\w*|ne se reveille pas|surdose|trop de comprimes|pris trop|avale trop|bleed\w*|blood in|vomit\w* blood|can t breathe|cannot breathe|short of breath|trouble breathing|faint\w*|passed out|seizure|swollen (?:face|lips|throat)|rash all over|blisters|yellow eyes|jaundice|chest pain|high fever|overdose|took too many|too many tablets)\b/,
  ],
  ['MISSED', /\b(?:oubli\w*|pas pris|rate|saute|forgot|forget|forgotten|missed|skipped|didn t take|did not take)\b/],
  [
    'INTERACTION',
    /\b(?:interaction\w*|en meme temps|melanger|meler|autres? medicaments?|autres? traitements?|autres? cachets?|tisanes?|plantes?|decoctions?|traditionnel\w*|alcool|biere|sodabi|together|other medicines?|other drugs?|other tablets?|mix|mixing|herbal|herbs?|alcohol|beer)\b/,
  ],
  ['DIAGNOSIS', /\b(?:est ce que j ai|ai je (?:le|la|un|une|des)|quelle maladie|c est grave|suis je malade|do i have|what disease|what illness|is it serious|am i sick)\b/],
  ['CHANGE_DOSE', /\b(?:doubler|augmenter|diminuer|reduire|baisser la dose|plus de comprimes|moins de comprimes|double|increase|decrease|reduce|lower the dose|take more|take less)\b/],
  ['DURATION', /\b(?:combien de temps|jusqu a quand|duree|combien de jours|fin du traitement|quand (?:est ce que )?(?:je )?(?:peux )?(?:l )?arret\w*|how long|until when|how many days|when (?:can|do|should) i stop)\b/],
  ['STOP', /\b(?:arret\w*|stopper|je me sens mieux|plus besoin|finir avant|stop|quit|feel better|no longer need)\b/],
  [
    'SIDE_EFFECTS',
    /\b(?:effets?|secondaires?|indesirables?|nausees?|vomi\w*|mal au ventre|maux de ventre|fatigu\w*|vertiges?|maux de tete|mal a la tete|diarrhee|boutons|side effects?|nausea|vomit\w*|tired\w*|dizz\w*|headache|diarrh\w*|rash)\b/,
  ],
  ['FOOD', /\b(?:manger|mange|repas|a jeun|nourriture|estomac vide|lait|food|meals?|eat|eating|empty stomach|milk)\b/],
  ['WHEN', /\b(?:quand|heures?|moment|matin ou soir|when|what time|time)\b/],
  ['HOW', /\b(?:comment|combien de comprimes|combien|dose|posologie|how|how many)\b/],
  ['PURPOSE', /\b(?:a quoi|sert|servir|pourquoi|c est quoi|qu est ce que|role|what is|what for|why|what does)\b/],
];

export function detectIntent(question: string): Intent {
  const q = fold(question);
  for (const [intent, re] of INTENTS) if (re.test(q)) return intent;
  return 'UNKNOWN';
}

const T = {
  safety: {
    fr: 'En cas de malaise, de saignement ou de gêne pour respirer : appelez le 118.',
    en: 'If you feel faint, bleed or have trouble breathing: call 118.',
  },
  safetyMix: {
    fr: 'Ne mélangez rien sans l’avis du pharmacien. En cas de malaise : 118.',
    en: 'Do not mix anything without the pharmacist’s advice. If you feel unwell: 118.',
  },
  danger: {
    fr: 'Ce sont des signes de danger. Appelez le 118 tout de suite ou allez aux urgences les plus proches, avec vos médicaments.',
    en: 'These are danger signs. Call 118 right away or go to the nearest emergency department, with your medicines.',
  },
  dangerSafety: { fr: 'N’attendez pas : chaque minute compte.', en: 'Do not wait: every minute counts.' },
  diagnosis: {
    fr: 'Je ne peux pas dire quelle maladie vous avez : seul un soignant le peut. Si vous ne vous sentez pas bien, allez au centre de santé.',
    en: 'I cannot tell which illness you have: only a health worker can. If you feel unwell, go to the health centre.',
  },
  interaction: {
    fr: 'Je ne peux pas vous dire si des médicaments se mélangent sans risque. Avant de prendre autre chose (médicament, tisane, plante), montrez votre ordonnance au pharmacien.',
    en: 'I cannot tell you whether medicines are safe together. Before taking anything else (medicine, herbal tea, plant), show your prescription to the pharmacist.',
  },
  changeDose: {
    fr: 'Je ne peux pas changer la dose. Suivez l’ordonnance telle qu’elle est écrite et parlez-en à votre médecin.',
    en: 'I cannot change the dose. Follow the prescription as written and talk to your doctor.',
  },
  unknown: {
    fr: 'Je réponds seulement sur vos médicaments : heures de prise, oubli, repas, durée, effets. Pour le reste, demandez à votre soignant.',
    en: 'I only answer about your medicines: dose times, missed doses, meals, duration, side effects. For anything else, ask your health worker.',
  },
  noRx: {
    fr: 'Vous n’avez pas d’ordonnance en cours dans Ganji : je ne peux répondre que sur vos médicaments prescrits. Demandez au pharmacien.',
    en: 'You have no current prescription in Ganji: I can only answer about your prescribed medicines. Ask the pharmacist.',
  },
  notPrescribed: {
    fr: 'Ce médicament n’est pas sur votre ordonnance : je ne peux pas en parler. Demandez au pharmacien.',
    en: 'This medicine is not on your prescription: I cannot advise on it. Ask the pharmacist.',
  },
  noSheet: {
    fr: 'Je n’ai pas de fiche sur ce médicament : demandez au pharmacien.',
    en: 'I have no information sheet for this medicine: ask the pharmacist.',
  },
  missedGeneric: {
    fr: 'Ne prenez jamais deux doses d’un coup pour rattraper. Demandez au pharmacien quoi faire pour ce médicament.',
    en: 'Never take two doses at once to catch up. Ask the pharmacist what to do for this medicine.',
  },
  next: { fr: 'Prochaine prise prévue : {time}.', en: 'Next planned dose: {time}.' },
  asPrescribed: { fr: 'Sur l’ordonnance : {dosage}.', en: 'On the prescription: {dosage}.' },
  reminders: { fr: 'Rappels à {times}.', en: 'Reminders at {times}.' },
  noPlan: { fr: 'Créez votre plan de prises pour recevoir les rappels.', en: 'Create your dose plan to get reminders.' },
  until: { fr: 'Pendant {duration}, jusqu’au {date}.', en: 'For {duration}, until {date}.' },
  durationOnly: { fr: 'Pendant {duration}.', en: 'For {duration}.' },
  longTerm: {
    fr: 'Traitement au long cours : ne l’arrêtez pas sans votre médecin.',
    en: 'Long-term treatment: do not stop it without your doctor.',
  },
  dontStop: {
    fr: 'Ne l’arrêtez pas sans l’avis de votre médecin, même si vous vous sentez mieux.',
    en: 'Do not stop it without your doctor’s advice, even if you feel better.',
  },
  rx: { fr: 'Ordonnance de {prescriber}, {date}', en: 'Prescription from {prescriber}, {date}' },
  sheet: { fr: 'Fiche Ganji : {name}', en: 'Ganji sheet: {name}' },
  rules: { fr: 'Consignes de sécurité Ganji', en: 'Ganji safety rules' },
  meal: {
    AVANT: { fr: 'avant le repas', en: 'before meals' },
    PENDANT: { fr: 'pendant le repas', en: 'with a meal' },
    APRES: { fr: 'après le repas', en: 'after meals' },
    A_JEUN: { fr: 'à jeun', en: 'on an empty stomach' },
  } satisfies Record<Meal, Record<Lang2, string>>,
  mealLine: { fr: 'À prendre {meal}.', en: 'To take {meal}.' },
};

function fill(s: string, vars: Record<string, string>) {
  return s.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}

function fmtDay(d: Date, lang: Lang2) {
  return d.toLocaleDateString(lang === 'en' ? 'en-GB' : 'fr-FR', { timeZone: 'Africa/Porto-Novo', day: 'numeric', month: 'long' });
}
function fmtTime(d: Date, lang: Lang2) {
  const s = d.toLocaleTimeString(lang === 'en' ? 'en-GB' : 'fr-FR', { timeZone: 'Africa/Porto-Novo', hour: '2-digit', minute: '2-digit' });
  const today = fmtDay(new Date(), lang) === fmtDay(d, lang);
  return today ? s : `${fmtDay(d, lang)}, ${s}`;
}
function list(items: string[], lang: Lang2) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} ${lang === 'en' ? 'and' : 'et'} ${items[items.length - 1]}`;
}

/** Nom affiché d'un médicament : celui de la fiche s'il existe, sinon la DCI. */
function nameOf(m: MedContext, info: MedicationInfo | null, lang: Lang2) {
  return info ? info.name[lang] : m.dci;
}

/** Médicaments visés par la question : ceux qu'elle nomme, sinon tous (dédoublonnés par DCI). */
export function targetMeds(question: string, meds: MedContext[]): MedContext[] {
  const q = fold(question);
  const unique = new Map<string, MedContext>();
  for (const m of meds) {
    const key = fold(m.dci);
    const prev = unique.get(key);
    // L'ordonnance suivie (plan de prises actif) d'abord, sinon la plus récente.
    const better = !prev || (!!m.planned !== !!prev.planned ? !!m.planned : prev.issuedAt < m.issuedAt);
    if (better) unique.set(key, m);
  }
  const all = [...unique.values()];
  const named = all.filter((m) => {
    const first = fold(m.dci).split(' ')[0];
    const info = infoFor(m.dci);
    return (first.length >= 4 && q.includes(first)) || (info && q.includes(fold(info.name.en).split(' ')[0]));
  });
  return (named.length ? named : all).slice(0, 4);
}

/**
 * Construit la réponse. `otherDrugs` : DCI du référentiel (premier mot), pour reconnaître une question
 * qui mélange un médicament de l'ordonnance avec un autre (→ pharmacien).
 */
export function answerQuestion(question: string, meds: MedContext[], lang: Lang2, otherDrugs: string[] = []): Answer {
  let intent = detectIntent(question);
  const q = fold(question);

  // « Je peux prendre du paracétamol avec ? » : un médicament hors ordonnance est cité. Avec un mot de
  // combinaison → question de mélange (pharmacien) ; sinon → il n'est pas sur l'ordonnance (pharmacien).
  if (intent !== 'DANGER' && intent !== 'DIAGNOSIS') {
    const stem = (d: string) => fold(d).split(' ')[0].slice(0, 7);
    const own = new Set(meds.map((m) => stem(m.dci)));
    const foreign = otherDrugs.map(stem).filter((d) => d.length >= 5 && !own.has(d) && new RegExp(`\\b${d}`).test(q));
    if (foreign.length) {
      intent = /\b(?:avec|et|en meme temps|aussi|with|and|together|also)\b/.test(q) || intent === 'INTERACTION' ? 'INTERACTION' : 'OTHER_MEDICINE';
    }
  }

  const sources: AnswerSource[] = [];
  const addSource = (s: AnswerSource) => {
    if (!sources.some((x) => x.kind === s.kind && x.label === s.label)) sources.push(s);
  };
  const rules = () => addSource({ kind: 'CONSIGNE', label: T.rules[lang] });
  const rxSource = (m: MedContext) => addSource({ kind: 'ORDONNANCE', label: fill(T.rx[lang], { prescriber: m.prescriber, date: fmtDay(m.issuedAt, lang) }) });
  const sheetSource = (info: MedicationInfo) => addSource({ kind: 'FICHE', label: fill(T.sheet[lang], { name: info.name[lang] }) });

  const done = (lines: Answer['lines'], safety: string, urgent = false): Answer => ({
    intent,
    urgent,
    lines,
    answer: lines.map((l) => (l.medication ? `${l.medication} : ${l.text}` : l.text)).join('\n'),
    sources,
    safety,
  });

  if (intent === 'DANGER') {
    rules();
    return done([{ text: T.danger[lang] }], T.dangerSafety[lang], true);
  }
  if (intent === 'DIAGNOSIS') {
    rules();
    return done([{ text: T.diagnosis[lang] }], T.safety[lang]);
  }
  if (meds.length === 0) {
    rules();
    return done([{ text: intent === 'INTERACTION' ? T.interaction[lang] : T.noRx[lang] }], T.safety[lang]);
  }
  if (intent === 'UNKNOWN') {
    rules();
    return done([{ text: T.unknown[lang] }], T.safety[lang]);
  }
  if (intent === 'OTHER_MEDICINE') {
    rules();
    return done([{ text: T.notPrescribed[lang] }], T.safetyMix[lang]);
  }

  const targets = targetMeds(question, meds);

  if (intent === 'INTERACTION') {
    rules();
    const lines: Answer['lines'] = [{ text: T.interaction[lang] }];
    for (const m of targets) {
      const info = infoFor(m.dci);
      if (info?.caution) {
        sheetSource(info);
        lines.push({ medication: nameOf(m, info, lang), text: info.caution[lang] });
      }
    }
    return done(lines, T.safetyMix[lang]);
  }

  if (intent === 'CHANGE_DOSE') {
    const lines: Answer['lines'] = [{ text: T.changeDose[lang] }];
    for (const m of targets) {
      rxSource(m);
      lines.push({ medication: nameOf(m, infoFor(m.dci), lang), text: fill(T.asPrescribed[lang], { dosage: m.dosage }) });
    }
    return done(lines, T.safety[lang]);
  }

  const lines: Answer['lines'] = [];
  for (const m of targets) {
    const info = infoFor(m.dci);
    const name = nameOf(m, info, lang);
    const parts: string[] = [];
    switch (intent) {
      case 'MISSED': {
        if (info) {
          sheetSource(info);
          parts.push(info.missed[lang]);
        } else {
          rules();
          parts.push(T.missedGeneric[lang]);
        }
        if (m.nextDose) parts.push(fill(T.next[lang], { time: fmtTime(m.nextDose, lang) }));
        break;
      }
      case 'WHEN': {
        rxSource(m);
        parts.push(fill(T.asPrescribed[lang], { dosage: m.dosage }));
        parts.push(m.reminderTimes.length ? fill(T.reminders[lang], { times: list(m.reminderTimes, lang) }) : T.noPlan[lang]);
        break;
      }
      case 'FOOD': {
        if (m.plan.meal) {
          rxSource(m);
          parts.push(fill(T.mealLine[lang], { meal: T.meal[m.plan.meal][lang] }));
        } else if (info) {
          sheetSource(info);
          parts.push(info.how[lang]);
        } else {
          parts.push(T.noSheet[lang]);
        }
        break;
      }
      case 'DURATION': {
        rxSource(m);
        if (m.plan.longTerm || (!m.plan.durationDays && !m.until)) parts.push(T.longTerm[lang]);
        else if (m.until) parts.push(fill(T.until[lang], { duration: m.duration, date: fmtDay(m.until, lang) }));
        else parts.push(fill(T.durationOnly[lang], { duration: m.duration }));
        break;
      }
      case 'STOP': {
        rxSource(m);
        parts.push(T.dontStop[lang]);
        if (m.until && !m.plan.longTerm) parts.push(fill(T.until[lang], { duration: m.duration, date: fmtDay(m.until, lang) }));
        break;
      }
      case 'SIDE_EFFECTS': {
        if (info) {
          sheetSource(info);
          parts.push(info.sideEffects[lang], info.callDoctor[lang]);
        } else parts.push(T.noSheet[lang]);
        break;
      }
      case 'HOW': {
        rxSource(m);
        parts.push(fill(T.asPrescribed[lang], { dosage: m.dosage }));
        if (info) {
          sheetSource(info);
          parts.push(info.how[lang]);
        }
        break;
      }
      case 'PURPOSE': {
        if (info) {
          sheetSource(info);
          parts.push(info.purpose[lang]);
        } else parts.push(T.noSheet[lang]);
        break;
      }
    }
    lines.push({ medication: name, text: parts.join(' ') });
  }
  return done(lines, T.safety[lang]);
}
