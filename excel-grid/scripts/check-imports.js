/**
 * Vérification statique du graphe d'imports, sans aucune dépendance.
 *
 * Ce n'est PAS un remplaçant de `tsc` : ça ne vérifie aucun type. Ça
 * attrape la famille d'erreurs la plus fréquente lors d'un refactor —
 * un fichier déplacé, un export renommé, un import laissé derrière —
 * et ça tourne partout, même sans `node_modules`.
 *
 * Usage : npm run check
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve as resolvePath, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'src');

/** Tous les fichiers source du projet. */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(path);
  }
  return out;
}

/** Retire commentaires et chaînes pour ne pas analyser du texte inerte. */
function strip(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** Résout un import relatif vers un fichier réel. */
function resolveImport(fromFile, spec) {
  const base = resolvePath(dirname(fromFile), spec);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.d.ts`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Noms exportés par un fichier (approximation volontairement large). */
function exportedNames(file) {
  const source = strip(readFileSync(file, 'utf8'));
  const names = new Set();

  // export function foo / const foo / class Foo / type Foo / interface Foo
  for (const m of source.matchAll(
    /export\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:function|const|let|var|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    names.add(m[1]);
  }
  // export { a, b as c }
  for (const m of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const piece = part.trim().replace(/^type\s+/, '');
      if (!piece) continue;
      const asMatch = piece.match(/\bas\s+([A-Za-z_$][\w$]*)/);
      names.add(asMatch ? asMatch[1] : piece);
    }
  }
  if (/export\s+default/.test(source)) names.add('default');
  return names;
}

const files = walk(srcDir);
const exportsByFile = new Map(files.map((f) => [f, exportedNames(f)]));
const problems = [];
const rel = (f) => relative(root, f).replace(/\\/g, '/');

for (const file of files) {
  const source = strip(readFileSync(file, 'utf8'));

  for (const m of source.matchAll(/import\s+([^;]*?)\s*from\s*'([^']+)'|import\s*'([^']+)'/g)) {
    const clause = m[1] ?? '';
    const spec = m[2] ?? m[3];
    if (!spec.startsWith('.')) continue; // paquet npm : hors de portée ici

    const target = resolveImport(file, spec);
    if (!target) {
      // Les feuilles de style sont résolues par Vite, pas par nous.
      if (/\.css$/.test(spec) && existsSync(resolvePath(dirname(file), spec))) continue;
      problems.push(`${rel(file)} : import introuvable '${spec}'`);
      continue;
    }
    if (/\.css$/.test(spec)) continue;

    const known = exportsByFile.get(target) ?? exportedNames(target);
    const named = clause.match(/\{([^}]*)\}/);
    if (named) {
      for (const part of named[1].split(',')) {
        const piece = part.trim().replace(/^type\s+/, '');
        if (!piece) continue;
        const name = piece.split(/\s+as\s+/)[0].trim();
        if (name && !known.has(name)) {
          problems.push(`${rel(file)} : '${name}' n'est pas exporté par ${rel(target)}`);
        }
      }
    }
    const def = clause.replace(/^type\s+/, '').match(/^([A-Za-z_$][\w$]*)\s*(?:,|$)/);
    if (def && !known.has('default')) {
      problems.push(`${rel(file)} : ${rel(target)} n'a pas d'export par défaut`);
    }
  }
}

if (problems.length) {
  console.error(`${problems.length} problème(s) d'import :`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`Graphe d'imports vérifié : ${files.length} fichiers, aucun lien cassé.`);
