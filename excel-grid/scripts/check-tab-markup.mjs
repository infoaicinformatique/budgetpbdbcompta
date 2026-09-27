/**
 * Contrôle de la structure HTML de chaque onglet.
 *
 * Le harnais anti-divergence (`check-budget-app.mjs`) remplace le DOM par
 * de simples chaînes : `innerHTML` n'y est jamais analysé, donc un <div>
 * oublié passerait inaperçu alors qu'il casserait la mise en page à
 * l'écran. Ce script rend chaque onglet et vérifie que les balises sont
 * bien équilibrées, puis que la trame commune est respectée (un en-tête
 * `.page-head`, des rubriques `.panel` avec titre et corps).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const appPath = path.join(here, '..', '..', 'budget-app.html');
const html = readFileSync(appPath, 'utf8');

/* --- 1. Le module de l'application, avec un DOM factice ---------------- */

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

// Mêmes marqueurs que le harnais anti-divergence : les blocs de données
// vivent dans leurs propres <script>, le reste de l'application dans le
// dernier. Les extraire autrement redéclarerait les mêmes constantes.
function between(source, startMark, endMark, what) {
  const start = source.indexOf(startMark);
  const end = source.indexOf(endMark);
  if (start < 0 || end < 0 || end < start) {
    throw new Error(`Marqueurs ${what} introuvables dans budget-app.html`);
  }
  return source.slice(start + startMark.length, end);
}

const appSource = html.slice(
  html.lastIndexOf('<script>') + '<script>'.length,
  html.lastIndexOf('</script>'),
);
const data = between(html, '/* PCG-DATA-START */', '/* PCG-DATA-END */', 'de données');
const budgetData = between(html, '/* BUDGET-DATA-START */', '/* BUDGET-DATA-END */', 'de budget');
const emasphereData = between(html, '/* EMASPHERE-DATA-START */', '/* EMASPHERE-DATA-END */', 'EmaSphère');

const elements = stubDom();
const app = await import(
  `data:text/javascript;charset=utf-8,${encodeURIComponent(
    `${data}\n${budgetData}\n${emasphereData}\n${appSource}\n` +
    'export { render, state };\n' +
    'export function __setTab(v) { tab = v; }\n' +
    'export function __getTab() { return tab; }\n',
  )}`
);

/* --- 2. Équilibrage des balises --------------------------------------- */

const VOID = new Set(['input', 'br', 'hr', 'img', 'meta', 'link', 'source',
  'col', 'area', 'base', 'embed', 'track', 'wbr', 'path', 'circle', 'rect',
  'line', 'polyline', 'polygon', 'stop', 'use']);

/** Renvoie un message d'erreur, ou `null` si les balises sont équilibrées. */
function unbalanced(markup) {
  const stack = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  let m;
  while ((m = re.exec(markup))) {
    const tag = m[2].toLowerCase();
    if (VOID.has(tag)) continue;
    if (m[3].trimEnd().endsWith('/')) continue; // <tag ... />
    if (m[1]) {
      if (!stack.length) return `</${tag}> sans balise ouvrante`;
      const open = stack.pop();
      if (open !== tag) return `</${tag}> referme un <${open}>`;
    } else {
      stack.push(tag);
    }
  }
  return stack.length ? `balise(s) non refermée(s) : ${stack.join(' > ')}` : null;
}

/* --- 3. Contrôles ------------------------------------------------------ */

// « directeur » et « objectifs » ajoutés le 19/08/2026 (menu Pilotage).
// « parametres » n'y figure pas : c'est un assemblage des corps d'autres
// onglets, déjà couverts individuellement ci-dessous.
const TABS = ['directeur', 'objectifs', 'saisie', 'ca', 'ajustements', 'pnl', 'forecast', 'payroll', 'import', 'conso', 'societes', 'plan', 'export', 'securite', 'autorisations'];
const problems = [];

for (const name of TABS) {
  app.__setTab(name);
  app.render();
  const markup = elements.get('view').innerHTML;

  const error = unbalanced(markup);
  if (error) problems.push(`onglet « ${name} » : ${error}`);

  if (!markup.includes('class="page-head"')) {
    problems.push(`onglet « ${name} » : en-tête commun .page-head absent`);
  }

  // Chaque volet doit être complet : titre cliquable + corps.
  const panels = [...markup.matchAll(/<details class="card panel[^"]*" data-panel="([^"]+)"/g)];
  if (!panels.length) {
    problems.push(`onglet « ${name} » : aucune rubrique .panel`);
  }
  // `panel-title` seulement sur le <summary> — pas `panel-title-left`,
  // qui est le libellé porteur du chevron à l'intérieur de ce <summary>.
  const titles = (markup.match(/<summary class="panel-title[^"]*"/g) || []).length;
  const bodies = (markup.match(/<div class="panel-body[^"]*"/g) || []).length;
  if (titles !== panels.length || bodies !== panels.length) {
    problems.push(
      `onglet « ${name} » : ${panels.length} volet(s) mais ${titles} titre(s) et ${bodies} corps`,
    );
  }

  // Alexis : « je ne veux plus avoir ça sur toutes les pages, affiche
  // tout. » Aucun tableau d'onglet ne doit vivre dans une boîte à
  // défilement vertical interne : tout s'affiche en entier, c'est la page
  // qui défile. `.scroll` (hauteur bornée) et `max-height` sont donc
  // proscrits hors des pop-ups, qui doivent, eux, tenir dans l'écran.
  //
  // Une exception avait été tentée pour Sociétés (02/09/2026, boîte à
  // défilement bornée) puis abandonnée le même jour : capture d'écran
  // montrant des lignes tronquées, pire que le défilement de page. Retirée
  // — la règle ci-dessus s'applique de nouveau sans exception.
  const withoutModals = markup.replace(/<div class="modal-backdrop"[\s\S]*$/, '');
  if (withoutModals.includes('class="scroll"')) {
    problems.push(`onglet « ${name} » : un tableau est encore dans une boîte à défilement interne (.scroll)`);
  }
  if (/max-height:\s*\d/.test(withoutModals)) {
    problems.push(`onglet « ${name} » : une zone est encore bornée en hauteur (max-height)`);
  }

  // Identifiants uniques : deux volets partageant un id se piloteraient
  // l'un l'autre à l'ouverture.
  const ids = panels.map((p) => p[1]);
  const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (duplicates.length) {
    problems.push(`onglet « ${name} » : identifiants de volet en double — ${[...new Set(duplicates)].join(', ')}`);
  }
}

if (problems.length) {
  console.error(`Structure des onglets : ${problems.length} problème(s)`);
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log(`Structure des onglets vérifiée : ${TABS.length} onglets, balises équilibrées, volets complets.`);
