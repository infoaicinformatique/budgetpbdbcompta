/**
 * Mesure du coût d'un rendu, onglet par onglet.
 *
 * Sert à décider quoi optimiser sur des chiffres plutôt qu'à l'intuition :
 * temps par rendu, taille du HTML produit, et mémoire retenue après une
 * série de rendus. Jeu de données volontairement lourd (plusieurs
 * sociétés, beaucoup de lignes, une année de réalisé quotidien) pour que
 * les écarts se voient.
 *
 * Usage : node --expose-gc scripts/profile-app.mjs [nombre de rendus]
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(here, '..', '..', 'budget-app.html'), 'utf8');

function between(source, startMark, endMark) {
  const start = source.indexOf(startMark);
  const end = source.indexOf(endMark);
  return source.slice(start + startMark.length, end);
}

function stubDom() {
  const elements = new Map();
  const element = (id) => ({
    id, value: '', textContent: '', innerHTML: '', checked: false,
    disabled: false, files: [], dataset: {}, style: {}, scrollTop: 0, scrollLeft: 0,
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
    appendChild() {}, remove() {}, click() {}, focus() {}, setSelectionRange() {},
  });
  globalThis.document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element(id));
      return elements.get(id);
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => element('a'),
    body: { appendChild() {} },
    addEventListener() {}, removeEventListener() {},
  };
  globalThis.localStorage = {
    data: new Map(),
    getItem(k) { return this.data.has(k) ? this.data.get(k) : null; },
    setItem(k, v) { this.data.set(k, String(v)); },
    removeItem(k) { this.data.delete(k); },
  };
  globalThis.alert = () => {};
  globalThis.confirm = () => true;
  globalThis.prompt = () => null;
  globalThis.URL.createObjectURL = () => 'blob:test';
  globalThis.URL.revokeObjectURL = () => {};
  return elements;
}

const elements = stubDom();
const app = await import(
  `data:text/javascript;charset=utf-8,${encodeURIComponent(
    `${between(html, '/* PCG-DATA-START */', '/* PCG-DATA-END */')}\n` +
    `${between(html, '/* BUDGET-DATA-START */', '/* BUDGET-DATA-END */')}\n` +
    `${between(html, '/* EMASPHERE-DATA-START */', '/* EMASPHERE-DATA-END */')}\n` +
    `${html.slice(html.lastIndexOf('<script>') + '<script>'.length, html.lastIndexOf('</script>'))}\n` +
    'export { render, state, summarize, linesOf, resolveAccountForLine, forecastModel,\n' +
    '  setDailyRevenue, dateKey };\n' +
    'export function __setTab(v) { tab = v; }\n',
  )}`
);

/* --- Jeu de données de charge ---------------------------------------- */

const COMPANIES = 8;
const LINES_PER_COMPANY = 220;
const accounts = app.state.lines.map((l) => l.account);
const uniqueAccounts = [...new Set(accounts)];

const companies = [];
const lines = [];
for (let c = 0; c < COMPANIES; c++) {
  const id = 'bench_c' + c;
  companies.push({ id, name: 'Bench ' + c, currency: 'EUR', year: 2026, groupId: c % 2 ? 'bench_g' : null });
  for (let i = 0; i < LINES_PER_COMPANY; i++) {
    lines.push({
      id: 'bench_l' + c + '_' + i,
      companyId: id,
      account: uniqueAccounts[i % uniqueAccounts.length],
      name: 'Ligne ' + i,
      note: '',
      amounts: Array.from({ length: 12 }, (_, m) => 1000 + i * 7 + m * 13),
    });
  }
}
app.state.groups = [{ id: 'bench_g', name: 'Groupe Bench', period: '2026', superGroupId: null }];
app.state.superGroups = [];
app.state.companies = companies;
app.state.lines = lines;
app.state.activeCompany = companies[0].id;

// Une année complète de chiffre d'affaires réalisé sur la société active.
app.state.dailyRevenue = {};
for (let m = 0; m < 12; m++) {
  for (let d = 1; d <= 28; d++) {
    app.setDailyRevenue(companies[0].id, app.dateKey(2026, m, d), 9000 + d * 11 + m * 3);
  }
}

console.log(`Jeu de charge : ${COMPANIES} sociétés, ${lines.length} lignes, 336 jours de réalisé.\n`);

/* --- Mesures ---------------------------------------------------------- */

const RUNS = Number(process.argv[2] || 12);
const TABS = ['saisie', 'ajustements', 'pnl', 'forecast', 'conso', 'societes', 'plan', 'export', 'securite'];

function heapMb() {
  if (globalThis.gc) globalThis.gc();
  return process.memoryUsage().heapUsed / 1024 / 1024;
}

const results = [];
for (const name of TABS) {
  app.__setTab(name);
  app.render(); // premier rendu hors mesure : amorce les index et les caches

  const before = heapMb();
  const start = process.hrtime.bigint();
  for (let i = 0; i < RUNS; i++) app.render();
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  const after = heapMb();

  results.push({
    onglet: name,
    'ms / rendu': (elapsedMs / RUNS).toFixed(1),
    'HTML Ko': (elements.get('view').innerHTML.length / 1024).toFixed(0),
    'Δ tas Mo': (after - before).toFixed(1),
  });
}

console.table(results);

const total = results.reduce((sum, r) => sum + Number(r['ms / rendu']), 0);
console.log(`Total ${total.toFixed(0)} ms pour un rendu de chaque onglet.`);
console.log(`Tas retenu en fin de mesure : ${heapMb().toFixed(1)} Mo.`);
