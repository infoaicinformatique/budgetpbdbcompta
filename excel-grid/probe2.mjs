import { join } from 'node:path';
import { prepareTypeScript } from './scripts/lib/prepare-ts.mjs';
const prepared = prepareTypeScript(process.cwd(), 'excel-grid-neo-probe2');
const chart = await import(join(prepared, 'src', 'engine', 'chart.ts'));
for (const acc of ['78174200','76600900','70105100','60101100','65123100']) {
  const a = chart.findAccount(acc);
  console.log(acc, a && a.label, a && a.center, a && a.kind);
}
