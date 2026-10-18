// Tests de server.mjs par de vraies requêtes HTTP : le serveur est lancé tel
// qu'en production (compte local, fichiers temporaires, port libre).
// Lancer : npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const auth = 'Basic ' + Buffer.from('admin:mot-de-passe-de-test').toString('base64');
let child = null;
let base = '';

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'serveur-'));
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  const env = Object.assign({}, process.env, {
    HOST: '127.0.0.1', PORT: String(port),
    BASIC_AUTH_USER: 'admin', BASIC_AUTH_PASSWORD: 'mot-de-passe-de-test',
    RIGHTS_FILE: join(dir, 'droits.json'), DATA_FILE: join(dir, 'budget.json'),
    PREFERENCES_FILE: join(dir, 'preferences.json'),
  });
  for (const key of Object.keys(env)) if (key.startsWith('LDAP_') || key === 'RIGHTS_ADMINS') delete env[key];
  child = spawn(process.execPath, [join(root, 'server.mjs')], { env, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + '/healthz')).ok) return;
    } catch (e) { /* pas encore à l'écoute */ }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('le serveur ne répond pas');
});

after(() => { if (child) child.kill(); });

/** Requête telle que l'envoie la page : même origine, identité du compte local. */
function call(method, path, { body, headers = {} } = {}) {
  const all = Object.assign({ Authorization: auth, Origin: base, 'Sec-Fetch-Site': 'same-origin' }, headers);
  if (body !== undefined) all['Content-Type'] = 'application/json';
  return fetch(base + path, { method, headers: all, body: body === undefined ? undefined : JSON.stringify(body) });
}

const fiche = { role: 'directeur', isAdmin: false, permissions: { saisie: ['saisie-ajouter'] },
  allowedCompanies: null, allowedCostCenters: null, environmentIds: [] };

test('« retirer l’accès » : DELETE sans corps accepté depuis la page (18/10/2026)', async () => {
  // La page n'envoie pas de type de contenu sans corps : c'est ce qui
  // valait « Requête refusée : origine non vérifiée » à tout le monde.
  assert.equal((await call('PUT', '/api/droits/j.dupont', { body: fiche })).status, 200);
  const removed = await call('DELETE', '/api/droits/j.dupont');
  assert.equal(removed.status, 200, 'accès retiré');
  assert.deepEqual(await removed.json(), { account: 'j.dupont', removed: true });

  // Même chose pour un rôle personnalisé.
  const role = { label: 'Chef de cuisine', description: '', base: 'directeur', permissions: {}, allowedCostCenters: null };
  assert.equal((await call('PUT', '/api/droits/roles/role_chef', { body: role })).status, 200);
  const roleRemoved = await call('DELETE', '/api/droits/roles/role_chef');
  assert.equal(roleRemoved.status, 200, 'rôle supprimé');
});

test('les écritures venues d’ailleurs restent refusées', async () => {
  assert.equal((await call('PUT', '/api/droits/j.martin', { body: fiche })).status, 200);
  const otherSite = await call('DELETE', '/api/droits/j.martin', { headers: { Origin: 'https://ailleurs.example' } });
  assert.equal(otherSite.status, 403, 'autre origine');
  assert.match((await otherSite.json()).error, /origine non vérifiée/);
  const crossSite = await call('DELETE', '/api/droits/j.martin', { headers: { 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(crossSite.status, 403, 'requête d’un autre site');
  // Une écriture AVEC corps doit toujours être déclarée en JSON.
  const notJson = await fetch(base + '/api/droits/j.martin', {
    method: 'PUT', body: JSON.stringify(fiche),
    headers: { Authorization: auth, Origin: base, 'Content-Type': 'text/plain' },
  });
  assert.equal(notJson.status, 403, 'PUT non JSON');
  // Rien n'a été retiré par ces tentatives.
  assert.equal((await call('DELETE', '/api/droits/j.martin')).status, 200);
});
