/**
 * Lance les suites de tests sans aucune dépendance externe.
 *
 * Les sources sont préparées par `lib/prepare-ts.mjs` (ajout des extensions
 * dans les imports), puis exécutées avec le type-stripping natif de Node.
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareTypeScript } from './lib/prepare-ts.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = prepareTypeScript(root, 'excel-grid-tests');

const suites = [
  join(out, 'src', 'engine', 'engine.test.ts'),
  join(out, 'src', 'engine', 'chart.test.ts'),
  join(out, 'src', 'state', 'gridReducer.test.ts'),
];
for (const suite of suites) {
  execFileSync(process.execPath, ['--experimental-strip-types', suite], { stdio: 'inherit' });
}
