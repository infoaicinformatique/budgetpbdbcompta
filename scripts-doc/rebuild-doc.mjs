import { readFileSync, writeFileSync } from 'node:fs';

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Racine = dossier parent de scripts-doc/
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const doc = readFileSync(join(root, "REPRISE-PROJET.md"), 'utf8');
const marker = '## 7. Code source complet';
const head = doc.slice(0, doc.indexOf(marker));

const files = [
  'package.json', 'tsconfig.json', 'vite.config.ts', 'index.html', '.gitignore',
  'scripts/run-tests.js', 'scripts/check-imports.js', 'scripts/check-budget-app.mjs',
  'scripts/import-pcg.mjs', 'scripts/import-budget.mjs',
  'scripts/lib/xlsx-read.mjs', 'scripts/lib/prepare-ts.mjs',
  'src/main.tsx', 'src/App.tsx', 'src/index.css', 'src/types.ts', 'src/vite-env.d.ts',
  'src/engine/coords.ts', 'src/engine/lexer.ts', 'src/engine/evaluate.ts',
  'src/engine/refs.ts', 'src/engine/fill.ts', 'src/engine/chart.ts',
  'src/engine/engine.test.ts', 'src/engine/chart.test.ts',
  'src/state/gridReducer.ts', 'src/state/gridReducer.test.ts',
  'src/components/Grid.tsx', 'src/components/Cell.tsx', 'src/components/FormulaBar.tsx',
  'src/components/layout.ts', 'src/components/grid.css',
  'src/data/sample.ts',
];
const lang = (f) => f.endsWith('.json') || f === '.gitignore' ? (f.endsWith('.json') ? 'json' : 'text')
  : f.endsWith('.tsx') ? 'tsx' : f.endsWith('.ts') ? 'ts' : f.endsWith('.js') ? 'js'
  : f.endsWith('.css') ? 'css' : f.endsWith('.html') ? 'html' : 'text';

let out = `${marker} — \`excel-grid/\`

\`\`\`
excel-grid/
├── package.json / tsconfig.json / vite.config.ts / index.html / .gitignore
├── scripts/   run-tests.js · check-imports.js · check-budget-app.mjs
│              import-pcg.mjs · lib/xlsx-read.mjs · lib/prepare-ts.mjs
└── src/
    ├── main.tsx · App.tsx · index.css · types.ts · vite-env.d.ts
    ├── engine/    coords · lexer · evaluate · refs · fill · chart  (+ tests)
    ├── state/     gridReducer                                     (+ tests)
    ├── components/ Grid · Cell · FormulaBar · layout · grid.css
    └── data/      sample.ts · pcg.generated.ts
\`\`\`

> Section régénérée automatiquement depuis les fichiers réels
> (\`node scripts-doc/rebuild-doc.mjs\`) : elle ne peut pas diverger du code.
>
> Deux fichiers ne sont **pas** reproduits ici, car générés et volumineux :
> \`src/data/pcg.generated.ts\` (1 032 comptes) et le bloc de données de
> \`budget-app.html\`. Ils se régénèrent avec \`npm run import:pcg\`.

`;
for (const f of files) {
  const body = readFileSync(join(root, "excel-grid", f), 'utf8').replace(/\s+$/, '');
  out += `\n### \`${f}\`\n\n\`\`\`${lang(f)}\n${body}\n\`\`\`\n`;
}
writeFileSync(join(root, "REPRISE-PROJET.md"), head + out);
console.log('doc régénérée :', files.length, 'fichiers');
