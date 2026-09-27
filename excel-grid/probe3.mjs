import { join } from 'node:path';
import { prepareTypeScript } from './scripts/lib/prepare-ts.mjs';
const prepared = prepareTypeScript(process.cwd(), 'excel-grid-neo-probe3');
const chart = await import(join(prepared, 'src', 'engine', 'chart.ts'));
for (const acc of ['78174200','76600900','70105100','60101100','65123100','60614700']) {
  const a = chart.findAccount(acc);
  console.log(JSON.stringify({acc, label: a && a.label, center: a && a.center, kind: a && a.kind}));
}
