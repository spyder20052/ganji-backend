/**
 * Vérifie les traductions : catalogue (français et anglais) puis chaque langue nationale (fon, yoruba, bariba,
 * dendi) : clé manquante, texte vide, variables {x} différentes du français, clé inconnue. Code de sortie 1
 * s'il reste un problème.
 *
 *   npm run i18n:verify                 toutes les langues
 *   npm run i18n:verify -- fon bariba   seulement ces langues
 */
import { checkCatalog, checkNational, NATIONAL_LANGS, type Problem } from './check';
import type { NationalLang } from '../../src/common/i18n';

const LABEL: Record<Problem['kind'], string> = {
  MISSING: 'manquante',
  EMPTY: 'texte vide',
  PLACEHOLDERS: 'variables différentes',
  EXTRA: 'clé inconnue',
  DUPLICATE: 'clé en double',
};

const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const unknown = wanted.filter((l) => !NATIONAL_LANGS.includes(l as NationalLang));
if (unknown.length) {
  console.error(`Langue inconnue : ${unknown.join(', ')} (langues : ${NATIONAL_LANGS.join(', ')})`);
  process.exit(2);
}
const langs = (wanted.length ? wanted : NATIONAL_LANGS) as NationalLang[];

function print(title: string, problems: Problem[]) {
  if (!problems.length) return;
  console.log(`\n${title}`);
  const byKind = new Map<string, Problem[]>();
  for (const p of problems) byKind.set(p.kind, [...(byKind.get(p.kind) ?? []), p]);
  for (const [kind, list] of byKind) {
    console.log(`  ${LABEL[kind as Problem['kind']]} (${list.length})`);
    for (const p of list) console.log(`    ${p.key}${p.detail ? ` : ${p.detail}` : ''}`);
  }
}

let failed = 0;
const catalog = checkCatalog();
print('Catalogue (français, anglais)', catalog);
failed += catalog.length;
console.log(`Catalogue : ${catalog.length ? `${catalog.length} problème(s)` : 'OK'}`);

for (const lang of langs) {
  const { problems, translated, total } = checkNational(lang);
  print(lang, problems);
  failed += problems.length;
  console.log(`${lang} : ${translated}/${total} traduits${problems.length ? `, ${problems.length} problème(s)` : ', OK'}`);
}
process.exit(failed ? 1 : 0);
