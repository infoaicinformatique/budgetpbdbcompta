/* Intégration Nextcloud : Budget Manager servi comme ExApp (AppAPI + HaRP).

   Inactif tant qu'AppAPI n'a pas injecté APP_ID et APP_SECRET : lancé par
   docker compose comme avant, le serveur se comporte exactement comme avant
   (authentification Basic / annuaire LDAP).

   En ExApp, HaRP a déjà vérifié la session Nextcloud et retiré le préfixe
   /exapps/<id> ; il transmet l'utilisateur dans AUTHORIZATION-APP-API
   (base64 « uid:secret »). Ce module :
   - répond au cycle de vie d'AppAPI (/heartbeat, /init, /enabled) et sert le
     script qui affiche l'application dans le cadre Nextcloud (/_nc/...) ;
   - refuse toute requête qui ne porte pas le secret AppAPI : le port n'est
     joignable que par HaRP, et ce contrôle garantit qu'un tiers du réseau
     Docker ne peut pas se faire passer pour lui ;
   - lit l'identité et les groupes de l'utilisateur EN TANT QUE lui
     (/ocs/v1.php/cloud/user, aucun droit d'administration requis), garde un
     cache court, et n'ouvre la porte qu'aux groupes de NC_ALLOWED_GROUPS.
   Les droits fins restent ceux de droits.json : c'est server.mjs qui en
   décide, à partir de l'identifiant d'annuaire (voir resolveAccount). */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';

const env = process.env;
export const APP_ID = env.APP_ID || '';
const APP_SECRET = env.APP_SECRET || '';
export const ENABLED = Boolean(APP_ID && APP_SECRET);

const APP_VERSION = env.APP_VERSION || '1.0.0';
const AA_VERSION = env.AA_VERSION || '32';
export const NEXTCLOUD_URL = String(env.NEXTCLOUD_URL || '').replace(/\/+$/, '');
const DISPLAY_NAME = env.APP_DISPLAY_NAME || 'Budget Manager';
const CACHE_MS = (Number(env.IDENTITY_CACHE_SECONDS) || 60) * 1000;
/* Groupes Nextcloud qui ouvrent l'application (identifiants, séparés par
   virgule ou point-virgule). Vide : tout utilisateur Nextcloud connecté. */
const ALLOWED_GROUPS = String(env.NC_ALLOWED_GROUPS || '').split(/[;,]/).map((g) => g.trim()).filter(Boolean);

const STATIC_DIR = join(dirname(fileURLToPath(import.meta.url)), 'nextcloud', 'static');

/** Chemin sous lequel le navigateur voit l'application ('' hors Nextcloud). */
export function publicPrefix() {
  return ENABLED ? '/exapps/' + APP_ID : '';
}

/** Hôte public de Nextcloud (contrôle d'origine des écritures). */
export function publicHost() {
  try { return NEXTCLOUD_URL ? new URL(NEXTCLOUD_URL).host : ''; } catch (e) { return ''; }
}

export function publicIsHttps() {
  return /^https:/i.test(NEXTCLOUD_URL);
}

function ncHeaders(user) {
  return {
    'AA-VERSION': AA_VERSION, 'EX-APP-ID': APP_ID, 'EX-APP-VERSION': APP_VERSION,
    'AUTHORIZATION-APP-API': Buffer.from(`${user || ''}:${APP_SECRET}`).toString('base64'),
    'OCS-APIRequest': 'true', Accept: 'application/json',
  };
}

/** uid Nextcloud ('' = appel système), ou null si la requête n'est pas authentique. */
function verifiedUser(req) {
  if (String(req.headers['ex-app-id'] || '') !== APP_ID) return null;
  let raw;
  try {
    raw = Buffer.from(String(req.headers['authorization-app-api'] || ''), 'base64').toString('utf8');
  } catch (e) {
    return null;
  }
  const cut = raw.indexOf(':');
  if (cut < 0) return null;
  const given = Buffer.from(raw.slice(cut + 1));
  const expected = Buffer.from(APP_SECRET);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return raw.slice(0, cut);
}

async function ocs(method, path, body, user) {
  const response = await fetch(NEXTCLOUD_URL + '/ocs/v1.php' + path, {
    method,
    headers: Object.assign(ncHeaders(user), body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Nextcloud ${method} ${path} : HTTP ${response.status}`);
  return response;
}

const identityCache = new Map();

/** `{ uid, displayName, mail, groups }`, lus en tant que l'utilisateur lui-même. */
async function identityOf(uid) {
  const now = Date.now();
  const cached = identityCache.get(uid);
  if (cached && cached.expires > now) return cached.identity;
  const data = (await (await ocs('GET', '/cloud/user?format=json', null, uid)).json()).ocs.data;
  const identity = {
    uid: data.id || uid,
    displayName: data.displayname || data['display-name'] || uid,
    mail: data.email || '',
    groups: Array.isArray(data.groups) ? data.groups.map(String) : [],
  };
  if (identityCache.size > 1000) identityCache.clear();
  identityCache.set(uid, { expires: now + CACHE_MS, identity });
  return identity;
}

async function setEnabled(enabled) {
  try {
    if (enabled) {
      await ocs('POST', '/apps/app_api/api/v1/ui/top-menu',
        { name: 'main', displayName: DISPLAY_NAME, icon: '_nc/img/app.svg', adminRequired: 0 });
      await ocs('POST', '/apps/app_api/api/v1/ui/script',
        { type: 'top_menu', name: 'main', path: `_nc/js/${APP_ID}-main`, afterAppId: '' });
    } else {
      await ocs('DELETE', '/apps/app_api/api/v1/ui/top-menu', { name: 'main' });
    }
  } catch (err) {
    console.error('Nextcloud : échec de l\'activation (' + enabled + ') :', err.message);
    return err.message;
  }
  return '';
}

function send(res, status, body, type, extra) {
  res.writeHead(status, Object.assign({ 'Content-Type': type, 'Cache-Control': 'no-store' }, extra || {}));
  res.end(body);
}

const FORBIDDEN_PAGE = '<!doctype html><html lang="fr"><head><meta charset="utf-8" /><title>Accès refusé</title></head>' +
  '<body style="font-family:system-ui,sans-serif;padding:2em;color:#2d3320"><h2>Accès refusé</h2>' +
  '<p>Votre compte Nextcloud n\'appartient pas au groupe autorisé pour Budget Manager. ' +
  'Contactez votre administrateur.</p></body></html>';

/**
 * À appeler en tête de chaque requête quand ENABLED. Répond lui-même et rend
 * `true` pour tout ce qui ne va pas plus loin (cycle de vie, script du cadre,
 * refus) ; sinon dépose l'identité Nextcloud dans `req.nextcloud` et rend `false`.
 */
export async function intercept(req, res, pathname) {
  // Sondes sans authentification : AppAPI (heartbeat) et Docker (healthz).
  if (pathname === '/heartbeat' && req.method === 'GET') {
    send(res, 200, '{"status":"ok"}', 'application/json');
    return true;
  }
  if (pathname === '/healthz') return false;

  const user = verifiedUser(req);
  if (user === null) {
    send(res, 401, '{"error":"Unauthorized"}', 'application/json');
    return true;
  }
  if (pathname === '/init' && req.method === 'POST') {
    send(res, 200, '{}', 'application/json');
    ocs('PUT', '/apps/app_api/ex-app/status', { progress: 100 }).catch(function (err) {
      console.error('Nextcloud : fin d\'initialisation non signalée :', err.message);
    });
    return true;
  }
  if (pathname === '/enabled' && req.method === 'PUT') {
    const query = new URL(req.url, 'http://x').searchParams.get('enabled');
    const error = await setEnabled(!(query === '0' || query === 'false'));
    send(res, 200, JSON.stringify({ error }), 'application/json');
    return true;
  }
  if (pathname === '/_nc/img/app.svg') {
    send(res, 200, readFileSync(join(STATIC_DIR, 'app.svg')), 'image/svg+xml');
    return true;
  }
  if (pathname === `/_nc/js/${APP_ID}-main.js`) {
    const script = readFileSync(join(STATIC_DIR, 'exapp-main.js'), 'utf8').replaceAll('__APP_ID__', APP_ID);
    send(res, 200, script, 'application/javascript; charset=utf-8', { 'Cache-Control': 'no-cache' });
    return true;
  }

  // Navigateur : HaRP n'achemine ici que des utilisateurs connectés.
  if (!user) {
    send(res, 401, '{"error":"Utilisateur Nextcloud requis"}', 'application/json');
    return true;
  }
  let identity;
  try {
    identity = await identityOf(user);
  } catch (err) {
    // En cas de doute, on ferme.
    console.error(`Nextcloud : identité illisible pour « ${user} » :`, err.message);
    send(res, 503, 'Nextcloud injoignable\n', 'text/plain; charset=utf-8');
    return true;
  }
  if (ALLOWED_GROUPS.length && !identity.groups.some((g) => ALLOWED_GROUPS.includes(g))) {
    console.warn(`Nextcloud : accès refusé à « ${identity.uid} » (groupes ${identity.groups.join(', ') || 'aucun'})`);
    send(res, 403, FORBIDDEN_PAGE, 'text/html; charset=utf-8');
    return true;
  }
  req.nextcloud = identity;
  return false;
}
