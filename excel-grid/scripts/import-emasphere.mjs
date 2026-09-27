/**
 * Import du modèle d'import EmaSphère du groupe (« Adjustments_BUDGET
 * 2026.xlsx »), pour pouvoir exporter le budget dans le même format.
 *
 *   node --experimental-strip-types scripts/import-emasphere.mjs "chemin/vers/Adjustments.xlsx"
 *
 * Le fichier est un modèle vierge : une ligne par compte du plan EmaSphère
 * (Account Number, Account Category), colonnes de mois vides à remplir.
 * Ce script n'importe donc pas des montants — il construit la correspondance
 * entre nos comptes 2026 (ou leur ancien numéro) et le numéro de compte /
 * catégorie qu'EmaSphère attend, pour que `handleExport('emasphere-xlsx')`
 * sache quoi écrire dans la colonne « Account Number ».
 *
 * Priorité de correspondance : le numéro de compte du modèle est essayé
 * d'abord tel quel contre nos comptes 2026 (8 chiffres) ; sinon, contre nos
 * anciens numéros (6 chiffres, `legacy`). Le modèle mélange les deux
 * longueurs selon les comptes — rien d'anormal, c'est simplement l'état de
 * la migration EmaSphère au moment où le modèle a été généré.
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readWorkbook } from './lib/xlsx-read.mjs';
import { prepareTypeScript } from './lib/prepare-ts.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = join(root, '..');

const source = process.argv[2] ?? join(projectRoot, 'Adjustments_BUDGET 2026 (22).xlsx');
if (!existsSync(source)) {
  console.error(`Fichier introuvable : ${source}`);
  process.exit(1);
}

const sheets = readWorkbook(source);
const [sheetName, rows] = [...sheets.entries()][0];
if (!rows || !rows.length) throw new Error('Feuille vide ou introuvable.');

const header = rows[0];
const col = (name) => header.indexOf(name);
const colAccount = col('Account Number');
const colCategory = col('Account Category');
if (colAccount < 0 || colCategory < 0) {
  throw new Error('Colonnes « Account Number » / « Account Category » introuvables dans l’en-tête.');
}

/** Une ligne par compte EmaSphère (numéro, catégorie), dans l'ordre du modèle. */
const templateRows = [];
for (const row of rows.slice(1)) {
  const number = String(row[colAccount] ?? '').trim();
  if (!/^\d+$/.test(number)) continue;
  templateRows.push({ number, category: String(row[colCategory] ?? '').trim() });
}

const prepared = prepareTypeScript(root, 'excel-grid-emasphere');
const chart = await import(join(prepared, 'src', 'engine', 'chart.ts'));

/* Deux passes, pour que le numéro 2026 (8 chiffres) l'emporte toujours sur
   un ancien numéro (6 chiffres) quand le modèle liste les deux pour le même
   compte : l'ordre des lignes dans le modèle ne doit pas décider. */
const map = new Map(); // notre compte 2026 -> { number, category } du modèle
for (const row of templateRows) {
  if (row.number.length !== 8) continue;
  const account = chart.ACCOUNTS.find((a) => a.account === row.number);
  if (account) map.set(account.account, row);
}
for (const row of templateRows) {
  if (row.number.length === 8) continue;
  if (chart.ACCOUNTS.some((a) => a.legacy && a.legacy.includes(row.number) && map.has(a.account))) continue;
  const account = chart.ACCOUNTS.find((a) => a.legacy && a.legacy.includes(row.number));
  if (account) map.set(account.account, row);
}

/**
 * Comptes utilisés dans nos budgets mais totalement absents du modèle
 * EmaSphère fourni (ni au numéro 2026, ni à un ancien numéro « legacy ») :
 * sans rattachement manuel, ils sont silencieusement exclus de l'export, ce
 * qui décale son total par rapport au P&L de l'appli.
 *
 * 65800900 « Non Operating Other Expense » (centre RPOI, budget Kokoro) :
 * absent du modèle (vérifié sous son numéro 2026 comme sous ses deux
 * anciens numéros 671809/678809). Alexis : « rentre le 658009 dans le
 * RPOI ». Catégorie « 65-NONOP » choisie par cohérence avec la convention
 * du modèle (préfixe = classe comptable du compte) — à renommer ici si
 * EmaSphère utilise déjà un intitulé précis pour cette charge.
 */
const MANUAL_OVERRIDES = {
  '65800900': { number: '65800900', category: '65-NONOP' },
};
for (const [account, row] of Object.entries(MANUAL_OVERRIDES)) {
  if (!map.has(account) && chart.ACCOUNTS.some((a) => a.account === account)) map.set(account, row);
}

const unmatchedTemplate = templateRows.filter((row) => {
  const byNew = row.number.length === 8 && chart.ACCOUNTS.some((a) => a.account === row.number);
  const byLegacy = row.number.length !== 8 && chart.ACCOUNTS.some((a) => a.legacy && a.legacy.includes(row.number));
  return !byNew && !byLegacy;
});
const budgetableWithoutMapping = chart.ACCOUNTS.filter((a) => a.kind !== 'bilan' && !map.has(a.account));

console.log(`EmaSphère importé depuis ${basename(source)} — feuille « ${sheetName} »`);
console.log(`  ${templateRows.length} ligne(s) de compte dans le modèle, ${map.size} rattachée(s) à notre plan comptable`);
if (unmatchedTemplate.length) {
  console.log(`  ${unmatchedTemplate.length} ligne(s) du modèle sans correspondance dans notre plan comptable`
    + ` (comptes de bilan probablement absents du PCG importé, ou numéros propres à EmaSphère)`);
}
if (budgetableWithoutMapping.length) {
  console.log(`  ${budgetableWithoutMapping.length} compte(s) budgétable(s) de notre plan sans ligne dans le modèle EmaSphère :`);
  for (const a of budgetableWithoutMapping.slice(0, 15)) console.log(`    - ${a.account} ${a.label}`);
  if (budgetableWithoutMapping.length > 15) console.log(`    … et ${budgetableWithoutMapping.length - 15} autre(s)`);
}

/* ------------------------------------------------------------------ */
/* Écriture                                                            */
/* ------------------------------------------------------------------ */

const generatedAt = new Date().toISOString().slice(0, 10);
const entries = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));

const header2 = `/**
 * MODÈLE D'IMPORT EMASPHÈRE — FICHIER GÉNÉRÉ, NE PAS MODIFIER À LA MAIN.
 *
 * Source  : ${basename(source)}, feuille « ${sheetName} »
 * Généré  : ${generatedAt} par scripts/import-emasphere.mjs
 * Contenu : correspondance compte 2026 -> { numéro EmaSphère, catégorie },
 *           pour ${map.size} compte(s) sur ${chart.ACCOUNTS.length} au total.
 *
 * Pour mettre à jour : remplacer le modèle et relancer
 *   node --experimental-strip-types scripts/import-emasphere.mjs "chemin.xlsx"
 */
export const EMASPHERE_SOURCE = ${JSON.stringify(basename(source))};
export const EMASPHERE_HEADERS = ${JSON.stringify(header)};

export const EMASPHERE_MAP: Record<string, { number: string; category: string }> = {
`;

/**
 * Le modèle mélange des numéros à 6 chiffres (ancien plan) et à 8 chiffres
 * (plan 2026, toujours terminés par « 00 » — les deux derniers chiffres du
 * compte 2026 codent le centre, jamais le numéro EmaSphère lui-même).
 * Alexis : « fait en sorte que tout les comptes ai deux 00 après les six
 * premiers chiffres » — un numéro à 6 chiffres sans le « 00 » de fin
 * détonnait dans l'export à côté des 8 chiffres. On complète systématiquement
 * plutôt que de le corriger au cas par cas.
 */
const emasphereNumber = (raw) => (raw.length === 6 ? raw + '00' : raw);

const body = entries
  .map(([account, row]) => `  ${JSON.stringify(account)}: { number: ${JSON.stringify(emasphereNumber(row.number))}, category: ${JSON.stringify(row.category)} },`)
  .join('\n');

writeFileSync(
  join(root, 'src', 'data', 'emasphere.generated.ts'),
  `${header2}${body}\n};\n`,
  'utf8',
);

const htmlPath = join(projectRoot, 'budget-app.html');
if (existsSync(htmlPath)) {
  const html = readFileSync(htmlPath, 'utf8');
  const start = '/* EMASPHERE-DATA-START */';
  const end = '/* EMASPHERE-DATA-END */';
  if (html.includes(start) && html.includes(end)) {
    const before = html.slice(0, html.indexOf(start) + start.length);
    const after = html.slice(html.indexOf(end));
    const mapObject = {};
    for (const [account, row] of entries) mapObject[account] = { number: emasphereNumber(row.number), category: row.category };
    const block = `\n    const EMASPHERE_SOURCE = ${JSON.stringify(basename(source))};\n` +
      `    const EMASPHERE_HEADERS = ${JSON.stringify(header)};\n` +
      `    const EMASPHERE_MAP = ${JSON.stringify(mapObject)};\n    `;
    writeFileSync(htmlPath, before + block + after, 'utf8');
    console.log('\nbudget-app.html : correspondance EmaSphère embarquée mise à jour');
  } else {
    console.warn('\nbudget-app.html : marqueurs EMASPHERE-DATA absents, fichier laissé tel quel'
      + ' (à ajouter une fois, voir REPRISE-PROJET.md)');
  }
}

console.log(`src/data/emasphere.generated.ts : ${map.size} correspondance(s) écrite(s)`);
