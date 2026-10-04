/**
 * Serveur de production de Budget Manager.
 *
 * Sert uniquement `budget-app.html` (l'application tient dans ce fichier) :
 * aucun autre fichier du dépôt n'est exposé — ni le document de reprise,
 * ni le plan comptable Excel, ni les scripts. Deux autres adresses :
 * `/api/droits`, les droits des personnes de l'annuaire (voir rights.mjs),
 * et `/api/etat`, le budget lui-même, partagé par tous les postes (etat.mjs).
 *
 * Node ≥ 22 ; seule dépendance : `ldapts`, pour l'authentification LDAP.
 *
 * Variables d'environnement :
 *   HOST                 adresse d'écoute (défaut 127.0.0.1, derrière le reverse proxy)
 *   PORT                 port d'écoute (défaut 3000)
 *   PUBLIC_HOST          nom de domaine public (défaut budgetpbdbcompta.aic-informatique.net)
 *   BASIC_AUTH_USER      } compte local : si les deux sont renseignés, il ouvre
 *   BASIC_AUTH_PASSWORD  } l'accès (compte de secours quand LDAP est actif)
 *   LDAP_*               authentification par annuaire : voir auth-ldap.mjs et .env.example
 *   TRUST_PROXY          true derrière Nginx Proxy Manager : l'adresse du client
 *                        est lue dans X-Real-IP (limitation des essais)
 *   RIGHTS_FILE          fichier des droits (défaut ./data/droits.json)
 *   RIGHTS_ADMINS        identifiants de l'annuaire toujours administrateurs
 *                        des droits (« prenom.nom, autre.nom »)
 *   ETAT_FILE            fichier de l'état budgétaire partagé (défaut ./data/etat.json)
 *
 * Sans compte local ni LDAP, l'application est publique.
 */
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { gzipSync, brotliCompressSync, constants as zlib } from 'node:zlib';
import { createHash, timingSafeEqual } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ldapConfigFromEnv, describeLdapConfig, publicLdapInfo, ldapAuthenticateEntry, ldapListGroupMembers,
  LdapUnavailableError,
} from './auth-ldap.mjs';
import { createRightsStore, parseAdminList, normalizeAccount, RightsError } from './rights.mjs';
import { createEtatStore, EtatError, ETAT_MAX_BYTES } from './etat.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_HOST = process.env.PUBLIC_HOST || 'budgetpbdbcompta.aic-informatique.net';
const AUTH_USER = process.env.BASIC_AUTH_USER || '';
const AUTH_PASSWORD = process.env.BASIC_AUTH_PASSWORD || '';
const localAuthEnabled = AUTH_USER !== '' && AUTH_PASSWORD !== '';
const TRUST_PROXY = /^(1|true|oui|yes)$/i.test(String(process.env.TRUST_PROXY || '').trim());

// Configuration LDAP incomplète : on s'arrête, plutôt que de démarrer
// sans le contrôle d'accès attendu.
let ldapConfig;
try {
  ldapConfig = ldapConfigFromEnv(process.env);
} catch (err) {
  console.error('Démarrage refusé — ' + err.message);
  process.exit(1);
}
const authEnabled = localAuthEnabled || ldapConfig !== null;

const RIGHTS_FILE = process.env.RIGHTS_FILE || join(root, 'data', 'droits.json');
const RIGHTS_ADMINS = parseAdminList(process.env.RIGHTS_ADMINS);
const rights = createRightsStore(RIGHTS_FILE, RIGHTS_ADMINS);

// État budgétaire partagé : le serveur fait foi depuis le 04/10/2026
// (Alexis : « je ne veux pas que les informations soient enregistré dans le
// poste et navigateur mais plus sur le serveur »). Même volume que les
// droits, pour n'avoir qu'un seul endroit à sauvegarder.
const ETAT_FILE = process.env.ETAT_FILE || join(root, 'data', 'etat.json');
const etat = createEtatStore(ETAT_FILE);

const appPath = join(root, 'budget-app.html');

// Le fichier fait ~1,7 Mo : il est lu et compressé une fois au démarrage,
// puis rechargé si sa date de modification change (mise à jour par git pull).
let cache = null;
function loadApp() {
  const mtimeMs = statSync(appPath).mtimeMs;
  if (cache && cache.mtimeMs === mtimeMs) return cache;
  const raw = readFileSync(appPath);
  cache = {
    mtimeMs,
    raw,
    gzip: gzipSync(raw, { level: 9 }),
    br: brotliCompressSync(raw, { params: { [zlib.BROTLI_PARAM_QUALITY]: 9 } }),
    etag: '"' + createHash('sha1').update(raw).digest('base64url') + '"',
    lastModified: new Date(mtimeMs).toUTCString(),
  };
  return cache;
}

const expectedLocalAuth = localAuthEnabled
  ? Buffer.from('Basic ' + Buffer.from(`${AUTH_USER}:${AUTH_PASSWORD}`).toString('base64'))
  : null;

// Le navigateur renvoie l'en-tête Basic à chaque requête : une connexion
// LDAP réussie est mémorisée quelques minutes (condensat de l'en-tête, jamais
// le mot de passe), pour ne pas solliciter l'annuaire à chaque rechargement.
// Un compte désactivé dans l'annuaire perd donc l'accès au plus tard après
// ce délai.
const LDAP_CACHE_MS = (Number(process.env.LDAP_CACHE_SECONDS) || 300) * 1000;
const ldapCache = new Map(); // condensat de l'en-tête → { expires, username, account, displayName, dn }

// Limitation des essais : au-delà de MAX_FAILURES échecs en FAILURE_WINDOW_MS
// depuis une même adresse, les demandes sont refusées (429) jusqu'à la fin
// de la fenêtre. Protège aussi les vrais comptes : Active Directory verrouille
// un compte après quelques mots de passe erronés.
const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const failures = new Map(); // adresse → { count, since }

function clientAddress(req) {
  const forwarded = TRUST_PROXY ? String(req.headers['x-real-ip'] || '').trim() : '';
  return forwarded || req.socket.remoteAddress || '?';
}

function tooManyFailures(address) {
  const entry = failures.get(address);
  if (!entry) return false;
  if (Date.now() - entry.since > FAILURE_WINDOW_MS) {
    failures.delete(address);
    return false;
  }
  return entry.count >= MAX_FAILURES;
}

function recordFailure(address) {
  const entry = failures.get(address);
  if (entry && Date.now() - entry.since <= FAILURE_WINDOW_MS) entry.count++;
  else failures.set(address, { count: 1, since: Date.now() });
  if (failures.size > 10000) failures.clear(); // garde-fou mémoire
}

/** Identifiant et mot de passe d'un en-tête Basic, ou `null`. */
function parseBasic(header) {
  const match = /^Basic ([A-Za-z0-9+/=]+)$/.exec(header);
  if (!match) return null;
  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  if (colon < 0) return null;
  return { username: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
}

/**
 * Contrôle d'accès : compte local d'abord, puis annuaire LDAP. Renvoie
 * `{ status, method, username, account, displayName, dn }` : `status` est
 * le code HTTP à répondre en cas de refus (401 identifiants refusés, 429
 * trop d'essais, 503 annuaire indisponible), ou 0 si l'accès est accordé ;
 * `method` dit par quelle voie (`ldap`, `local`, `none` quand l'accès est
 * libre) ; `account` est l'identifiant canonique, clé des droits.
 */
async function authenticate(req) {
  if (!authEnabled) return { status: 0, method: 'none' };
  const header = String(req.headers.authorization || '');
  const given = Buffer.from(header);
  if (expectedLocalAuth && given.length === expectedLocalAuth.length && timingSafeEqual(given, expectedLocalAuth)) {
    return { status: 0, method: 'local', username: AUTH_USER, account: normalizeAccount(AUTH_USER) || 'local' };
  }
  if (!ldapConfig || !header) return { status: 401 };

  const key = createHash('sha256').update(header).digest('base64url');
  const cached = ldapCache.get(key);
  if (cached && cached.expires > Date.now()) {
    return {
      status: 0, method: 'ldap', username: cached.username, account: cached.account,
      displayName: cached.displayName, dn: cached.dn,
    };
  }
  if (cached) ldapCache.delete(key);

  const address = clientAddress(req);
  if (tooManyFailures(address)) return { status: 429 };

  const credentials = parseBasic(header);
  if (!credentials) return { status: 401 };
  let entry;
  try {
    entry = await ldapAuthenticateEntry(ldapConfig, credentials.username, credentials.password);
  } catch (err) {
    if (!(err instanceof LdapUnavailableError)) throw err;
    console.error(err.message);
    return { status: 503 };
  }
  if (!entry) {
    recordFailure(address);
    console.warn(`Connexion LDAP refusée : « ${credentials.username} » depuis ${address}`);
    return { status: 401 };
  }
  failures.delete(address);
  if (ldapCache.size > 1000) ldapCache.clear();
  const identity = {
    username: credentials.username, account: entry.account, displayName: entry.displayName, dn: entry.dn,
  };
  ldapCache.set(key, Object.assign({ expires: Date.now() + LDAP_CACHE_MS }, identity));
  console.log(`Connexion LDAP : « ${credentials.username} » (${entry.dn}) depuis ${address}`);
  return Object.assign({ status: 0, method: 'ldap' }, identity);
}

// Rubrique LDAP de Paramètres. L'application s'interdit tout appel réseau
// (CSP `connect-src 'none'`) : c'est donc la page elle-même qui apporte ces
// informations, dans un cookie lisible par le script — et non dans le HTML,
// qui resterait sinon à recompresser à chaque requête. Rien de secret : qui
// est connecté, par quelle voie, et la configuration publique de l'annuaire
// (jamais le compte de service ni un mot de passe).
const AUTH_INFO_COOKIE = 'bm-auth';
const ldapPublicInfo = ldapConfig ? publicLdapInfo(ldapConfig) : null;

function authInfoCookie(req, auth) {
  const info = {
    v: 1,
    method: auth.method,
    username: auth.account || auth.username || '',
    displayName: auth.displayName || '',
    dn: auth.dn || '',
    local: localAuthEnabled,
    ldap: ldapPublicInfo,
  };
  let value = encodeURIComponent(JSON.stringify(info));
  // Un cookie est plafonné vers 4 Ko : un DN démesuré saute en premier.
  if (value.length > 3500) {
    info.dn = '';
    value = encodeURIComponent(JSON.stringify(info));
  }
  const https = TRUST_PROXY && String(req.headers['x-forwarded-proto'] || '').trim() === 'https';
  // Pas de HttpOnly : le script DOIT pouvoir le lire, c'est sa raison d'être.
  return `${AUTH_INFO_COOKIE}=${value}; Path=/; SameSite=Strict` + (https ? '; Secure' : '');
}

const DENIED = {
  401: 'Authentification requise\n',
  429: 'Trop d’essais : réessayez dans quelques minutes\n',
  503: 'Annuaire indisponible : réessayez plus tard\n',
};

/* ---------------- /api/droits ----------------

   GET    /api/droits/moi        mes droits (toute personne connectée)
   GET    /api/droits            membres du groupe + toutes les fiches (administrateurs)
   PUT    /api/droits/<compte>   enregistre la fiche d'un compte (administrateurs)
   DELETE /api/droits/<compte>   retire l'accès d'un compte (administrateurs)

   Administrateur : fiche marquée `isAdmin`, compte de RIGHTS_ADMINS, ou le
   compte local de secours (qui doit pouvoir tout rattraper si l'annuaire
   ou le fichier des droits fait défaut). */
const API_PREFIX = '/api/droits';
const API_BODY_MAX = 64 * 1024;

/* GET /api/etat    l'état budgétaire partagé et sa version
   PUT /api/etat    l'enregistre : { baseVersion, state } → 409 si la version
                    a changé entre-temps (voir etat.mjs)

   Ouvert à toute personne ayant une fiche de droits : un directeur doit
   pouvoir enregistrer sa saisie. Le serveur ne sait pas ce qu'une fiche
   autorise dans le détail (onglets, sociétés, centres) — ce filtrage reste
   dans l'application. Chaque écriture est journalisée avec son auteur. */
const API_ETAT = '/api/etat';
// Marge au-dessus de la taille utile : le corps transporte aussi `baseVersion`.
const ETAT_BODY_MAX = ETAT_MAX_BYTES + 64 * 1024;

/** Droits de la personne connectée, ou `null` (aucun accès). */
function rightsOf(auth) {
  if (auth.method === 'local') {
    return {
      role: 'controleur', isAdmin: true, permissions: null,
      allowedCompanies: null, allowedCostCenters: null, environmentIds: [],
    };
  }
  if (auth.method !== 'ldap') return null;
  return rights.effective(auth.account);
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

/**
 * Une écriture ne peut venir que de la page elle-même. Le navigateur
 * renvoie l'en-tête Basic à tout le monde, y compris à un site tiers qui
 * forgerait la requête : on exige donc le JSON (qui impose une requête
 * préalable CORS à laquelle ce serveur ne répond pas) et, quand le
 * navigateur les fournit, une origine identique.
 */
function sameOriginWrite(req) {
  if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) return false;
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin') return false;
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) return false;
    } catch (e) {
      return false;
    }
  }
  return true;
}

function readJsonBody(req, max) {
  const limit = max || API_BODY_MAX;
  return new Promise(function (resolve, reject) {
    const chunks = [];
    let size = 0;
    req.on('data', function (chunk) {
      size += chunk.length;
      if (size > limit) {
        reject(new RightsError('Requête trop volumineuse.', 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', function () {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'));
      } catch (e) {
        reject(new RightsError('JSON invalide.'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * `/api/etat` : lecture et écriture de l'état budgétaire partagé.
 *
 * Sans fiche de droits, rien — pas même la lecture : une personne que
 * l'administrateur n'a pas encore configurée ne doit pas voir les budgets
 * du groupe (même règle que `serverUserFromRights` côté application).
 */
async function handleEtat(req, res, req_url, auth) {
  if (auth.method === 'none') {
    return sendJson(res, 404, { error: 'État centralisé inactif : le site est ouvert sans authentification.' });
  }
  const own = rightsOf(auth);
  if (!own) return sendJson(res, 403, { error: 'Aucun droit : demandez un accès à un administrateur.' });
  if (req_url.pathname !== API_ETAT) return sendJson(res, 404, { error: 'Introuvable.' });
  const by = auth.account || auth.username || '?';
  try {
    if (req.method === 'GET') {
      const current = etat.read();
      return sendJson(res, 200, {
        version: current.version, updatedAt: current.updatedAt, updatedBy: current.updatedBy,
        state: current.state,
      });
    }
    if (req.method === 'PUT') {
      if (!sameOriginWrite(req)) return sendJson(res, 403, { error: 'Requête refusée : origine non vérifiée.' });
      const body = await readJsonBody(req, ETAT_BODY_MAX);
      if (!body || typeof body !== 'object') return sendJson(res, 400, { error: 'Corps attendu : { baseVersion, state }.' });
      const saved = etat.write(body.baseVersion, body.state, by);
      console.log(`État enregistré (version ${saved.version}) par « ${by} »`);
      return sendJson(res, 200, saved);
    }
    return sendJson(res, 405, { error: 'Méthode non prise en charge.' });
  } catch (err) {
    if (err instanceof EtatError) {
      const payload = { error: err.message };
      if (err.currentVersion !== undefined) payload.version = err.currentVersion;
      return sendJson(res, err.status, payload);
    }
    if (err instanceof RightsError) return sendJson(res, err.status, { error: err.message });
    console.error('État :', err);
    return sendJson(res, 500, { error: 'Erreur serveur sur l’état budgétaire.' });
  }
}

async function handleApi(req, res, url, auth) {
  if (auth.method === 'none') return sendJson(res, 404, { error: 'Droits centralisés inactifs : le site est ouvert sans authentification.' });
  const own = rightsOf(auth);
  const rest = url.pathname.slice(API_PREFIX.length);
  try {
    if (rest === '/moi' && req.method === 'GET') {
      return sendJson(res, 200, {
        method: auth.method, account: auth.account, displayName: auth.displayName || '', rights: own,
      });
    }
    if (!own || own.isAdmin !== true) return sendJson(res, 403, { error: 'Réservé aux administrateurs des droits.' });

    if (rest === '' && req.method === 'GET') {
      let members = [];
      let membersError = null;
      if (ldapConfig && ldapConfig.groupDn) {
        try {
          members = await ldapListGroupMembers(ldapConfig);
        } catch (err) {
          if (!(err instanceof LdapUnavailableError)) throw err;
          membersError = err.message;
        }
      }
      return sendJson(res, 200, Object.assign(rights.all(), {
        groupDn: ldapConfig ? ldapConfig.groupDn : '', members: members, membersError: membersError,
      }));
    }

    let requested = '';
    try {
      requested = decodeURIComponent(rest.replace(/^\//, ''));
    } catch (e) {
      return sendJson(res, 400, { error: 'Identifiant invalide.' });
    }
    const account = normalizeAccount(requested);
    if (!rest.startsWith('/') || !account || rest.slice(1).includes('/')) return sendJson(res, 404, { error: 'Introuvable.' });
    if (!sameOriginWrite(req)) return sendJson(res, 403, { error: 'Requête refusée : origine non vérifiée.' });
    const by = auth.account || auth.username || '?';
    if (req.method === 'PUT') {
      const saved = rights.set(account, await readJsonBody(req), by);
      console.log(`Droits enregistrés pour « ${account} » par « ${by} »`);
      return sendJson(res, 200, { account: account, rights: saved });
    }
    if (req.method === 'DELETE') {
      const removed = rights.remove(account, by);
      if (removed) console.log(`Accès retiré à « ${account} » par « ${by} »`);
      return sendJson(res, 200, { account: account, removed: removed });
    }
    return sendJson(res, 405, { error: 'Méthode non prise en charge.' });
  } catch (err) {
    if (err instanceof RightsError) return sendJson(res, err.status, { error: err.message });
    console.error('Droits :', err);
    return sendJson(res, 500, { error: 'Erreur serveur sur les droits.' });
  }
}

const baseHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

async function handle(req, res) {
  for (const [k, v] of Object.entries(baseHeaders)) res.setHeader(k, v);
  const url = new URL(req.url, `http://${req.headers.host || PUBLIC_HOST}`);

  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end('ok\n');
  }

  const apiRights = url.pathname === API_PREFIX || url.pathname.startsWith(API_PREFIX + '/');
  const apiEtat = url.pathname === API_ETAT || url.pathname.startsWith(API_ETAT + '/');
  const api = apiRights || apiEtat;
  if (req.method !== 'GET' && req.method !== 'HEAD' && !(api && (req.method === 'PUT' || req.method === 'DELETE'))) {
    res.writeHead(405, { Allow: api ? 'GET, PUT, DELETE' : 'GET, HEAD' });
    return res.end();
  }

  const auth = await authenticate(req);
  const denied = auth.status;
  if (denied) {
    const headers = { 'Content-Type': 'text/plain; charset=utf-8' };
    if (denied === 401) headers['WWW-Authenticate'] = 'Basic realm="Budget Manager", charset="UTF-8"';
    if (denied === 429) headers['Retry-After'] = String(FAILURE_WINDOW_MS / 1000);
    res.writeHead(denied, headers);
    return res.end(DENIED[denied]);
  }

  if (apiEtat) return handleEtat(req, res, url, auth);
  if (apiRights) return handleApi(req, res, url, auth);

  if (url.pathname === '/budget-app.html') {
    res.writeHead(301, { Location: '/' });
    return res.end();
  }
  if (url.pathname !== '/' && url.pathname !== '/index.html') {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Introuvable\n');
  }

  let app;
  try {
    app = loadApp();
  } catch (err) {
    console.error('Lecture de budget-app.html impossible :', err);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Erreur serveur\n');
  }

  const headers = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache',
    ETag: app.etag,
    'Last-Modified': app.lastModified,
    Vary: 'Accept-Encoding',
    // Aussi sur un 304 : la page reste en cache, mais l'identité change.
    'Set-Cookie': authInfoCookie(req, auth),
  };
  if (req.headers['if-none-match'] === app.etag) {
    res.writeHead(304, headers);
    return res.end();
  }

  const accept = String(req.headers['accept-encoding'] || '');
  let body = app.raw;
  if (/\bbr\b/.test(accept)) {
    body = app.br;
    headers['Content-Encoding'] = 'br';
  } else if (/\bgzip\b/.test(accept)) {
    body = app.gzip;
    headers['Content-Encoding'] = 'gzip';
  }
  headers['Content-Length'] = body.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

const server = createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error('Erreur de traitement :', err);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Erreur serveur\n');
  });
});

loadApp();
server.listen(PORT, HOST, () => {
  console.log(`Budget Manager en écoute sur http://${HOST}:${PORT}`);
  console.log(`URL publique : https://${PUBLIC_HOST}`);
  console.log('Authentification Basic : ' + (authEnabled ? 'activée' : 'désactivée'));
  console.log('  compte local : ' + (localAuthEnabled ? 'oui' : 'non'));
  console.log('  annuaire LDAP : ' + (ldapConfig ? describeLdapConfig(ldapConfig) : 'non'));
  console.log('Droits : ' + RIGHTS_FILE + ' ; administrateurs désignés : ' + (RIGHTS_ADMINS.join(', ') || 'aucun'));
  // Version annoncée au démarrage : un fichier illisible doit se voir dans
  // le journal du conteneur, pas seulement au premier enregistrement.
  let etatVersion;
  try {
    etatVersion = 'version ' + etat.version();
  } catch (err) {
    etatVersion = 'ILLISIBLE — ' + err.message;
  }
  console.log('État budgétaire partagé : ' + ETAT_FILE + ' (' + etatVersion + ')');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
