/**
 * Import d'un budget annuel depuis le classeur Excel du contrôle de gestion.
 *
 *   node --experimental-strip-types scripts/import-budget.mjs "../5- PL PATIO 2026 -EMA.xlsx"
 *
 * Source : la feuille « BUDGET EMA », qui donne pour chaque compte à 8
 * chiffres son centre de coût et ses douze mois. C'est le seul endroit du
 * classeur où le budget existe au niveau du compte ; les feuilles « PL
 * PATIO », « A&G », « H&R »… en sont des présentations, et la feuille
 * « P&L SYNTHESE » en est le résumé signé.
 *
 * Le script :
 *   1. lit les lignes de budget ;
 *   2. applique les corrections listées ci-dessous, chacune justifiée ;
 *   3. recalcule le P&L avec le moteur de l'application ;
 *   4. le compare aux totaux de la feuille de synthèse — et échoue si le
 *      GOP ou l'EBITDA s'écartent d'un euro.
 *
 * Sorties : src/data/budget-patio-2026.generated.ts et le bloc de données
 * embarqué dans ../budget-app.html.
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readWorkbook } from './lib/xlsx-read.mjs';
import { prepareTypeScript } from './lib/prepare-ts.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = join(root, '..');

const source = process.argv[2] ?? join(projectRoot, '5- PL PATIO 2026 -EMA.xlsx');
if (!existsSync(source)) {
  console.error(`Fichier introuvable : ${source}`);
  process.exit(1);
}

const COMPANY = 'LPM test';
const YEAR = 2026;
const MONTHS = 12;

/* ------------------------------------------------------------------ */
/* Corrections                                                         */
/* ------------------------------------------------------------------ */

/**
 * Deux écarts ont été trouvés entre le détail par compte et le P&L de
 * synthèse du même classeur. Ils sont corrigés ici plutôt que passés sous
 * silence, chacun avec sa raison — ce sont des points à trancher côté
 * contrôle de gestion, et à corriger un jour dans le classeur lui-même.
 */
const CORRECTIONS = [
  {
    account: '62811300',
    reason: 'compté deux fois dans « BUDGET EMA » : la feuille H&R affiche '
      + 'la ligne en L26 (= +L51) et en L51 ; le montant n’est pris qu’une fois '
      + '(arbitré par Alexis le 27/07/2026)',
    apply: (months) => months.map((value) => value / 2),
    expected: 9504.1,
  },
];

/**
 * Écarts ASSUMÉS avec la feuille « P&L SYNTHESE » : cas où le détail fait foi
 * contre le résumé. Chaque entrée décale le total de contrôle correspondant,
 * et l'écart doit alors être EXACTEMENT celui-là — ni plus, ni moins.
 *
 * 61351400 Contract services (Matériel) : la ligne de détail vaut 2 531,50 €
 * mais le sous-total de la feuille « Mat erial » est figé à 1 000 € (formule
 * cassée, L25 ne somme pas L23). Alexis a arbitré le 27/07/2026 : c'est le
 * montant total de la ligne qui compte. L'application porte donc 1 531,50 €
 * de charges de plus que le P&L Excel — jusqu'à correction du classeur.
 */
const ASSUMED_GAPS = [
  {
    account: '61351400',
    amount: 1531.5,
    reason: 'sous-total « Mat erial » figé à 1 000 € ; le détail (2 531,50 €) fait foi',
    affects: { charges: 1, gop: -1, ebitda: -1 },
  },
];

/* ------------------------------------------------------------------ */
/* Lecture                                                             */
/* ------------------------------------------------------------------ */

const sheets = readWorkbook(source);
const budget = sheets.get('BUDGET EMA');
const summary = sheets.get('P&L SYNTHESE');
if (!budget) throw new Error('Feuille « BUDGET EMA » absente du classeur.');
if (!summary) throw new Error('Feuille « P&L SYNTHESE » absente du classeur.');

const number = (value) => {
  const n = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

const lines = [];
for (const row of budget) {
  const account = String(row[0] ?? '').trim();
  if (!/^\d{8}$/.test(account)) continue;
  const months = row.slice(2, 2 + MONTHS).map(number);
  if (months.length !== MONTHS) continue;
  lines.push({ account, center: String(row[1] ?? '').trim(), months });
}

const applied = [];
for (const correction of CORRECTIONS) {
  const line = lines.find((l) => l.account === correction.account);
  if (!line) {
    console.warn(`Correction sans objet : compte ${correction.account} absent du budget`);
    continue;
  }
  const before = line.months.reduce((a, b) => a + b, 0);
  line.months = correction.apply(line.months).map((v) => Math.round(v * 100) / 100);
  const after = line.months.reduce((a, b) => a + b, 0);
  applied.push({ ...correction, before, after });
  if (Math.abs(after - correction.expected) > 0.5) {
    console.warn(`Correction ${correction.account} : ${after.toFixed(2)} au lieu de ${correction.expected}`);
  }
}

/** Totaux de contrôle, lus dans la feuille de synthèse (colonne F, année). */
const cell = (row, col) => number((summary[row - 1] ?? [])[col]);
const excelControls = {
  revenue: cell(15, 5),
  charges: cell(37, 5),
  otherTaxes: cell(34, 5),
  gop: cell(40, 5),
  ebitda: cell(42, 5),
};

/** Contrôles attendus = totaux Excel corrigés des écarts assumés. */
const controls = { ...excelControls };
for (const gap of ASSUMED_GAPS) {
  for (const [key, sign] of Object.entries(gap.affects)) {
    controls[key] += sign * gap.amount;
  }
}

/* ------------------------------------------------------------------ */
/* Recalcul avec le moteur de l'application                            */
/* ------------------------------------------------------------------ */

const prepared = prepareTypeScript(root, 'excel-grid-budget');
const chart = await import(join(prepared, 'src', 'engine', 'chart.ts'));

const budgetLines = lines
  .filter((line) => line.months.some((value) => value !== 0))
  .map((line, index) => {
    const account = chart.findAccount(line.account);
    return {
      id: `pat${String(index + 1).padStart(3, '0')}`,
      account: line.account,
      name: account ? account.label : `Compte ${line.account}`,
      amounts: line.months,
    };
  });

const unknown = budgetLines.filter((line) => !chart.findAccount(line.account));
const result = chart.summarize(budgetLines);

const round = (value) => Math.round(value * 100) / 100;
const computed = {
  revenue: round(chart.total(result.produits)),
  charges: round(chart.total(result.charges)),
  otherTaxes: round(chart.total(result.otherTaxes)),
  gop: round(chart.total(result.gop)),
  ebitda: round(chart.total(result.ebitda)),
};

/* ------------------------------------------------------------------ */
/* Rapport et contrôle                                                 */
/* ------------------------------------------------------------------ */

const euros = (value) => value.toLocaleString('fr-FR', { maximumFractionDigits: 0 });

console.log(`Budget importé depuis ${basename(source)} — feuille « BUDGET EMA »`);
console.log(`  ${lines.length} comptes lus, ${budgetLines.length} lignes non nulles retenues`);
if (unknown.length) {
  console.log(`  ${unknown.length} compte(s) hors plan comptable : ${unknown.map((l) => l.account).join(', ')}`);
}
if (result.rejected.length) {
  console.log(`  ${result.rejected.length} ligne(s) refusée(s) par le moteur :`);
  for (const item of result.rejected) console.log(`    - ${item.reason}`);
}
for (const correction of applied) {
  console.log(`  correction ${correction.account} : ${euros(correction.before)} -> ${euros(correction.after)}`);
  console.log(`    ${correction.reason}`);
}
for (const gap of ASSUMED_GAPS) {
  console.log(`  écart assumé ${gap.account} : ${euros(gap.amount)} — ${gap.reason}`);
}

console.log('\n  Rapprochement avec la feuille « P&L SYNTHESE » (corrigée des écarts assumés) :');
const rows = [
  ['Produits', computed.revenue, controls.revenue],
  ['Total des charges', computed.charges, controls.charges],
  ['dont Other Taxes', computed.otherTaxes, controls.otherTaxes],
  ['GOP', computed.gop, controls.gop],
  ['EBITDA', computed.ebitda, controls.ebitda],
];
let drift = 0;
for (const [label, mine, theirs] of rows) {
  const gap = round(mine - theirs);
  if (Math.abs(gap) > 1) drift++;
  console.log(
    `    ${label.padEnd(20)} app ${euros(mine).padStart(14)}   excel ${euros(theirs).padStart(14)}`
    + `   écart ${gap === 0 ? '0' : euros(gap)}`,
  );
}

if (drift) {
  console.error(`\n${drift} écart(s) supérieur(s) à 1 € : import interrompu, rien n’a été écrit.`);
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* Écriture                                                            */
/* ------------------------------------------------------------------ */

const generatedAt = new Date().toISOString().slice(0, 10);
const header = `/**
 * BUDGET ${YEAR} — FICHIER GÉNÉRÉ, NE PAS MODIFIER À LA MAIN.
 *
 * Source  : ${basename(source)}, feuille « BUDGET EMA »
 * Société : ${COMPANY}
 * Généré  : ${generatedAt} par scripts/import-budget.mjs
 *
 * Contrôlé contre la feuille « P&L SYNTHESE », corrigée des écarts assumés
 * (61351400 : le détail fait foi contre le sous-total figé) :
 *   GOP ${euros(controls.gop)} · EBITDA ${euros(controls.ebitda)}
 *   (P&L Excel brut : GOP ${euros(excelControls.gop)} · EBITDA ${euros(excelControls.ebitda)})
 *
 * Pour réimporter : node --experimental-strip-types scripts/import-budget.mjs "chemin.xlsx"
 */
import type { BudgetLine } from '../engine/chart';

export const BUDGET_COMPANY = ${JSON.stringify(COMPANY)};
export const BUDGET_YEAR = ${YEAR};
export const BUDGET_SOURCE = ${JSON.stringify(basename(source))};

/** Totaux du P&L Excel, servant de contrôle aux tests. */
export const BUDGET_CONTROLS = ${JSON.stringify(controls, null, 2)};

export const BUDGET_LINES: BudgetLine[] = [
`;

const body = budgetLines
  .map((line) => `  { id: '${line.id}', account: '${line.account}', name: ${JSON.stringify(line.name)}, `
    + `amounts: [${line.amounts.map((v) => round(v)).join(', ')}] },`)
  .join('\n');

writeFileSync(
  join(root, 'src', 'data', 'budget-patio-2026.generated.ts'),
  `${header}${body}\n];\n`,
  'utf8',
);

const htmlPath = join(projectRoot, 'budget-app.html');
if (existsSync(htmlPath)) {
  const html = readFileSync(htmlPath, 'utf8');
  const start = '/* BUDGET-DATA-START */';
  const end = '/* BUDGET-DATA-END */';
  if (html.includes(start) && html.includes(end)) {
    const before = html.slice(0, html.indexOf(start) + start.length);
    const after = html.slice(html.indexOf(end));
    const block = `\n    const SEED_BUDGET = ${JSON.stringify({
      company: COMPANY,
      year: YEAR,
      source: basename(source),
      controls,
      lines: budgetLines,
    })};\n    `;
    writeFileSync(htmlPath, before + block + after, 'utf8');
    console.log('\nbudget-app.html : budget embarqué mis à jour');
  } else {
    console.warn('\nbudget-app.html : marqueurs BUDGET-DATA absents, fichier laissé tel quel');
  }
}

console.log(`src/data/budget-patio-2026.generated.ts : ${budgetLines.length} lignes écrites`);
