// Tests du mode ExApp Nextcloud (nextcloud-exapp.mjs + server.mjs) : le serveur
// est lancé avec les variables qu'injecte AppAPI, face à un FAUX Nextcloud
// (identité, groupes, menu). Aucun annuaire : l'identifiant Nextcloud sert de
// clé aux droits. Lancer : npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP_ID = 'budgetpbdbcompta';
const SECRET = 'secret-de-test-appapi';
const USERS = {
  'a.porrati': { displayname: 'Alexis Porrati', email: 'a.porrati@exemple.fr', groups: ['budgetpbdbcompta', 'Tous'] },
  'b.dupont': { displayname: 'Bruno Dupont', email: 'b.dupont@exemple.fr', groups: ['Commercial'] },
};
const calls = [];
let child = null;
let fakeNc = null;
let base = '';
let ncBase = '';

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/** En-têtes qu'ajoute HaRP : uid Nextcloud ('' = appel système) et secret. */
function appApi(uid, secret = SECRET) {
  return {
    'EX-APP-ID': APP_ID, 'EX-APP-VERSION': '1.0.0', 'AA-VERSION': '32',
    'AUTHORIZATION-APP-API': Buffer.from(`${uid}:${secret}`).toString('base64'),
  };
}

before(async () => {
  const ncPort = await freePort();
  ncBase = `http://127.0.0.1:${ncPort}`;
  fakeNc = createServer((req, res) => {
    const uid = Buffer.from(String(req.headers['authorization-app-api'] || ''), 'base64').toString().split(':')[0];
    const path = req.url.replace(/\?.*$/, '');
    calls.push({ method: req.method, path, uid });
    res.setHeader('Content-Type', 'application/json');
    if (path === '/ocs/v1.php/cloud/user') {
      const u = USERS[uid];
      if (!u) { res.statusCode = 401; return res.end('{}'); }
      return res.end(JSON.stringify({ ocs: { meta: {}, data: Object.assign({ id: uid }, u) } }));
    }
    res.end('{"ocs":{"meta":{},"data":{}}}');
  });
  await new Promise((r) => fakeNc.listen(ncPort, '127.0.0.1', r));

  const dir = mkdtempSync(join(tmpdir(), 'exapp-'));
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  const env = Object.assign({}, process.env, {
    HOST: '127.0.0.1', PORT: String(port),
    APP_ID, APP_SECRET: SECRET, APP_VERSION: '1.0.0', NEXTCLOUD_URL: ncBase,
    NC_ALLOWED_GROUPS: 'budgetpbdbcompta', RIGHTS_ADMINS: 'a.porrati',
    // Le compte local doit rester sans effet en ExApp.
    BASIC_AUTH_USER: 'admin', BASIC_AUTH_PASSWORD: 'mot-de-passe-de-test',
    RIGHTS_FILE: join(dir, 'droits.json'), DATA_FILE: join(dir, 'budget.json'),
    PREFERENCES_FILE: join(dir, 'preferences.json'),
  });
  for (const key of Object.keys(env)) if (key.startsWith('LDAP_')) delete env[key];
  child = spawn(process.execPath, [join(root, 'server.mjs')], { env, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + '/heartbeat')).ok) return;
    } catch (e) { /* pas encore à l'écoute */ }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('le serveur ne répond pas');
});

after(() => {
  if (child) child.kill();
  if (fakeNc) fakeNc.close();
});

test('sondes sans identité : /heartbeat (AppAPI) et /healthz (Docker)', async () => {
  assert.equal((await fetch(base + '/heartbeat')).status, 200);
  assert.equal((await fetch(base + '/healthz')).status, 200);
});

test('sans le secret AppAPI : 401, sans fenêtre d\'identifiants', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('www-authenticate'), null);
  assert.equal((await fetch(base + '/', { headers: appApi('a.porrati', 'mauvais-secret') })).status, 401);
});

test('le compte local ne vaut rien en ExApp', async () => {
  const basic = 'Basic ' + Buffer.from('admin:mot-de-passe-de-test').toString('base64');
  assert.equal((await fetch(base + '/', { headers: { Authorization: basic } })).status, 401);
});

test('membre du groupe : page servie dans le cadre Nextcloud, cookie cantonné', async () => {
  const res = await fetch(base + '/', { headers: appApi('a.porrati') });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /<html/i);
  assert.equal(res.headers.get('x-frame-options'), null);
  assert.equal(res.headers.get('content-security-policy'), "frame-ancestors 'self'");
  const cookie = res.headers.get('set-cookie') || '';
  assert.match(cookie, new RegExp(`bm-auth=.*Path=/exapps/${APP_ID}/`));
  const info = JSON.parse(decodeURIComponent(/bm-auth=([^;]+)/.exec(cookie)[1]));
  assert.equal(info.method, 'ldap');
  assert.equal(info.username, 'a.porrati');
  assert.equal(info.displayName, 'Alexis Porrati');
});

test('hors du groupe : 403 « Accès refusé »', async () => {
  const res = await fetch(base + '/', { headers: appApi('b.dupont') });
  assert.equal(res.status, 403);
  assert.match(await res.text(), /Accès refusé/);
  assert.equal((await fetch(base + '/api/droits/moi', { headers: appApi('b.dupont') })).status, 403);
});

test('identité et droits : RIGHTS_ADMINS appliqué à l\'identifiant Nextcloud', async () => {
  const res = await fetch(base + '/api/droits/moi', { headers: appApi('a.porrati') });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.account, 'a.porrati');
  assert.equal(body.method, 'ldap');
  assert.equal(body.rights.isAdmin, true);
});

test('écriture : origine Nextcloud acceptée même si Host désigne le conteneur, origine tierce refusée', async () => {
  const headers = Object.assign(appApi('a.porrati'), {
    'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', Origin: ncBase,
  });
  const ok = await fetch(base + '/api/preferences', { method: 'PUT', headers, body: JSON.stringify({ companyOrder: [] }) });
  assert.equal(ok.status, 200);
  headers.Origin = 'https://site-tiers.example';
  const ko = await fetch(base + '/api/preferences', { method: 'PUT', headers, body: JSON.stringify({ companyOrder: [] }) });
  assert.equal(ko.status, 403);
});

test('/deconnexion ramène à l\'application', async () => {
  const res = await fetch(base + '/deconnexion', { headers: appApi('a.porrati'), redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), `/exapps/${APP_ID}/`);
});

test('script du cadre et icône servis', async () => {
  const js = await fetch(base + `/_nc/js/${APP_ID}-main.js`, { headers: appApi('a.porrati') });
  assert.equal(js.status, 200);
  const text = await js.text();
  assert.ok(text.includes(`'${APP_ID}'`));
  assert.ok(text.includes("querySelectorAll('#content')"), 'le script doit viser le dernier #content (Nextcloud 35)');
  assert.equal((await fetch(base + '/_nc/img/app.svg', { headers: appApi('a.porrati') })).status, 200);
});

test('cycle de vie : init, activation (menu + script), désactivation', async () => {
  assert.deepEqual(await (await fetch(base + '/init', { method: 'POST', headers: appApi('') })).json(), {});
  assert.deepEqual(await (await fetch(base + '/enabled?enabled=1', { method: 'PUT', headers: appApi('') })).json(), { error: '' });
  assert.deepEqual(await (await fetch(base + '/enabled?enabled=0', { method: 'PUT', headers: appApi('') })).json(), { error: '' });
  await new Promise((r) => setTimeout(r, 200));
  const ops = calls.filter((c) => c.path !== '/ocs/v1.php/cloud/user').map((c) => c.method + ' ' + c.path);
  assert.deepEqual(ops, [
    'PUT /ocs/v1.php/apps/app_api/ex-app/status',
    'POST /ocs/v1.php/apps/app_api/api/v1/ui/top-menu',
    'POST /ocs/v1.php/apps/app_api/api/v1/ui/script',
    'DELETE /ocs/v1.php/apps/app_api/api/v1/ui/top-menu',
  ]);
});

test('identité Nextcloud mise en cache (un seul appel par personne)', async () => {
  const n = calls.filter((c) => c.path === '/ocs/v1.php/cloud/user' && c.uid === 'a.porrati').length;
  assert.equal(n, 1);
});
