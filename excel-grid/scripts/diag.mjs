import fs from 'node:fs';
/**
 * Contrôle anti-divergence entre les deux implémentations.
 *
 *   node --experimental-strip-types scripts/check-budget-app.mjs
 *
 * `budget-app.html` embarque sa propre copie du noyau métier (elle doit
 * fonctionner seule, sans build ni réseau). Ce script extrait ce noyau du
 * HTML, l'exécute, et compare ses résultats à ceux de `src/engine/chart.ts`
 * sur une série de scénarios. Si les deux versions des règles de gestion
 * s'éloignent — un centre déplacé, une formule de GOP retouchée d'un seul
 * côté — le contrôle échoue avant que quiconque ne présente des chiffres faux.
 */
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { strict as assert } from 'node:assert';
import { prepareTypeScript } from './lib/prepare-ts.mjs';
import { readWorkbook } from './lib/xlsx-read.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = join(root, '..', 'budget-app.html');

/* --- 1. Extraction du noyau embarqué dans le HTML --------------------- */

const html = readFileSync(htmlPath, 'utf8');

function between(source, startMark, endMark, what) {
  const start = source.indexOf(startMark);
  const end = source.indexOf(endMark);
  if (start < 0 || end < 0 || end < start) {
    throw new Error(`Marqueurs ${what} introuvables dans budget-app.html`);
  }
  return source.slice(start + startMark.length, end);
}

const data = between(html, '/* PCG-DATA-START */', '/* PCG-DATA-END */', 'de données');
const budgetData = between(html, '/* BUDGET-DATA-START */', '/* BUDGET-DATA-END */', 'de budget');
const emasphereData = between(html, '/* EMASPHERE-DATA-START */', '/* EMASPHERE-DATA-END */', 'EmaSphère');
const core = between(html, '/* CORE-START */', '/* CORE-END */', 'du noyau');

const moduleSource = `${data}\n${core}\n export {
  COST_CENTERS, RATIO_GROUPS, PCG_ACCOUNTS, ACCOUNTS, CENTER_OVERRIDES, PCG_SOURCE,
  summarize, findAccount, categoryOf, costCenter,
  accountsOfCenter, unclassifiedCharges, searchAccounts, total
};`;

const web = await import(
  `data:text/javascript;charset=utf-8,${encodeURIComponent(moduleSource)}`
);

/* --- 2. Chargement du moteur TypeScript ------------------------------- */

const prepared = prepareTypeScript(root, 'excel-grid-check');
const ts = await import(join(prepared, 'src', 'engine', 'chart.ts'));
const budgetModule = await import(join(prepared, 'src', 'data', 'budget-patio-2026.generated.ts'));
const medusaModule = await import(join(prepared, 'src', 'data', 'budget-medusa-2026.generated.ts'));
const kokoroModule = await import(join(prepared, 'src', 'data', 'budget-kokoro-2026.generated.ts'));

/* --- 3. Comparaisons -------------------------------------------------- */

const problems = [];
let performed = 0;
const check = (name, fn) => {
  performed++;
  try { fn(); } catch (e) { problems.push(`${name} : ${e.message}`); }
};
/** Variante attendue : sans le `await`, un échec passerait inaperçu. */
const checkAsync = async (name, fn) => {
  performed++;
  try { await fn(); } catch (e) { problems.push(`${name} : ${e.message}`); }
};

check('plan comptable identique, reclassements compris', () => {
  assert.equal(web.ACCOUNTS.length, ts.ACCOUNTS.length);
  assert.equal(JSON.stringify(web.ACCOUNTS), JSON.stringify(ts.ACCOUNTS));
  assert.deepEqual(
    JSON.parse(JSON.stringify(web.CENTER_OVERRIDES)),
    JSON.parse(JSON.stringify(ts.CENTER_OVERRIDES)),
  );
});

check('centres de coûts identiques', () => {
  assert.deepEqual(web.COST_CENTERS, ts.COST_CENTERS);
});

check('groupes de ratios identiques', () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(web.RATIO_GROUPS)),
    JSON.parse(JSON.stringify(ts.RATIO_GROUPS)),
  );
});

check('comptes à classer identiques', () => {
  assert.deepEqual(
    web.unclassifiedCharges().map((a) => a.account),
    ts.unclassifiedCharges().map((a) => a.account),
  );
});

check('recherche identique', () => {
  for (const query of ['601101', 'loyer', '70101100', 'assurance']) {
    assert.deepEqual(
      web.searchAccounts(query, 20).map((a) => a.account),
      ts.searchAccounts(query, 20).map((a) => a.account),
      `requête « ${query} »`,
    );
  }
});

/** Scénarios de budget passés aux deux moteurs. */
const months = (value) => new Array(12).fill(value);
const scenarios = {
  'produits et charges simples': [
    { id: '1', account: '70101100', name: 'Bar', amounts: months(1000) },
    { id: '2', account: '60101100', name: 'Boissons', amounts: months(300) },
    { id: '3', account: '61320900', name: 'Loyer', amounts: months(200) },
  ],
  'tous les centres de coûts': [
    { id: '1', account: '70105100', name: 'Restaurant', amounts: months(5000) },
    { id: '2', account: '60103100', name: 'Denrées', amounts: months(1500) },
    { id: '3', account: '62110900', name: 'Intérim', amounts: months(400) },
    { id: '4', account: '63511900', name: 'CFE', amounts: months(120) },
    { id: '5', account: '60610100', name: 'Nettoyage', amounts: months(90) },
  ],
  'lignes refusées': [
    { id: '1', account: '99999999', name: 'Inconnu', amounts: months(10) },
    { id: '2', account: '10100000', name: 'Capital', amounts: months(10) },
    { id: '3', account: '61110100', name: 'Sous-traitance groupe', amounts: months(10) },
    { id: '4', account: '60101100', name: '  ', amounts: months(10) },
    { id: '5', account: '60101100', name: 'Cave', amounts: months(10) },
  ],
  'montants irréguliers': [
    { id: '1', account: '70103100', name: 'Dîner', amounts: [0, 0, 500, 900, 1200, 3000, 4000, 4200, 1500, 300, 0, 0] },
    { id: '2', account: '60101100', name: 'Cave', amounts: [0, 0, 150, 300, 400, 900, 1200, 1300, 500, 100, 0, 0] },
    { id: '3', account: '61610900', name: 'Assurance RC', amounts: months(80) },
  ],
  'budget vide': [],
};

for (const [name, lines] of Object.entries(scenarios)) {
  check(`agrégation — ${name}`, () => {
    const a = web.summarize(lines);
    const b = ts.summarize(lines);
    for (const key of ['produits', 'charges', 'chargesGop', 'otherTaxes', 'gop', 'ebitda']) {
      assert.deepEqual(a[key], b[key], key);
    }
    assert.deepEqual(a.byCenter, b.byCenter, 'byCenter');
    assert.deepEqual(a.byCategory, b.byCategory, 'byCategory');
    assert.deepEqual(a.byAccount, b.byAccount, 'byAccount');
    assert.deepEqual(a.ratios, b.ratios, 'ratios');
    assert.deepEqual(a.ratioRows, b.ratioRows, 'ratioRows');
    assert.deepEqual(a.foodBeverage, b.foodBeverage, 'foodBeverage');
    assert.deepEqual(a.revenueSplit, b.revenueSplit, 'revenueSplit');
    assert.deepEqual(
      a.rejected.map((r) => r.reason),
      b.rejected.map((r) => r.reason),
      'refus',
    );
  });
}

/* Cohérence interne : GOP et EBITDA doivent retomber sur leurs définitions. */
check('GOP et EBITDA cohérents avec leurs définitions', () => {
  const summary = ts.summarize(scenarios['tous les centres de coûts']);
  const gop = ts.total(summary.produits) - (ts.total(summary.charges) - ts.total(summary.otherTaxes));
  const ebitda = ts.total(summary.produits) - ts.total(summary.charges);
  assert.equal(ts.total(summary.gop), gop);
  assert.equal(ts.total(summary.ebitda), ebitda);
  assert.equal(ts.total(summary.chargesGop) + ts.total(summary.otherTaxes), ts.total(summary.charges));
});

/* --- 4. L'application tourne-t-elle ? --------------------------------- */

/**
 * Faute de navigateur ici, on monte un DOM factice minimal et on demande à
 * l'application de se rendre entièrement. Ça ne remplace pas un test visuel,
 * mais ça attrape ce qui casse vraiment : une faute de frappe, une fonction
 * disparue, une exception au rendu d'un onglet.
 */
function stubDom() {
  const elements = new Map();
  const element = (id) => {
    const classes = new Set();
    const attrs = new Map();
    return {
      id,
      innerHTML: '',
      textContent: '',
      value: '',
      style: {},
      dataset: {},
      files: [],
      // Un vrai Set derrière classList (pas juste des no-op) : certains
      // écrans (ex. le panneau latéral du compte) se testent en relisant
      // l'état posé par toggle()/add()/remove() via contains().
      classList: {
        toggle(name, force) {
          const on = force === undefined ? !classes.has(name) : Boolean(force);
          if (on) classes.add(name); else classes.delete(name);
          return on;
        },
        add(name) { classes.add(name); },
        remove(name) { classes.delete(name); },
        contains(name) { return classes.has(name); },
      },
      setAttribute(name, value) { attrs.set(name, String(value)); },
      getAttribute(name) { return attrs.has(name) ? attrs.get(name) : null; },
      removeAttribute(name) { attrs.delete(name); },
      addEventListener() {},
      querySelector: () => null,
      querySelectorAll: () => [],
      appendChild() {}, remove() {}, click() {}, focus() {}, setSelectionRange() {},
    };
  };

  const blobs = [];
  // <html> factice : mêmes méthodes qu'un vrai élément DOM, juste assez
  // pour que les tests puissent poser/relire des attributs et des
  // variables CSS. `style` sert à `applyEnvironmentTheme()`, qui écrit
  // directement `--navy` / `--navy-deep` en style en ligne plutôt que de
  // passer par une classe/attribut CSS.
  const htmlAttributes = new Map();
  const htmlStyleProps = new Map();
  const documentElement = {
    setAttribute(name, value) { htmlAttributes.set(name, String(value)); },
    removeAttribute(name) { htmlAttributes.delete(name); },
    getAttribute(name) { return htmlAttributes.has(name) ? htmlAttributes.get(name) : null; },
    hasAttribute(name) { return htmlAttributes.has(name); },
    style: {
      setProperty(name, value) { htmlStyleProps.set(name, String(value)); },
      removeProperty(name) { htmlStyleProps.delete(name); },
      getPropertyValue(name) { return htmlStyleProps.has(name) ? htmlStyleProps.get(name) : ''; },
    },
    // Stub minimal pour `exportStandaloneAppData()` : un vrai navigateur
    // renvoie ici la page telle qu'elle tourne (le `<script>` garde son
    // texte d'origine) ; ce faux balisage suffit à vérifier, côté tests
    // Node, que la fonction sait retirer une éventuelle ancienne copie
    // intégrée et injecter la nouvelle juste avant `</html>`.
    get outerHTML() {
      return '<html><head></head><body><script>/* app */</script></body></html>';
    },
  };
  globalThis.document = {
    documentElement,
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element(id));
      return elements.get(id);
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => element('a'),
    body: { appendChild() {} },
    // Le pavé numérique de la calculatrice s'écoute sur `document` (pas
    // seulement `#view`) : sans ce stub, le simple chargement du module
    // lèverait dès l'import, avant même d'atteindre le premier contrôle.
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.localStorage = {
    data: new Map(),
    getItem(key) { return this.data.has(key) ? this.data.get(key) : null; },
    setItem(key, value) { this.data.set(key, String(value)); },
    removeItem(key) { this.data.delete(key); },
    get length() { return this.data.size; },
    key(index) { return Array.from(this.data.keys())[index] ?? null; },
  };
  globalThis.alert = () => {};
  globalThis.confirm = () => true;
  globalThis.prompt = () => null;
  globalThis.URL.createObjectURL = (blob) => { blobs.push(blob); return 'blob:test'; };
  globalThis.URL.revokeObjectURL = () => {};
  return { elements, blobs };
}

const appSource = html.slice(html.lastIndexOf('<script>') + '<script>'.length, html.lastIndexOf('</script>'));
const dom = stubDom();
/**
 * Le module est chargé depuis une URL `data:`. Quand il ne compile pas
 * (un export en double, une accolade oubliée), Node affiche l'URL entière
 * dans la trace : près d'un mégaoctet de source encodée en pourcents, où
 * le message d'erreur se perd. On l'intercepte pour n'afficher que ce qui
 * sert : la ligne fautive et la raison.
 */
async function importApp(source) {
  try {
    return await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
  } catch (error) {
    const lines = source.split('\n');
    const lineNumber = Number((String(error.stack || '').match(/data:[^\s]*?:(\d+)/) || [])[1]);
    console.error('budget-app.html ne compile pas :');
    console.error('  ' + error.message);
    if (lineNumber) {
      console.error(`  ligne ${lineNumber} du module assemblé :`);
      for (let i = Math.max(0, lineNumber - 3); i < Math.min(lines.length, lineNumber + 2); i++) {
        console.error(`  ${i + 1 === lineNumber ? '>' : ' '} ${i + 1} | ${lines[i]}`);
      }
    }
    process.exit(1);
  }
}

// Confirmations : `globalThis.confirm` n'est plus utilisé par l'application
// (fenêtre maison depuis le 01/09/2026). Le crochet `__setConfirmHandler`
// joue exactement le même rôle pour les tests — « oui » par défaut, chaque
// test pouvant le retourner ponctuellement.
function answerConfirmations(value) { app.__setConfirmHandler(() => value); }

const app = await importApp(
  (
    `${data}\n${budgetData}\n${emasphereData}\n${appSource}\n` +
    'export { render, handleExport, state, detailRows, pnlRows,\n' +
    '  encryptState, decryptPayload, deriveKey, showLock, submitLock, lockNow,\n' +
    '  isProtected, persist, addCompanyFromForm, openCompany, deleteCompany,\n' +
    '  seedBudgetForCompany, reloadCompanyBudgetFromSeed,\n' +
    '  addGroupFromForm, deleteGroup, addSuperGroupFromForm, deleteSuperGroup, addLine, computeSpreadAmounts,\n' +
    '  toggleAccountCollapsed, openDrillDown, closeDrillDown, openCompanyFromDrill, goToProblemLine,\n' +
    '  undo, redo, resetUndoHistory, parsePastedAmount, parsePastedGrid, spreadProfileOptions,\n' +
    '  openBulkAdjust, closeBulkAdjust, saveBulkAdjust, bulkAdjustTargets, applyBulkAdjust,\n' +
    '  bulkAdjustModalHtml,\n' +
    '  duplicateCompany, setCompareYear, comparisonCompanies, comparisonFor,\n' +
    '  coherenceWarnings, freezeVersion, restoreVersion, deleteVersion, versionTotal,\n' +
    '  globalSearchResults, setGlobalQuery, customRatioRows, customRatioMetrics,\n' +
    '  backupLabel, goToAccount, toggleHelp, helpModalHtml, showToast, HELP_SECTIONS,\n' +
    '  welcomeModalHtml, dismissWelcome, closeWelcomeImmersive, maybeShowWelcomeOnEntry,\n' +
    '  welcomeGreetingName, viewTransitionFor, requestViewFade, consumeForcedFade,\n' +
    '  metricMonths, metricLabel, metricCenter,\n' +
    '  openSocieteModal, closeSocieteModal, setConsoFilter, setConsoYearFilter, consoYearOptions,\n' +
    '  filterCompaniesByYear, linesOf, save, flushSave,\n' +
    '  patchSaisieIndicators, seedCompanies, seedGroups,\n' +
    '  accountsOfCenter, unclassifiedCharges, searchAccounts,\n' +
    '  groupFilterOptions, companiesInGroupFilter, setExportSelection, setExportGroupSelection, exportedCompanies,\n' +
    '  setExportSelectionMode,\n' +
    '  chooseExportDir, forgetExportDir, restoreExportDir, FS_ACCESS_SUPPORTED, IDB_SUPPORTED,\n' +
    '  chooseBackupDir, forgetBackupDir, restoreBackupDir, writeAutoBackup, backupFilename,\n' +
    '  restoreBackupFile,\n' +
    '  backupDirCard, exportDirCard, BACKUP_MAX, BACKUP_PREFIX,\n' +
    '  setSocieteGroupFilter, money,\n' +
    '  calculatorPressDigit, calculatorPressDecimal, calculatorSetOperator, calculatorEquals,\n' +
    '  calculatorClear, calculatorClearEntry, calculatorBackspace, calculatorToggleSign, calculatorInsert,\n' +
    '  calculatorToggle, calculatorClose, calculatorPressKey, patchAccountTotalBadge,\n' +
    '  calculatorPercent, calculatorSquare, calculatorSqrt, calculatorInverse,\n' +
    '  calculatorInputSelector, calculatorInputLabel,\n' +
    '  calculatorMemoryAdd, calculatorMemorySubtract, calculatorMemoryRecall, calculatorMemoryClear,\n' +
    '  calculatorRecallHistory,\n' +
    '  recomputeRateLinkedLines, recomputeAllRateLinkedLines,\n' +
    '  rateLinkRefAccountResults, rateLinkSourceLineOptions, rateLinkSourceLabel,\n' +
    '  rateLinkExpenseCategoryMonths, rateLinkRevenueCategoryMonths, rateLinkCategoryLabel,\n' +
    '  openRateLinkModal, closeRateLinkModal, saveRateLink, detachRateLink,\n' +
    '  formatRateValue,\n' +
    '  openMoveLineModal, closeMoveLineModal, moveLineTargetResults, moveLineToAccount,\n' +
    '  openNoteEditing, deleteNote, isComputedLine,\n' +
    '  toggleRowMenu, closeRowMenu,\n' +
    '  confirmed, closeConfirm, acceptConfirm, confirmModalHtml, __setConfirmHandler,\n' +
    '  showFormError, showAppError, clearFormError, fieldErrorHtml, fieldErrorClass,\n' +
    '  breadcrumbHtml, tabGroupLabel, TAB_LABELS, activeCompany,\n' +
    '  flashValue, flashSavedInput, markRowTouched,\n' +
    '  companyById, linesOfAll, setCompanyLogo, removeCompanyLogo, escapeGoBack,\n' +
    '  setUserAvatar, removeUserAvatar, normalizePhotoToPng,\n' +
    '  driversOf, driverById, addDriver, deleteDriver, driverTotal,\n' +
    '  payrollMonthlyCost, payrollYearlyCost, payrollSummaryLabel, isPayrollAccount,\n' +
    '  activeScenario, setActiveScenario, addScenario, deleteScenario,\n' +
    '  scenarioAdjustedLines, summarizeForDisplay, scenarioSummaryLabel,\n' +
    '  variablePartOf, setVariablePart, breakEvenAnalysis, breakEvenDay, dayOfYearLabel,\n' +
    '  variableAmountOf, setVariableAmount, variableShareOf, variableRateOf,\n' +
    '  openBreakEvenDetail, closeBreakEvenDetail,\n' +
    '  saveTemplate, applyTemplate, deleteTemplate,\n' +
    '  readWorkbookFromFile, parsePcgWorkbook, importPlanFromFile, deletePlan, setPlanView, renamePlan,\n' +
    '  planById, accountsForPlan, accountIndexForPlan, resolveAccountForLine, exportXlsx, CENTER_OVERRIDES,\n' +
    '  EMASPHERE_MAP, EMASPHERE_HEADERS, togglePnlFullscreen, viewPnl, viewConso, viewAjustements };\n' +
    'export function __setTab(value) { tab = value; }\n' +
    'export function __setCommandQuery(value) { commandQuery = value; }\n' +
    'export function __getCommandIndex() { return commandIndex; }\n' +
    'export function __setCenter(value) { currentCenter = value; }\n' +
    'export function __getCenter() { return currentCenter; }\n' +
    'export function __setAccountQuery(value) { accountQuery = value; }\n' +
    'export function __getAccountQuery() { return accountQuery; }\n' +
    'export function __seed(companies, lines) {\n' +
    '  state.companies = companies; state.activeCompany = companies[0].id; state.lines = lines;\n' +
    '}\n' +
    'export function __setBackupDirHandle(handle) { backupDirHandle = handle; }\n' +
    'export function __getBackupDirHandle() { return backupDirHandle; }\n' +
    'export function __getCalculatorDisplay() { return calculatorDisplay; }\n' +
    'export function __getCalculatorOpen() { return calculatorOpen; }\n' +
    'export function __getCalculatorExpression() { return calculatorExpression; }\n' +
    'export function __getCalculatorHistory() { return calculatorHistory; }\n' +
    'export function __getCalculatorMemory() { return calculatorMemory; }\n' +
    'export function __setLastFocusedMonthInput(value) { lastFocusedMonthInput = value; }\n' +
    'export function __getLastFocusedMonthInput() { return lastFocusedMonthInput; }\n' +
    'export function __getRateLinkModal() { return rateLinkModal; }\n' +
    'export function __getCollapsedAccounts() { return collapsedAccounts; }\n' +
    'export function __getDrillDown() { return drillDown; }\n' +
    'export function __getTab() { return tab; }\n' +
    'export function __getUndoDepth() { return { undo: undoStack.length, redo: redoStack.length }; }\n' +
    // Clôt l'étape d'annulation en cours sans attendre la fin du délai de
    // regroupement des frappes : c'est ce que fait le minuteur en vrai.
    'export function __forceUndoStep() { commitUndoSnapshot(); }\n' +
    'export function __setSpreadingLineId(v) { spreadingLineId = v; }\n' +
    'export function __getCellSelection() { return cellSelection; }\n' +
    'export { cellSelectionActive, highlightCellSelection, setCellSelectionAnchor,\n' +
    '  extendCellSelection, clearCellSelection, bulkFillSelection, bulkPasteValueFor,\n' +
    '  gridRectCells, gridCellPosition };\n' +
    'export function __getBulkAdjustModal() { return bulkAdjustModal; }\n' +
    'export function __getConfirmModal() { return confirmModal; }\n' +
    'export function __getFormError() { return formError; }\n' +
    'export function __summarize(lines) { return summarize(lines, resolveAccountForLine); }\n' +
    'export function __getPnlFullscreen() { return pnlFullscreen; }\n' +
    'export function __getBreakEvenDetailKey() { return breakEvenDetailKey; }\n' +
    'export { parseDateCell, parseAmountCell, parseDailyRevenueRows, parseDelimitedText,\n' +
    '  daysInMonth, isLeapYear, dateKey, dailyRevenueOf, setDailyRevenue, clearDailyRevenue,\n' +
    '  lastActualDay, dailyBudgetOf, forecastModel, importDailyRevenue, setForecastMonth,\n' +
    '  setForecastMethod, viewForecast };\n' +
    'export { caWeightingOf, ensureCaWeighting, setCaWeekdayCoefficient, addCaSeason, removeCaSeason,\n' +
    '  updateCaSeason, seasonContainsDay, seasonCoefficientFor, caDayWeight, weekdayOf };\n' +
    'export { forecastRealizedMatrixSheet, downloadForecastRealizedMatrix, parseForecastRealizedMatrixRows,\n' +
    '  importForecastRealizedMatrixFile };\n' +
    'export function __getBreakEvenOpen() { return breakEvenOpen; }\n' +
    'export function __setPanelOpen(id, open) { setPanelOpen(id, open); }\n' +
    'export function __undoHistoryBytes() { return undoHistoryBytes(); }\n' +
    'export function __UNDO_MAX() { return UNDO_MAX; }\n' +
    'export function __UNDO_MAX_BYTES() { return UNDO_MAX_BYTES; }\n' +
    'export { ensureDailyRevenue };\n' +
    'export { employeeMonth, employeePresenceDays, employeeGrossFor, employeeBonusFor,\n' +
    '  estimateNetBeforeTax, estimateEmployeeBreakdown,\n' +
    '  employeeLeave, employeeLeaveMonthly, payrollMatrix, payrollAccountsForCenter, payrollCenterMonths,\n' +
    '  payrollHeadcountMonths, formatEtp,\n' +
    '  syncPayrollToSaisie, parseIsoDate,\n' +
    '  employeesOf, employeeById, openEmployeeEditor, closeEmployeeEditor,\n' +
    '  toggleEmployeeDetail, resetStateIndexes, viewPayroll,\n' +
    '  saveEmployeeFromForm, deleteEmployee, syncPayrollLines,\n' +
    '  togglePayrollMatrixDetail, payrollLockedRates, payrollRateLocked, payrollLockedRateValue,\n' +
    '  setPayrollLockedRate, employeeRateOf, bonusLeaveCharges, PAYROLL_LOCKABLE_RATES,\n' +
    '  employeeRateFieldHtml, payrollLockPanel, employeeEditorHtml,\n' +
    '  companyOpenMonths, setCompanyOpenMonth, companyOpenDateRange, newEmployee,\n' +
    '  employeeWorkedMonths, workedMonthsFieldHtml, employeePresenceLabel };\n' +
    'export function __getPayrollMatrixDetailOpen() { return payrollMatrixDetailOpen; }\n' +
    'export { TAB_GROUPS, tabGroupOf };\n' +
    'export function __getWelcomeOpen() { return welcomeOpen; }\n' +
    'export function __setWelcomeOpen(v) { welcomeOpen = v; }\n' +
    'export function __getWelcomeClosing() { return welcomeClosing; }\n' +
    'export function __setWelcomeClosing(v) { welcomeClosing = v; }\n' +
    // Force le deuxième écran de l'accueil sur un environnement donné (ou
    // `null` pour « Tous les environnements ») sans passer par le clic +
    // délai réels — pour les tests de welcomeCompanyCardsHtml().
    'export function __setWelcomeCompanyStep(envId) {\n' +
    '  welcomeCompanyStepActive = true; welcomeCompanyStepEnvId = envId;\n' +
    '}\n' +
    // Force la détection HTTPS dans les tests, où `location` n'existe pas
    // (module `data:` importé sous Node) — voir SERVER_MODE_AVAILABLE.
    'export function __setServerModeAvailable(v) { SERVER_MODE_AVAILABLE = v; }\n' +
    'export function __getLastRenderedTab() { return lastRenderedTab; }\n' +
    'export function __setLastRenderedTab(v) { lastRenderedTab = v; }\n' +
    'export function __getMoveLineModal() { return moveLineModal; }\n' +
    'export { caLinesOf, caLineById, caLineForAccount, dailyCaOf, ensureDailyCa, setDailyCa,\n' +
    '  caMonthlyTotals, addCaLine, deleteCaLine, syncCaLines, spreadMonthAcrossDays, setCaMonthTotal,\n' +
    '  migrateProduitLinesToCa, openCaEditor, closeCaEditor, toggleCaDetail, setCaEditMonth, toggleCaMonth,\n' +
    '  saveCaAccountFromForm, deleteCaAccount, caEditorHtml, caDetailHtml, caTeamPanel,\n' +
    '  caMigratePanel, viewCa, goToCaLine, goToPayrollCenter,\n' +
    '  matrixMonthlyRevenue, caEventServiceRevenue, caVentilationOf, caVentilationPercent, setCaVentilationPercent,\n' +
    '  caAccountVentilationTotal, applyCaVentilation, caVentilationPanel,\n' +
    '  caCategoryVentilationOf, caCategoryVentilationPercent, setCaCategoryVentilationPercent,\n' +
    '  caCategoryVentilationTotal,\n' +
    '  CA_CATEGORIES, caCategoryOf, setCaCategory,\n' +
    '  caPrintExportHtml, printCaBudget };\n' +
    'export function __getCaEditingId() { return caEditingId; }\n' +
    'export function __getCaExpandedId() { return caExpandedId; }\n' +
    'export function __getCaEditMonth() { return caEditMonth; }\n' +
    'export { localStorageUsageBytes, storageQuotaRatio, checkStorageQuota, storageQuotaCard,\n' +
    '  STORAGE_QUOTA_BYTES, STORAGE_QUOTA_WARN_RATIO };\n' +
    'export function __getStorageQuotaWarned() { return storageQuotaWarned; }\n' +
    'export function __setStorageQuotaWarned(v) { storageQuotaWarned = v; }\n' +
    'export { DEFAULT_NAVY_COLOR, darkenHex, applyEnvironmentTheme,\n' +
    '  setSuperGroupNavyColor, resetSuperGroupNavyColor };\n' +
    'export { duplicateLine };\n' +
    'export { setConsoSort, setConsoCompareGroup };\n' +
    'export function __getConsoSort() { return consoSort; }\n' +
    'export function __getConsoCompareGroup() { return consoCompareGroup; }\n' +
    'export { applyScenarioToLines, scenarioImpact, scenariosCard,\n' +
    '  scenarioActivityFactor, applyScenarioToActivity, activityRevenueSplit };\n' +
    'export { setPayrollTeamCenterFilter, payrollTeamPanel, payrollMatrixPanel };\n' +
    'export function __setPayrollTeamQuery(v) { payrollTeamQuery = v; }\n' +
    'export function __getPayrollTeamQuery() { return payrollTeamQuery; }\n' +
    'export function __getPayrollTeamCenterFilter() { return payrollTeamCenterFilter; }\n' +
    'export { duplicateEmployee };\n' +
    'export { grossFromNet, RESTAURANT_POSITIONS, restaurantPositionsFlat, employeeRoleFieldHtml,\n' +
    '  restaurantPositionRank };\n' +
    'export { CONTRACT_TYPES, PAYROLL_DEFAULT_CONTRACT_TYPE };\n' +
    'export { APP_PAGES, USER_ROLES, CONTROLEUR_ONLY_TABS, DIRECTEUR_DEFAULT_TABS,\n' +
    '  roleLabel, pagesOfTab, defaultPermissionsFor, passwordPolicyErrors, generateStrongPassword,\n' +
    '  hashPassword, verifyPassword, createUser, deleteUser, controleurCount,\n' +
    '  adoptState, usersOf, userById, userByUsername, isUsernameAvailable, canAccessTab, canAccessPage,\n' +
    '  firstAllowedTab, setUserPermissions, logAuthEvent, signIn, signOut, currentUser,\n' +
    '  authEnabled, tabAllowedNow, pageAllowedNow, viewAutorisations, PASSWORD_MIN_LENGTH,\n' +
    '  isAdminUser, adminCount, isValidEmail, isEmailAvailable, generateInviteCode,\n' +
    '  createInvite, completeSignup, reinviteUser, changeOwnPassword, inviteMailtoHref };\n' +
    'export { SIGNIN_MAX_ATTEMPTS, SIGNIN_LOCK_MINUTES, signInLockRemainingMinutes,\n' +
    '  clearSignInAttempts, randomBytes, randomHex, exportedPayloadIsEncrypted };\n' +
    'export { setUserScope, allowedCompanyIds, allowedCostCenterIds, isCompanyAllowed,\n' +
    '  visibleCompanies, enforceCompanyPermission, rawLinesOf,\n' +
    '  isCenterAllowed, visibleCostCenters, enforceCenterPermission,\n' +
    '  companyIdsInSuperGroupRaw, companyIdsInEnvironments, userEnvironmentIds, environmentById,\n' +
    '  availableEnvironments, canSeeAllEnvironments, activeEnvironmentId, setActiveEnvironment,\n' +
    '  enforceEnvironmentPermission, normalizeEnvironmentIds, scopeEnvironmentRowsHtml,\n' +
    '  environmentBadgesHtml, authEnvironmentsPanel, authScopePanelHtml, authPermissionsPanel,\n' +
    '  authEditorScopeFieldsHtml,\n' +
    '  SENSITIVE_TABS, ENVIRONMENT_ALL, welcomeEnvironmentCardsHtml,\n' +
    '  companiesWithinRights, pickableCompanies, environmentNameForCompany, viewAffichage,\n' +
    '  setEnvironmentLogo, removeEnvironmentLogo, normalizeLogoToPng,\n' +
    '  companiesForWelcomeStep, autoAdvanceWelcomeToCompanyStepIfNeeded, resetWelcomeCompanyStep,\n' +
    '  welcomeCompanyCardsHtml, environmentColorHex, goBackToWelcomeEnvironmentStep,\n' +
    '  isSecureServerContext, requireServerMode, serverModeStatusHtml };\n' +
    'export { viewSecurite, securiteBody, affichageBody, autorisationsBody,\n' +
    '  viewParametres };\n' +
    'export function __setAuthEditingId(v) { authEditingId = v; }\n' +
    'export function __setAuthPermissionsId(v) { authPermissionsId = v; }\n' +
    'export { toggleSocieteSelection, setSocieteSelection, clearSocieteSelection,\n' +
    '  applySocieteBulkPlan, applySocieteBulkGroup };\n' +
    'export function __getSocieteSelection() { return societeSelection; }\n' +
    'export { exportPreviewPanel, filteredDetailRows, resolveGroupFilterId, exportFileNamePart,\n' +
    '  setExportColumns, styledDetailSheet };\n' +
    'export function __getExportColumns() { return exportColumns; }\n' +
    'export { caEbitdaRealiseSheet, caEbitdaCumulSheet, caEbitdaTotals, dominantYear };\n' +
    'export { setPriorActual, priorActualOf, pastePriorActualsFromCell };\n' +
    'export { importMatrixAccounts, importMatrixSheets, importMatrixSheet, downloadImportMatrix, viewImport, computedLineReason,\n' +
    '  parseImportMatrixRows, detectImportConflicts, applyImportedAccountAmounts, applyImportRows,\n' +
    '  importAccountMatrixFile, confirmPendingImport, cancelPendingImport };\n' +
    'export function __getPendingImport() { return pendingImport; }\n' +
    'export function __getSetupWizard() { return setupWizard; }\n' +
    'export { logLineEdit, editLogPanel, EDIT_LOG_MAX,\n' +
    '  editLogForLine, filteredEditLog, setEditLogFilter, EDIT_LOG_PERIODS,\n' +
    '  logLineAmountChanges, logCaEdit, editLogWhatLabel, caLineYearTotal,\n' +
    '  matrixPhoneList, phoneLayoutActive, PHONE_MAX_WIDTH,\n' +
    '  openSetupWizard, closeSetupWizard, setupWizardGo, setupWizardHtml,\n' +
    '  setupWizardSummary, createCompanyFromWizard, SETUP_WIZARD_STEPS,\n' +
    '  openCommandPalette, closeCommandPalette, commandPaletteHtml, commandPaletteResults,\n' +
    '  runCommandPaletteItem, runCommandPaletteSelection, moveCommandIndex, COMMAND_ACTIONS,\n' +
    '  openLineHistoryModal, closeLineHistoryModal, lineHistoryModalHtml,\n' +
    '  toEurRate, linesOfAllConverted, currencyOptions, CURRENCIES,\n' +
    '  buildPptxBlob, zipStore, crc32, companyBreakdown,\n' +
    '  exchangeRatesPanel, total, ratio, freshnessLabel, lastEditForCompany, viewSocietes };\n' +
    'export function __setLastFocusedMonthInputValue(v) {\n' +
    '  if (lastFocusedMonthInput) lastFocusedMonthInput.valueAtFocus = v;\n' +
    '}\n' +
    'export { toggleAbout, aboutModalHtml, headerMenuAvatarHtml, avatarInitialsFor,\n' +
    '  toggleAccountPanel, closeAccountPanel, syncAccountPanelDom };\n' +
    'export function __getAboutOpen() { return aboutOpen; }\n' +
    'export function __setAboutOpen(v) { aboutOpen = v; }\n' +
    'export function __getAccountPanelOpen() { return accountPanelOpen; }\n' +
    'export function __setAccountPanelOpen(v) { accountPanelOpen = v; }\n' +
    'export { bootPromise, storageGetRaw, storageSetRaw, idbAvailable,\n' +
    '  migrateStorageToIndexedDbIfNeeded };\n' +
    'export function __getStorageBackendIsIndexedDb() { return storageBackendIsIndexedDb; }\n' +
    'export function __setStorageBackendIsIndexedDb(v) { storageBackendIsIndexedDb = v; }\n' +
    'export { exportFullAppData, importFullAppData, fullExportImportCard };\n' +
    'export { DIRECTOR_TAB, directorModeActive, setDirectorMode, defaultTabForCurrentUser,\n' +
    '  landingTabAfterCompanySelection,\n' +
    '  viewDirecteur, directorMatrixCard, dirRatioTone, dirAmountTone,\n' +
    '  directorPreviewActive, directorPreviewAllowsTab, directorPreviewAllowsPage,\n' +
    '  directorPreviewBanner, DIRECTEUR_DEFAULT_PAGES, objectivesSummaryHtml };\n' +
    'export function __getDirectorModeOverride() { return directorModeOverride; }\n' +
    'export function __setDirectorModeOverride(v) { directorModeOverride = v; }\n' +
    'export { MATRIX_SERVICES, normalizeServiceMatrix, serviceMatrixOf, serviceMatrixValue,\n' +
    '  setServiceMatrixValue, matrixDayKeys, matrixServiceRevenue, matrixTotalCovers,\n' +
    '  matrixTotalRevenue, weekTotal, matrixOverallTicket, matrixYearTotals, matrixMonthlySeries,\n' +
    '  setMatrixMonth };\n' +
    'export function __getMatrixMonth() { return matrixMonth; }\n' +
    'export function __setMatrixMonth(v) { matrixMonth = v; }\n' +
    'export { OBJECTIVE_SCOPES, objectiveScope, objectivesOf, canEditObjectives,\n' +
    '  objectiveCurrentValue, objectiveProgress, objectiveTone, viewObjectifs,\n' +
    '  saveObjectiveFromForm, startEditObjective, cancelEditObjective, removeObjective,\n' +
    '  directorObjectivesCard,\n' +
    '  OBJECTIVE_REVENUE_CATEGORIES, objectiveHasRevenueFilter, objectiveRevenueMonthly,\n' +
    '  objectiveRevenueCategoriesLabel };\n' +
    'export function __getEditingObjectiveId() { return editingObjectiveId; }\n' +
    'export { isGridCellInput, gridNeighbourCell, gridColumnIndex, caretAtGridEdge, enterNeighbourCell, gridCellSelector, focusGridCell };\n' +
    'export { EMBEDDED_SNAPSHOT_ELEMENT_ID, EMBEDDED_SNAPSHOT_SEEDED_KEY, embeddedSnapshotRaw,\n' +
    '  embeddedSnapshotExportId, seedFromEmbeddedSnapshotIfNeeded, exportStandaloneAppData };\n' +
    'export function __getCryptoKey() { return cryptoKey; }\n' +
    'export function __setCryptoKey(v) { cryptoKey = v; }\n' +
    'export function __getLockedPayload() { return lockedPayload; }\n' +
    'export function __setLockedPayload(v) { lockedPayload = v; }\n' +
    'export function __getAuthSession() { return authSession; }\n' +
    'export function __setAuthSession(v) { authSession = v; }\n' +
    'export function __setState(v) { state = v; }\n' +
    'export { currentModalContainer, focusableIn, trapModalTab };\n' +
    'export { importIssuesSummaryText, importSummaryMessage };\n' +
    'export { VALIDATION_STALE_DAYS, canSubmitCompanyValidation, canValidateCompanyBudget,\n' +
    '  submitCompanyForValidation, validateCompanyBudget, revertCompanyValidationToDraft,\n' +
    '  validationBadgeHtml };\n' +
    'export function __getModalFocusReturnTo() { return modalFocusReturnTo; }\n' +
    'export function __setModalFocusReturnTo(v) { modalFocusReturnTo = v; }\n'
  )
);

await app.bootPromise;

// Réponse par défaut aux confirmations, comme l'était `globalThis.confirm`.
answerConfirmations(true);

// --- diagnostic ad hoc : inspection de l'export Excel P&L réel (bouton "pnl-xlsx") ---
dom.blobs.length = 0;
app.handleExport('pnl-xlsx');
console.log('nb blobs:', dom.blobs.length);
const buffer = Buffer.from(await dom.blobs[0].arrayBuffer());
fs.writeFileSync('/tmp/diag_pnl.xlsx', buffer);
console.log('fichier écrit, taille =', buffer.length);
