import { join } from 'node:path';
import { readWorkbook } from './scripts/lib/xlsx-read.mjs';
import { prepareTypeScript } from './scripts/lib/prepare-ts.mjs';

const root = process.cwd();
const prepared = prepareTypeScript(root, 'excel-grid-neo-probe');
const chart = await import(join(prepared, 'src', 'engine', 'chart.ts'));

const sheets = readWorkbook('/sessions/eloquent-optimistic-davinci/mnt/uploads/ex budg neo.xlsx');
const ws = sheets.get('Medusa');
const rows = ws.slice(1).filter(r => r[3] === 'FY2026');
const accounts = rows.map(r => String(r[4]).trim());
const known = accounts.filter(a => chart.findAccount(a));
const unknown = accounts.filter(a => !chart.findAccount(a));
console.log('total', accounts.length, 'known', known.length, 'unknown', unknown.length);
console.log('unknown sample', unknown.slice(0, 30));

// check kind match: produit rows should have no CostType, charge rows should have OpEx
let mismatches = [];
for (const r of rows) {
  const acc = chart.findAccount(String(r[4]));
  if (!acc) continue;
  const hasOpEx = r[5] === 'OpEx';
  if (acc.kind === 'produit' && hasOpEx) mismatches.push([r[4], 'produit but OpEx', r[2]]);
  if (acc.kind === 'charge' && !hasOpEx) mismatches.push([r[4], 'charge but no OpEx', r[2]]);
}
console.log('mismatches', mismatches.length, mismatches.slice(0,10));
