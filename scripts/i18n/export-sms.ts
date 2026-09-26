/**
 * Liste des textes à traduire, pour les traducteurs : chaque clé du catalogue avec son module, le français,
 * l'anglais et ses variables {x} (à garder telles quelles).
 *
 *   npm run i18n:export              écrit scripts/i18n/sms-catalog.json
 *   npm run i18n:export -- --stdout  affiche le JSON
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SMS, type Entry } from '../../src/common/i18n';
import { moduleOf, placeholders } from './check';

const keys = Object.fromEntries(
  Object.entries(SMS as Record<string, Entry>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, e]) => [key, { module: moduleOf(key), fr: e.fr, en: e.en, vars: placeholders(e.fr) }]),
);
const json = `${JSON.stringify(
  {
    about: 'Textes envoyés par Ganji (SMS, messages vocaux, notifications, USSD). Traduire le français ; garder les variables {x} ; jamais de donnée médicale. Traductions : src/common/i18n/<langue>.ts.',
    count: Object.keys(keys).length,
    keys,
  },
  null,
  2,
)}\n`;

if (process.argv.includes('--stdout')) {
  process.stdout.write(json);
} else {
  const out = join(__dirname, 'sms-catalog.json');
  writeFileSync(out, json);
  console.log(`${Object.keys(keys).length} textes écrits dans ${out}`);
}
