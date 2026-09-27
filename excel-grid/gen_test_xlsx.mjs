import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = '.';
const htmlPath = join(root, '..', 'budget-app.html');
const html = readFileSync(htmlPath, 'utf8');
function between(source, startMark, endMark) {
  const start = source.indexOf(startMark);
  const end = source.indexOf(endMark);
  return source.slice(start + startMark.length, end);
}
const data = between(html, '/* PCG-DATA-START */', '/* PCG-DATA-END */');
const budgetData = between(html, '/* BUDGET-DATA-START */', '/* BUDGET-DATA-END */');
const core = between(html, '/* CORE-START */', '/* CORE-END */');
const appSource = html.slice(html.lastIndexOf('<script>') + '<script>'.length, html.lastIndexOf('</script>'));

// stub dom like check-budget-app.mjs
function stubDom() {
  const elements = new Map();
  const element = (id) => ({
    id, innerHTML: '', textContent: '', value: '', dataset: {}, files: [],
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
    appendChild() {}, remove() {}, click() {}, focus() {}, setSelectionRange() {},
  });
  const blobs = [];
  globalThis.document = {
    getElementById(id) { if (!elements.has(id)) elements.set(id, element(id)); return elements.get(id); },
    querySelector: () => null, querySelectorAll: () => [], createElement: () => element('a'),
    body: { appendChild() {} },
  };
  globalThis.localStorage = { data: new Map(), getItem(k){return this.data.has(k)?this.data.get(k):null;}, setItem(k,v){this.data.set(k,String(v));}, removeItem(k){this.data.delete(k);} };
  globalThis.alert = () => {};
  globalThis.confirm = () => true;
  globalThis.prompt = () => null;
  globalThis.URL.createObjectURL = (blob) => { blobs.push(blob); return 'blob:test'; };
  globalThis.URL.revokeObjectURL = () => {};
  return { elements, blobs };
}
const dom = stubDom();
const app = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(
  `${data}\n${budgetData}\n${appSource}\n` +
  'export { handleExport, state };\n' +
  'export function __seed(companies, lines) { state.companies = companies; state.activeCompany = companies[0].id; state.lines = lines; }\n'
)}`);

const company = { id: 'soc1', name: 'LPM Cannes Test', currency: 'EUR', year: 2026 };
app.__seed([company], [
  { id: '1', companyId: company.id, account: '70105100', name: 'Restaurant midi', amounts: [5000,5000,5000,5000,5000,5000,5000,5000,5000,5000,5000,5000] },
  { id: '2', companyId: company.id, account: '60103100', name: 'Denrées', amounts: [1500,1500,1500,1500,1500,1500,1500,1500,1500,1500,1500,1500] },
  { id: '3', companyId: company.id, account: '61320900', name: 'Loyer principal', amounts: [900,900,900,900,900,900,900,900,900,900,900,900] },
]);

app.handleExport('pnl-xlsx');
const buf = Buffer.from(await dom.blobs[0].arrayBuffer());
writeFileSync('/tmp/test-export.xlsx', buf);
console.log('written', buf.length, 'bytes');
