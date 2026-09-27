/**
 * Où part la mémoire ? Mesure la taille de l'état sérialisé, le coût de
 * la pile d'annulation (qui en garde jusqu'à UNDO_MAX copies), et celui
 * du réalisé quotidien.
 *
 * Usage : node --expose-gc scripts/profile-memory.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(here, '..', '..', 'budget-app.html'), 'utf8');

function between(source, a, b) {
  return source.slice(source.indexOf(a) + a.length, source.indexOf(b));
}

const elements = new Map();
const element = (id) => ({
  id, value: '', textContent: '', innerHTML: '', checked: false, disabled: false,
  files: [], dataset: {}, style: {}, scrollTop: 0, scrollLeft: 0,
  classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
  addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
  appendChild() {}, remove() {}, click() {}, focus() {}, setSelectionRange() {},
});
globalThis.document = {
  getElementById(id) { if (!elements.has(id)) elements.set(id, element(id)); return elements.get(id); },
  querySelector: () => null, querySelectorAll: () => [],
  createElement: () => element('a'), body: { appendChild() {} },
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

const app = await import(
  `data:text/javascript;charset=utf-8,${encodeURIComponent(
    `${between(html, '/* PCG-DATA-START */', '/* PCG-DATA-END */')}\n` +
    `${between(html, '/* BUDGET-DATA-START */', '/* BUDGET-DATA-END */')}\n` +
    `${between(html, '/* EMASPHERE-DATA-START */', '/* EMASPHERE-DATA-END */')}\n` +
    `${html.slice(html.lastIndexOf('<script>') + '<script>'.length, html.lastIndexOf('</script>'))}\n` +
    'export { render, state, setDailyRevenue, dateKey, captureUndoStep, save };\n' +
    'export function __setTab(v) { tab = v; }\n' +
    'export function __undoBytes() {\n' +
    '  return undoStack.reduce((s, x) => s + x.length, 0) + redoStack.reduce((s, x) => s + x.length, 0)\n' +
    '    + (undoSnapshot ? undoSnapshot.length : 0);\n' +
    '}\n' +
    'export function __undoDepth() { return undoStack.length; }\n' +
    'export function __commit() { commitUndoSnapshot(); }\n' +
    'export const __UNDO_MAX = UNDO_MAX;\n',
  )}`
);

const COMPANIES = 8;
const LINES = 220;
const uniqueAccounts = [...new Set(app.state.lines.map((l) => l.account))];
const companies = [];
const lines = [];
for (let c = 0; c < COMPANIES; c++) {
  const id = 'bench_c' + c;
  companies.push({ id, name: 'Bench ' + c, currency: 'EUR', year: 2026, groupId: null });
  for (let i = 0; i < LINES; i++) {
    lines.push({
      id: 'bench_l' + c + '_' + i, companyId: id,
      account: uniqueAccounts[i % uniqueAccounts.length],
      name: 'Ligne ' + i, note: '',
      amounts: Array.from({ length: 12 }, (_, m) => 1000 + i * 7 + m * 13),
    });
  }
}
app.state.companies = companies;
app.state.lines = lines;
app.state.activeCompany = companies[0].id;
app.state.dailyRevenue = {};
for (let c = 0; c < COMPANIES; c++) {
  for (let m = 0; m < 12; m++) {
    for (let d = 1; d <= 28; d++) {
      app.setDailyRevenue(companies[c].id, app.dateKey(2026, m, d), 9000 + d);
    }
  }
}

const ko = (bytes) => (bytes / 1024).toFixed(0) + ' Ko';
const stateJson = JSON.stringify(app.state);

console.log(`Jeu : ${COMPANIES} sociétés, ${lines.length} lignes, ${COMPANIES * 336} jours de réalisé.\n`);
console.log(`État sérialisé            : ${ko(stateJson.length)}`);

// Part de chaque bloc dans l'état.
const parts = [];
for (const key of Object.keys(app.state)) {
  parts.push({ bloc: key, taille: ko(JSON.stringify(app.state[key]).length) });
}
parts.sort((a, b) => parseInt(b.taille) - parseInt(a.taille));
console.table(parts.slice(0, 8));

// Coût de la pile d'annulation une fois pleine.
app.__setTab('saisie');
app.render();
for (let i = 0; i < app.__UNDO_MAX + 5; i++) {
  app.captureUndoStep();
  app.__commit();
  app.state.lines[i % lines.length].amounts[0] += 1;
}
console.log(`\nPile d'annulation pleine  : ${ko(app.__undoBytes())} (${app.__undoDepth()} étapes sur ${app.__UNDO_MAX})`);
console.log(`Soit ${(app.__undoBytes() / stateJson.length).toFixed(0)} fois l'état complet, gardé en mémoire en permanence.`);
