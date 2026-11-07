// Les images ne contiennent que les fichiers listés : un module importé par
// server.mjs mais oublié dans un Dockerfile fait planter le serveur au
// démarrage, en production seulement (07/11/2026 : nextcloud-exapp.mjs absent
// du Dockerfile, 502 après le déploiement Watchtower). Lancer : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFileSync(join(root, name), 'utf8');

/** Modules locaux nécessaires au serveur, imports des imports compris. */
function localModules(entry) {
  const seen = new Set();
  const visit = (name) => {
    if (seen.has(name)) return;
    seen.add(name);
    for (const m of read(name).matchAll(/from\s+'\.\/([^']+)'/g)) visit(m[1]);
  };
  visit(entry);
  return [...seen];
}

/** Fichiers copiés à la racine de /app par les lignes COPY d'un Dockerfile. */
function copiedFiles(dockerfile) {
  const files = new Set();
  for (const line of read(dockerfile).split(/\r?\n/)) {
    const m = /^COPY\s+(?!--)(.+?)\s+\.\/\s*$/.exec(line);
    if (m) m[1].split(/\s+/).forEach((f) => files.add(f));
  }
  return files;
}

const modules = localModules('server.mjs').concat('budget-app.html');

for (const dockerfile of ['Dockerfile', 'Dockerfile.exapp']) {
  test(`${dockerfile} copie tous les modules dont server.mjs a besoin`, () => {
    const copied = copiedFiles(dockerfile);
    const missing = modules.filter((f) => !copied.has(f));
    assert.deepEqual(missing, [], `absents de ${dockerfile} : ${missing.join(', ')}`);
  });
}

test('.dockerignore (liste blanche) laisse passer tous ces modules', () => {
  const allowed = read('.dockerignore').split(/\r?\n/).filter((l) => l.startsWith('!')).map((l) => l.slice(1).trim());
  const missing = modules.filter((f) => !allowed.includes(f));
  assert.deepEqual(missing, [], `absents de .dockerignore : ${missing.join(', ')}`);
});
