/**
 * Import du budget annuel KOKORO depuis le classeur Excel du contrôle de
 * gestion — même principe général que scripts/import-medusa.mjs (PATIO,
 * MEDUSA), mais adapté à une structure de classeur très différente.
 *
 *   node --experimental-strip-types scripts/import-kokoro.mjs "chemin.xlsx"
 *
 * Différence avec PATIO/MEDUSA : ce classeur n'a pas de feuille
 * « BUDGET EMA » qui donnerait, compte par compte, le budget prêt à
 * l'emploi. Il a neuf feuilles départementales (une par centre de coût :
 * OP=F&B, A&G, H&R, Material, IT Systems, S&M, POMEC, SECURITE, et « Rent
 * Property and Other Taxes » pour RPOI), chacune avec ses propres lignes
 * de compte, ses douze colonnes mensuelles, et — pour huit d'entre elles —
 * une colonne « CODES ANALYTIQUES » donnant un ou plusieurs numéros de
 * compte à 6 chiffres de l'ANCIEN plan comptable (pas le plan 2026 à 8
 * chiffres utilisé par l'application). Le neuvième centre (RPOI, feuille
 * « Rent Property and Other Taxes ») n'a aucune colonne de code.
 *
 * Le script :
 *   1. lit chacune des huit feuilles codées à la position de colonnes qui
 *      lui est propre (elles ne sont pas toutes alignées : la colonne du
 *      budget annuel FY26 est H pour la plupart mais L pour S&M, et les
 *      douze colonnes mensuelles suivent le même décalage) ;
 *   2. convertit chaque code à 6 chiffres (parfois plusieurs par ligne,
 *      séparés par un tiret) en compte 2026 via le champ `legacy` du plan
 *      comptable (src/data/pcg.generated.ts) — quand une ligne porte
 *      plusieurs codes historiques pour un seul montant, le montant entier
 *      est affecté au premier compte qui se résout, comme le fait déjà la
 *      feuille de synthèse Excel elle-même (une ligne = un montant) ;
 *   3. pour RPOI (pas de code), affecte les quatre lignes de charges fixes
 *      (Loyer, Taxes, Assurance, Autres) à des comptes RPOI génériques du
 *      plan 2026 — décision explicite documentée ci-dessous, comme les
 *      « écarts assumés » de PATIO/MEDUSA ;
 *   4. recalcule le P&L avec le moteur de l'application ;
 *   5. compare au Revenue / GOP / EBITDA / Payroll de la feuille
 *      « P&L SYNTHESE » ET, feuille par feuille, à chaque « Total
 *      Departmental Expenses » — et échoue si un seul écart dépasse 1 €.
 *
 * Sorties : src/data/budget-kokoro-2026.generated.ts et l'entrée « Kokoro »
 * du tableau SEED_BUDGETS embarqué dans ../budget-app.html.
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readWorkbook } from './lib/xlsx-read.mjs';
import { prepareTypeScript } from './lib/prepare-ts.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = join(root, '..');

const source = process.argv[2];
if (!source || !existsSync(source)) {
  console.error(`Fichier introuvable : ${source ?? '(aucun chemin fourni)'}`);
  process.exit(1);
}

const COMPANY = 'Kokoro';
const YEAR = 2026;
const MONTHS = 12;

/* ------------------------------------------------------------------ */
/* Décisions explicites (RPOI n'a pas de colonne de code)               */
/* ------------------------------------------------------------------ */

/**
 * La feuille « Rent Property and Other Taxes » n'a, contrairement aux huit
 * autres feuilles départementales, aucune colonne « CODES ANALYTIQUES »
 * remplie pour la plupart de ses lignes : trois totaux (Rent / Property &
 * Other Taxes / Insurance) ne pointent vers aucun compte précis du plan
 * comptable. On les affecte à un compte générique du centre RPOI, plutôt
 * qu'à un compte inventé — décision explicite, réversible, dans l'esprit
 * des écarts assumés PATIO/MEDUSA. « Management Fees » (feuille séparée,
 * tout à zéro pour ce budget) suit la même logique mais n'a aucune ligne
 * non nulle à affecter.
 *
 * Le quatrième total, « Non Operating Other Expense » (ligne 44), est traité
 * séparément ci-dessous (RPOI_OTHER_EXPENSE_ROWS) : c'est en fait un
 * sous-total de lignes de détail, et Alexis a commencé à coder l'une
 * d'elles (colonne X).
 */
const RPOI_MANUAL_LINES = [
  { row: 24, label: 'Rent Expense Hotels', account: '61320900' },
  { row: 31, label: 'Property & Other Taxes', account: '63512900' },
  { row: 37, label: 'Insurance', account: '61630900' },
];

/**
 * « Non Operating Other Expense » (ligne 44 de la feuille RPOI) est le
 * sous-total de quatre lignes de détail juste au-dessus (40-43 : Non
 * Operating Cost Recovery Expense, Owner Expenses, Gain/Loss on Fixed
 * Assets Hotel, Unrealized Foreign Exchange Gain/Loss) — vérifié : ligne 44
 * = somme des lignes 40-43, à la fois en montant total (1 166,67 €) et sur
 * chaque mois.
 *
 * Alexis, 17/08/2026 : « j'ai modifié le compte des 1167, réimporte » —
 * elle a ajouté le code 635839 (colonne X) sur la ligne 40, qui pointe vers
 * le compte 63583900 « Redevances Ordures ». On décompose donc cette ligne
 * plutôt que de continuer à l'affecter au compte RPOI générique 65800900 —
 * même principe que la décomposition de « H&R Expense » plus haut. Toute
 * ligne de détail qui resterait sans code (colonne X vide, comme 41-43
 * aujourd'hui) retombe sur ce compte générique, pour ne jamais perdre un
 * montant en silence si une ligne y apparaît sans être codée.
 */
const RPOI_OTHER_EXPENSE_ROWS = [40, 41, 42, 43];
const RPOI_OTHER_EXPENSE_FALLBACK_ACCOUNT = '65800900';

/**
 * Quelques lignes des feuilles départementales portent un montant mais
 * aucun code analytique — la colonne « CODES ANALYTIQUES » est simplement
 * restée vide. Sans mappage, elles étaient silencieusement ignorées et le
 * total du centre divergeait de son « Total Departmental Expenses »
 * (constaté sur le classeur du 14/08/2026 : 32 216 € de H&R et 750 € d'A&G
 * manquants, soit un EBITDA faussement supérieur de 32 966 €).
 *
 * Chaque ligne est rattachée ici au compte 2026 le plus proche de son
 * libellé, dans le centre de coûts de sa propre feuille — même principe et
 * même niveau d'explicitation que RPOI ci-dessus.
 *
 * Les autres lignes sans code sont ignorées : ce sont les sous-totaux des
 * feuilles (« Total Other Expenses », « Gross Profit », « Utilities » de
 * POMEC…), déjà couverts par leurs lignes de détail — les compter ferait
 * doubler les montants. Le filet de sécurité contre un oubli reste le
 * rapprochement à 1 € près, feuille par feuille, en fin de script : c'est
 * lui qui a fait apparaître les trois lignes ci-dessus.
 */
const UNCODED_MANUAL_LINES = [
  { sheet: 'H&R', row: 25, label: 'Travel Expense', account: '62510300' },
  { sheet: 'A&G', row: 24, label: 'Training and Education Expense', account: '64801200' },
];

/**
 * H&R : « H&R Expense » (ligne 23 du tableau principal, sans code
 * analytique) se décompose entièrement dans le détail sous le tableau
 * (lignes 45-54 : prestataires RH externalisés), qui lui, porte de vrais
 * codes — dans une colonne différente de celle du tableau principal, d'où
 * l'oubli initial. Vérifié au centime près : SILAE + VEILLEROT + AMETRA +
 * RECRUITMENT + DRH + GESTION SOCIALE PBEX = 21 465,80896 €, exactement le
 * montant de la ligne 23 (voir script de vérification, aucun écart).
 *
 * Cas particulier : DRH (ligne 53) et GESTION SOCIALE PBEX (ligne 54)
 * portent le code 613512 — qui est en réalité le code du centre AG
 * (Administration) pour « Contract services », pas un code HR (aucun compte
 * HR ne se termine par « 3512 »). Reprendre ce code tel quel ferait glisser
 * 4 239,48 € du centre HR vers AG et casserait le rapprochement par centre.
 * Ces deux lignes sont donc rattachées ici au compte HR le plus proche
 * sémantiquement (prestataires RH externalisés, comme SILAE/Veillerot)
 * plutôt qu'à un compte d'un autre centre — à confirmer avec Alexis si ce
 * code du classeur est en fait volontaire.
 *
 * VISA (ligne 55, code 613512, 1 500 €) a bien un code lui aussi, mais
 * n'entre PAS dans le total Excel de « H&R Expense » ni de « Total Other
 * Expenses » (leurs propres formules l'excluent) : on ne l'ajoute pas non
 * plus, pour rester à l'euro près du classeur.
 */
const HR_SUBDETAIL_GROUPS = [
  { account: '62262300', label: 'RH externalisée (SILAE, Veillerot, DRH, Gestion sociale PBEX)', rows: [45, 46, 53, 54] },
  { account: '64811300', label: 'Pharmacie - médecine du travail (Ametra)', rows: [47] },
  { account: '62261300', label: 'Frais de recrutement', rows: [48] },
];

/* ------------------------------------------------------------------ */
/* Position des feuilles départementales                               */
/* ------------------------------------------------------------------ */

const col = (letter) => {
  let n = 0;
  for (const ch of letter) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};
const range = (fromLetter, toLetter) => {
  const a = col(fromLetter);
  const b = col(toLetter);
  const out = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
};

const DEPARTMENTS = [
  { sheet: 'OP', codeCol: col('Y'), rows: [14, 74] },
  { sheet: 'A&G', codeCol: col('Z'), rows: [16, 52] },
  { sheet: 'H&R', codeCol: col('Y'), rows: [16, 32] },
  { sheet: 'Material', codeCol: col('Z'), rows: [16, 25] },
  { sheet: 'IT Systems', codeCol: col('Y'), rows: [15, 30] },
  { sheet: 'S&M', codeCol: col('AC'), monthCols: range('N', 'Y'), rows: [15, 49] },
  { sheet: 'POMEC', codeCol: col('Y'), rows: [16, 55] },
  // SECURITE : on s'arrête à « Total Other Expenses » (ligne 27). Les lignes
  // 35+ (« Quinze prestige sécurité » 270 000 € y compris) sont un bloc
  // statistique hors chaîne P&L — ni référencées par P&L CONSO 26 ni
  // reprises dans « Total Departmental Expenses » (ligne 29, qui vaut 0).
  // Les inclure ferait diverger le contrôle de 270 000 €.
  { sheet: 'SECURITE', codeCol: col('Y'), rows: [16, 27] },
].map((d) => ({ ...d, monthCols: d.monthCols ?? range('J', 'U') }));

const RPOI_SHEET = 'Rent Property and Other Taxes';

/* ------------------------------------------------------------------ */
/* Lecture                                                              */
/* ------------------------------------------------------------------ */

const sheets = readWorkbook(source);
for (const d of DEPARTMENTS) if (!sheets.has(d.sheet)) throw new Error(`Feuille « ${d.sheet} » absente du classeur.`);
if (!sheets.has(RPOI_SHEET)) throw new Error(`Feuille « ${RPOI_SHEET} » absente du classeur.`);
if (!sheets.has('P&L SYNTHESE')) throw new Error('Feuille « P&L SYNTHESE » absente du classeur.');

const number = (value) => {
  const n = Number(String(value ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Extrait tous les numéros à 6 chiffres d'une cellule code, quel que soit le
 * séparateur (tiret, virgule, apostrophe). Les espaces sont retirés avant la
 * recherche : au moins une ligne du classeur (« Cost of Food Sales », OP
 * ligne 38) porte le code sous la forme « 601 201 » — un espace au milieu
 * d'un seul code à 6 chiffres, pas un séparateur entre deux codes. Sans ce
 * nettoyage, ce chiffre (570 067,14 €, le plus gros poste de coût des
 * ventes) serait silencieusement perdu.
 */
function splitCodes(raw) {
  const text = String(raw ?? '').replace(/\s+/g, '');
  return [...text.matchAll(/\d{6}/g)].map((m) => m[0]);
}

/* ------------------------------------------------------------------ */
/* Plan comptable : index compte historique -> compte 2026              */
/* ------------------------------------------------------------------ */

const prepared = prepareTypeScript(root, 'excel-grid-kokoro');
const chart = await import(join(prepared, 'src', 'engine', 'chart.ts'));

const legacyIndex = new Map();
for (const account of chart.ACCOUNTS) {
  for (const code of account.legacy ?? []) {
    if (!legacyIndex.has(code)) legacyIndex.set(code, account);
  }
}

/* ------------------------------------------------------------------ */
/* Extraction des lignes de budget                                     */
/* ------------------------------------------------------------------ */

const rawLines = []; // { sheet, row, label, codes, account2026, amounts[12] }
const unresolvedCodes = []; // { sheet, row, label, code }
const noCodeCell = []; // lignes avec un montant mais aucun code (hors RPOI)

for (const dept of DEPARTMENTS) {
  const rows = sheets.get(dept.sheet);
  const [from, to] = dept.rows;
  for (let r = from; r <= to; r++) {
    const line = rows[r - 1];
    if (!line) continue;
    const rawCode = line[dept.codeCol];
    const codes = splitCodes(rawCode);
    const label = String(line[0] ?? '').trim();
    const amounts = dept.monthCols.map((c) => number(line[c]));
    if (amounts.every((v) => v === 0)) continue;

    // Ligne chiffrée mais sans code : mappage manuel explicite, sinon on
    // interrompt l'import plutôt que de la perdre en silence.
    if (!codes.length) {
      const manual = UNCODED_MANUAL_LINES.find((m) => m.sheet === dept.sheet && m.row === r);
      if (!manual) { noCodeCell.push({ sheet: dept.sheet, row: r, label, total: amounts.reduce((a, b) => a + b, 0) }); continue; }
      rawLines.push({ sheet: dept.sheet, row: r, label, account: manual.account, amounts, manual: true });
      continue;
    }

    let account2026 = null;
    for (const code of codes) {
      const found = legacyIndex.get(code);
      if (found) { account2026 = found; break; }
    }
    if (!account2026) {
      unresolvedCodes.push({ sheet: dept.sheet, row: r, label, code: codes.join('-') });
      continue;
    }
    rawLines.push({ sheet: dept.sheet, row: r, label, account: account2026.account, amounts });
  }
}

// RPOI : quatre lignes sans code, affectées manuellement (voir plus haut).
{
  const rows = sheets.get(RPOI_SHEET);
  for (const manual of RPOI_MANUAL_LINES) {
    const line = rows[manual.row - 1];
    if (!line) continue;
    const amounts = range('J', 'U').map((c) => number(line[c]));
    if (amounts.every((v) => v === 0)) continue;
    rawLines.push({ sheet: RPOI_SHEET, row: manual.row, label: manual.label, account: manual.account, amounts });
  }
}

// RPOI : détail de « Non Operating Other Expense » (voir
// RPOI_OTHER_EXPENSE_ROWS ci-dessus), une ligne de compte par ligne de
// détail plutôt qu'un groupe (contrairement à H&R, chaque ligne ici peut
// avoir son propre code, ou aucun).
{
  const rows = sheets.get(RPOI_SHEET);
  const monthCols = range('J', 'U');
  const codeCol = col('X');
  for (const r of RPOI_OTHER_EXPENSE_ROWS) {
    const line = rows[r - 1];
    if (!line) continue;
    const amounts = monthCols.map((c) => number(line[c]));
    if (amounts.every((v) => v === 0)) continue;
    const label = String(line[0] ?? '').trim();
    const codes = splitCodes(line[codeCol]);
    let account2026 = null;
    for (const code of codes) {
      const found = legacyIndex.get(code);
      if (found) { account2026 = found; break; }
    }
    if (codes.length && !account2026) {
      unresolvedCodes.push({ sheet: RPOI_SHEET, row: r, label, code: codes.join('-') });
      continue;
    }
    const account = account2026 ? account2026.account : RPOI_OTHER_EXPENSE_FALLBACK_ACCOUNT;
    rawLines.push({ sheet: RPOI_SHEET, row: r, label, account, amounts });
  }
}

// H&R : détail sous le tableau principal, décomposant « H&R Expense »
// (voir HR_SUBDETAIL_GROUPS ci-dessus).
{
  const rows = sheets.get('H&R');
  const monthCols = range('J', 'U');
  for (const group of HR_SUBDETAIL_GROUPS) {
    const amounts = monthCols.map((c) => group.rows.reduce((sum, r) => sum + number((rows[r - 1] ?? [])[c]), 0));
    if (amounts.every((v) => v === 0)) continue;
    rawLines.push({ sheet: 'H&R', row: group.rows[0], label: group.label, account: group.account, amounts });
  }
}

if (unresolvedCodes.length) {
  console.error(`${unresolvedCodes.length} code(s) historique(s) introuvable(s) dans le plan comptable — import interrompu :`);
  for (const u of unresolvedCodes) console.error(`  ${u.sheet} ligne ${u.row} (${u.label}) : ${u.code}`);
  process.exit(1);
}

/** Totaux de contrôle, lus dans « P&L SYNTHESE » (colonne H = FY26 BUD, ligne = année). */
const synthese = sheets.get('P&L SYNTHESE');
const cell = (row, colLetter) => number((synthese[row - 1] ?? [])[col(colLetter)]);
const excelControls = {
  revenue: cell(15, 'H'),
  charges: cell(37, 'H'),
  otherTaxes: cell(34, 'H'),
  gop: cell(40, 'H'),
  ebitda: cell(42, 'H'),
  payroll: cell(45, 'H'),
};

/**
 * Totaux de contrôle par centre (hors masse salariale, exclue de `byCenter`
 * par le moteur — voir chart.ts). Pour la plupart des feuilles, une seule
 * cellule « Total Other/Departmental Expenses » suffit. OP (F&B) est un cas
 * à part : sa ligne 74 « Total Other Expenses » n'inclut PAS le coût des
 * ventes (Cost of Sales, ligne 42) — qui est pourtant bien un compte F&B
 * non-payroll, donc bien dans `byCenter['F&B']` côté application. Le
 * contrôle F&B additionne donc les deux lignes.
 */
const DEPARTMENTAL_TOTAL_CELLS = {
  'OP': [['H', 42], ['H', 74]],  // Cost of F&B Sales + Total Other Expenses (hors payroll)
  'A&G': [['H', 52]],
  'H&R': [['H', 32]],
  'Material': [['H', 25]],
  'IT Systems': [['H', 30]],
  'S&M': [['L', 49]],
  'POMEC': [['H', 57]],          // Total Departmental Expenses (payroll = 0 sur ce budget)
  'SECURITE': [['H', 27]],
};
const CENTER_BY_SHEET = {
  'OP': 'F&B', 'A&G': 'AG', 'H&R': 'HR', 'Material': 'MAT', 'IT Systems': 'IT',
  'S&M': 'MARK', 'POMEC': 'POMEC', 'SECURITE': 'SECU',
};
const centerControls = {};
for (const [sheetName, cells] of Object.entries(DEPARTMENTAL_TOTAL_CELLS)) {
  const rows = sheets.get(sheetName);
  const v = cells.reduce((sum, [colLetter, rowNum]) => sum + number((rows[rowNum - 1] ?? [])[col(colLetter)]), 0);
  centerControls[CENTER_BY_SHEET[sheetName]] = v;
}
{
  const rows = sheets.get(RPOI_SHEET);
  centerControls.RPOI = number((rows[46 - 1] ?? [])[col('H')]); // Total Non-Operating Income and Expenses
}

/* ------------------------------------------------------------------ */
/* Recalcul avec le moteur de l'application                            */
/* ------------------------------------------------------------------ */

const budgetLines = rawLines.map((line, index) => {
  const account = chart.findAccount(line.account);
  return {
    id: `kok${String(index + 1).padStart(3, '0')}`,
    account: line.account,
    name: `${line.label} (${line.sheet})`,
    amounts: line.amounts.map((v) => Math.round(v * 100) / 100),
    _sheetAccount: line.account,
  };
});
void budgetLines.map((l) => chart.findAccount(l.account)); // sanity, all resolved above

const result = chart.summarize(budgetLines);

const round = (value) => Math.round(value * 100) / 100;
const computed = {
  revenue: round(chart.total(result.produits)),
  charges: round(chart.total(result.charges)),
  otherTaxes: round(chart.total(result.otherTaxes)),
  gop: round(chart.total(result.gop)),
  ebitda: round(chart.total(result.ebitda)),
  payroll: round(chart.total(result.payroll)),
};

const computedByCenter = {};
for (const id of Object.keys(centerControls)) {
  computedByCenter[id] = round(chart.total(result.byCenter[id]));
}

/* ------------------------------------------------------------------ */
/* Rapport et contrôle                                                 */
/* ------------------------------------------------------------------ */

const euros = (value) => value.toLocaleString('fr-FR', { maximumFractionDigits: 0 });

console.log(`Budget importé depuis ${basename(source)} — 8 feuilles départementales + RPOI`);
console.log(`  ${rawLines.length} ligne(s) de budget non nulle(s) retenue(s)`);
if (result.rejected.length) {
  console.log(`  ${result.rejected.length} ligne(s) refusée(s) par le moteur :`);
  for (const item of result.rejected) console.log(`    - ${item.reason}`);
}
for (const m of RPOI_MANUAL_LINES) console.log(`  RPOI sans code : « ${m.label} » -> compte ${m.account} (décision documentée en tête de script)`);
for (const line of rawLines.filter((l) => l.sheet === RPOI_SHEET && RPOI_OTHER_EXPENSE_ROWS.includes(l.row))) {
  console.log(`  RPOI ligne ${line.row} (détail « Non Operating Other Expense ») : « ${line.label} » -> compte ${line.account}`
    + (line.account === RPOI_OTHER_EXPENSE_FALLBACK_ACCOUNT ? ' (sans code, compte générique)' : ' (codée par Alexis)'));
}
for (const m of UNCODED_MANUAL_LINES) console.log(`  ${m.sheet} ligne ${m.row} sans code : « ${m.label} » -> compte ${m.account} (décision documentée en tête de script)`);
for (const g of HR_SUBDETAIL_GROUPS) console.log(`  H&R détail (lignes ${g.rows.join(',')}) : « ${g.label} » -> compte ${g.account} (décomposition documentée en tête de script)`);

console.log('\n  Rapprochement avec la feuille « P&L SYNTHESE » :');
let drift = 0;
const rows = [
  ['Produits', computed.revenue, excelControls.revenue],
  ['Total des charges', computed.charges, excelControls.charges],
  ['dont Other Taxes (RPOI)', computed.otherTaxes, excelControls.otherTaxes],
  ['GOP', computed.gop, excelControls.gop],
  ['EBITDA', computed.ebitda, excelControls.ebitda],
  ['PAYROLL', computed.payroll, excelControls.payroll],
];
for (const [label, mine, theirs] of rows) {
  const gap = round(mine - theirs);
  if (Math.abs(gap) > 1) drift++;
  console.log(`    ${label.padEnd(26)} app ${euros(mine).padStart(14)}   excel ${euros(theirs).padStart(14)}   écart ${gap === 0 ? '0' : euros(gap)}`);
}

console.log('\n  Rapprochement par centre de coût (hors masse salariale, ligne « Total Departmental/Other Expenses ») :');
for (const [id, theirs] of Object.entries(centerControls)) {
  const mine = computedByCenter[id] ?? 0;
  const gap = round(mine - theirs);
  if (Math.abs(gap) > 1) drift++;
  console.log(`    ${id.padEnd(6)} app ${euros(mine).padStart(12)}   excel ${euros(theirs).padStart(12)}   écart ${gap === 0 ? '0' : euros(gap)}`);
}

if (drift) {
  console.error(`\n${drift} écart(s) supérieur(s) à 1 € : import interrompu, rien n’a été écrit.`);
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* Écriture                                                            */
/* ------------------------------------------------------------------ */

const generatedAt = new Date().toISOString().slice(0, 10);
const controls = { revenue: excelControls.revenue, charges: excelControls.charges, otherTaxes: excelControls.otherTaxes, gop: excelControls.gop, ebitda: excelControls.ebitda };

const header = `/**
 * BUDGET ${YEAR} — FICHIER GÉNÉRÉ, NE PAS MODIFIER À LA MAIN.
 *
 * Source  : ${basename(source)}
 * Société : ${COMPANY}
 * Généré  : ${generatedAt} par scripts/import-kokoro.mjs
 *
 * Contrôlé contre la feuille « P&L SYNTHESE » ET, feuille par feuille,
 * contre chaque « Total Departmental Expenses » (voir le script pour le
 * détail des neuf centres) :
 *   Revenue ${euros(controls.revenue)} · GOP ${euros(controls.gop)} · EBITDA ${euros(controls.ebitda)}
 *
 * RPOI (feuille « Rent Property and Other Taxes ») n'a pas de colonne de
 * code : ses quatre lignes sont affectées à des comptes RPOI génériques,
 * décision documentée en tête de scripts/import-kokoro.mjs.
 *
 * Pour réimporter : node --experimental-strip-types scripts/import-kokoro.mjs "chemin.xlsx"
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
  join(root, 'src', 'data', 'budget-kokoro-2026.generated.ts'),
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
    const blockText = html.slice(html.indexOf(start) + start.length, html.indexOf(end));
    const after = html.slice(html.indexOf(end));

    const match = blockText.match(/const SEED_BUDGETS = (\[[\s\S]*\]);/);
    if (!match) {
      console.error('\nbudget-app.html : SEED_BUDGETS introuvable dans le bloc BUDGET-DATA, rien n’a été écrit dans le HTML.');
      process.exit(1);
    }
    const seeds = JSON.parse(match[1]);
    const entry = {
      company: COMPANY,
      year: YEAR,
      source: basename(source),
      controls,
      lines: budgetLines.map(({ id, account, name, amounts }) => ({ id, account, name, amounts })),
    };
    const existingIndex = seeds.findIndex((s) => s.company === COMPANY);
    if (existingIndex >= 0) seeds[existingIndex] = entry;
    else seeds.push(entry);

    const newBlock = `\n    const SEED_BUDGETS = ${JSON.stringify(seeds)};\n    `;
    writeFileSync(htmlPath, before + newBlock + after, 'utf8');
    console.log(`\nbudget-app.html : budget embarqué mis à jour (${seeds.length} société(s) : ${seeds.map((s) => s.company).join(', ')})`);
  } else {
    console.warn('\nbudget-app.html : marqueurs BUDGET-DATA absents, fichier laissé tel quel');
  }
}

console.log(`src/data/budget-kokoro-2026.generated.ts : ${budgetLines.length} lignes écrites`);
