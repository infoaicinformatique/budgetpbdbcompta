/**
 * Prépare les sources TypeScript pour l'exécution directe par Node.
 *
 * Node exige des extensions explicites dans les imports ESM, alors que la
 * convention Vite/TS est de les omettre. On copie donc les fichiers dans un
 * dossier temporaire en ajoutant les extensions ; le type-stripping natif
 * (Node ≥ 22.6) fait le reste. Aucune compilation, aucune dépendance.
 *
 * Partagé par `run-tests.js` et `check-budget-app.mjs`, pour qu'il n'y ait
 * qu'un seul endroit à corriger si l'arborescence bouge.
 */
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** Dossiers de `src/` embarqués : la logique pure et ses données. */
export const SOURCE_DIRS = ['engine', 'state', 'data'];

/** Ajoute « .ts » aux imports relatifs qui n'ont pas d'extension. */
function addExtensions(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { addExtensions(path); continue; }
    if (!entry.name.endsWith('.ts')) continue;
    const source = readFileSync(path, 'utf8');
    writeFileSync(path, source.replace(/from\s+'(\.{1,2}\/[^']*?)'/g, (whole, spec) =>
      spec.endsWith('.ts') ? whole : `from '${spec}.ts'`));
  }
}

/**
 * @param {string} root racine du projet (dossier contenant `src/`)
 * @param {string} name nom du dossier temporaire
 * @returns {string} chemin du dossier préparé
 */
export function prepareTypeScript(root, name = 'excel-grid-ts') {
  const out = join(tmpdir(), name);
  rmSync(out, { recursive: true, force: true });
  for (const dir of SOURCE_DIRS) mkdirSync(join(out, 'src', dir), { recursive: true });

  cpSync(join(root, 'src', 'types.ts'), join(out, 'src', 'types.ts'));
  for (const dir of SOURCE_DIRS) {
    for (const file of readdirSync(join(root, 'src', dir))) {
      cpSync(join(root, 'src', dir, file), join(out, 'src', dir, file));
    }
  }
  addExtensions(join(out, 'src'));
  return out;
}
