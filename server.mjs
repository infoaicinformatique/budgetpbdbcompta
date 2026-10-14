/**
 * Serveur de production de Budget Manager.
 *
 * Sert uniquement `budget-app.html` (l'application tient dans ce fichier) :
 * aucun autre fichier du dépôt n'est exposé — ni le document de reprise,
 * ni le plan comptable Excel, ni les scripts. Autres adresses :
 * `/api/droits`, les droits des personnes de l'annuaire (voir rights.mjs),
 * et `/api/donnees`, les sociétés et budgets, filtrés par ces droits
 * (voir data.mjs).
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
 *   DATA_FILE            fichier des données budgétaires (défaut ./data/budget.json ;
 *                        historique dans le dossier `historique/` à côté)
 *   PREFERENCES_FILE     préférences d'affichage de chaque personne (défaut
 *                        ./data/preferences.json) : ordre des sociétés de l'accueil
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
import { createRightsStore, parseAdminList, normalizeAccount, normalizeRoleId, RightsError } from './rights.mjs';
import { createDataStore, declarationOf, DataError } from './data.mjs';
import { createPresenceStore, PRESENCE_TTL_MS } from './presence.mjs';
import { createPreferencesStore, PreferencesError } from './preferences.mjs';

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

const DATA_FILE = process.env.DATA_FILE || join(root, 'data', 'budget.json');
const dataStore = createDataStore(DATA_FILE);
const PREFERENCES_FILE = process.env.PREFERENCES_FILE || join(root, 'data', 'preferences.json');
const preferences = createPreferencesStore(PREFERENCES_FILE);
/* Qui a la main sur quelle société — en mémoire, voir presence.mjs. */
const presence = createPresenceStore();

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
const ldapCache = new Map(); // condensat de l'en-tête → { expires, username, account, displayName, mail, dn }

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
 * `{ status, method, username, account, displayName, mail, dn }` : `status` est
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
      displayName: cached.displayName, mail: cached.mail, dn: cached.dn,
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
    username: credentials.username, account: entry.account, displayName: entry.displayName,
    mail: entry.mail || '', dn: entry.dn,
  };
  ldapCache.set(key, Object.assign({ expires: Date.now() + LDAP_CACHE_MS }, identity));
  console.log(`Connexion LDAP : « ${credentials.username} » (${entry.dn}) depuis ${address}`);
  return Object.assign({ status: 0, method: 'ldap' }, identity);
}

// Rubrique LDAP de Paramètres. L'application s'interdit tout appel réseau
// (CSP `connect-src 'none'`) : c'est donc la page elle-même qui apporte ces
// informations, dans un cookie lisible par le script — et non dans le HTML,
// qui resterait sinon à recompresser à chaque requête. Rien de secret : qui
// est connecté (avec l'adresse de courrier que porte l'annuaire, pour que
// Paramètres puisse la montrer), par quelle voie, et la configuration
// publique de l'annuaire (jamais le compte de service ni un mot de passe).
const AUTH_INFO_COOKIE = 'bm-auth';
const ldapPublicInfo = ldapConfig ? publicLdapInfo(ldapConfig) : null;

function authInfoCookie(req, auth) {
  const info = {
    v: 1,
    method: auth.method,
    username: auth.account || auth.username || '',
    displayName: auth.displayName || '',
    mail: auth.mail || '',
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

/* ---------------- Déconnexion ----------------

   L'authentification Basic n'a pas de déconnexion : le navigateur garde
   l'identifiant et le mot de passe et les renvoie seul. Le seul moyen de
   les lui faire oublier est de répondre 401 à une requête qui les porte —
   il les retire alors de sa mémoire et redemande. `/deconnexion` fait
   exactement cela, une fois : le cookie `bm-deco` marque la déconnexion en
   cours, pour que les identifiants saisis dans la fenêtre qui suit soient
   acceptés (sinon la fenêtre reviendrait en boucle). */
const LOGOUT_COOKIE = 'bm-deco';
const LOGOUT_PAGE = '<!doctype html><html lang="fr"><head><meta charset="utf-8" />' +
  '<meta name="viewport" content="width=device-width, initial-scale=1" /><title>Déconnecté — Budget Manager</title>' +
  '<style>body{font-family:system-ui,sans-serif;background:#f6f3ec;color:#2d3320;display:grid;place-items:center;' +
  'min-height:100vh;margin:0}main{background:#fff;border-radius:12px;padding:32px 40px;box-shadow:0 2px 12px #0001;' +
  'max-width:420px;text-align:center}a{color:#2d3320;font-weight:600}</style></head><body><main>' +
  '<h1 style="font-size:20px">Vous êtes déconnecté(e)</h1>' +
  '<p>Vous pouvez fermer cet onglet, ou vous reconnecter avec un autre compte.</p>' +
  '<p><a href="/">Se reconnecter</a></p></main></body></html>';

function hasLogoutCookie(req) {
  return new RegExp('(?:^|;\\s*)' + LOGOUT_COOKIE + '=1(?:;|$)').test(String(req.headers.cookie || ''));
}

async function handleLogout(req, res) {
  const header = String(req.headers.authorization || '');
  if (header && hasLogoutCookie(req)) {
    // Identifiants saisis dans la fenêtre qui a suivi la déconnexion : si
    // ce sont de bons identifiants, on rentre.
    const auth = await authenticate(req);
    if (auth.status === 0) {
      res.writeHead(303, { Location: '/', 'Set-Cookie': LOGOUT_COOKIE + '=; Path=/; Max-Age=0; SameSite=Strict' });
      return res.end();
    }
  }
  // Une connexion LDAP mémorisée ne doit pas survivre à la déconnexion.
  if (header) ldapCache.delete(createHash('sha256').update(header).digest('base64url'));
  res.writeHead(401, {
    'WWW-Authenticate': 'Basic realm="Budget Manager", charset="UTF-8"',
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Set-Cookie': LOGOUT_COOKIE + '=1; Path=/; Max-Age=120; SameSite=Strict; HttpOnly',
  });
  return res.end(req.method === 'HEAD' ? undefined : LOGOUT_PAGE);
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
   PUT    /api/droits/roles/<id> crée ou modifie un rôle personnalisé (administrateurs)
   DELETE /api/droits/roles/<id> supprime un rôle personnalisé (administrateurs)

   `/moi` et `/api/droits` rendent aussi `roles`, les rôles personnalisés :
   leur nom s'affiche à chacun dans Paramètres.

   Administrateur : fiche marquée `isAdmin`, compte de RIGHTS_ADMINS, ou le
   compte local de secours (qui doit pouvoir tout rattraper si l'annuaire
   ou le fichier des droits fait défaut). */
const API_PREFIX = '/api/droits';
const API_BODY_MAX = 64 * 1024;

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

function readJsonBody(req, max = API_BODY_MAX) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    let size = 0;
    req.on('data', function (chunk) {
      size += chunk.length;
      if (size > max) {
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

async function handleApi(req, res, url, auth) {
  if (auth.method === 'none') return sendJson(res, 404, { error: 'Droits centralisés inactifs : le site est ouvert sans authentification.' });
  const own = rightsOf(auth);
  const rest = url.pathname.slice(API_PREFIX.length);
  try {
    if (rest === '/moi' && req.method === 'GET') {
      return sendJson(res, 200, {
        method: auth.method, account: auth.account, displayName: auth.displayName || '',
        mail: auth.mail || '', rights: own, roles: rights.roles(),
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

    const roleMatch = /^\/roles\/([^/]+)$/.exec(rest);
    if (roleMatch) {
      const roleId = normalizeRoleId(roleMatch[1]);
      if (!roleId) return sendJson(res, 404, { error: 'Introuvable.' });
      if (!sameOriginWrite(req)) return sendJson(res, 403, { error: 'Requête refusée : origine non vérifiée.' });
      const by = auth.account || auth.username || '?';
      if (req.method === 'PUT') {
        const saved = rights.setRole(roleId, await readJsonBody(req), by);
        console.log(`Rôle « ${saved.label} » enregistré par « ${by} »`);
        return sendJson(res, 200, { id: roleId, role: saved });
      }
      if (req.method === 'DELETE') {
        const result = rights.removeRole(roleId, by);
        if (result.removed) console.log(`Rôle « ${roleId} » supprimé par « ${by} »`);
        return sendJson(res, 200, Object.assign({ id: roleId }, result));
      }
      return sendJson(res, 405, { error: 'Méthode non prise en charge.' });
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

/* ---------------- /api/donnees ----------------

   GET  /api/donnees            sociétés et budgets de mon périmètre (+ révision)
   GET  /api/donnees/revision   numéro de la dernière révision (relecture légère)
   PUT  /api/donnees            { baseRevision, state, changedCompanies, sharedChanged } :
                                enregistre ce que j'ai modifié (déclaré), dans mon périmètre
   POST /api/donnees/main       { company, release? } : qui a la main (presence.mjs)
   POST /api/donnees/soumission { company, action: 'submit' | 'reopen' } : soumet le budget
                                d'une société (droit de saisie) ou le rouvre (administrateur) ;
                                un budget soumis refuse ensuite toute écriture (409)

   Le filtrage et les règles d'écriture sont dans data.mjs. Une personne
   sans fiche ne reçoit aucune société et ne peut rien écrire. */
const DATA_PREFIX = '/api/donnees';
const DATA_BODY_MAX = 32 * 1024 * 1024;

/** Réponse JSON, compressée en gzip au-delà de quelques Ko si le navigateur l'accepte. */
function sendDataJson(req, res, status, body) {
  const raw = Buffer.from(JSON.stringify(body));
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Accept-Encoding' };
  if (raw.length > 8192 && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) {
    headers['Content-Encoding'] = 'gzip';
    res.writeHead(status, headers);
    return res.end(gzipSync(raw));
  }
  res.writeHead(status, headers);
  return res.end(raw);
}

async function handleDataApi(req, res, url, auth) {
  if (auth.method === 'none') return sendJson(res, 404, { error: 'Données centralisées inactives : le site est ouvert sans authentification.' });
  const own = rightsOf(auth);
  const by = auth.account || auth.username || '?';
  try {
    if (url.pathname === DATA_PREFIX + '/revision' && req.method === 'GET') {
      return sendJson(res, 200, { revision: dataStore.revision() });
    }
    /* Qui a la main sur une société (presence.mjs). Le navigateur appelle
       ce chemin en arrivant sur une société puis par battement de cœur :
       la première personne l'obtient, les suivantes apprennent qui l'a. */
    if (url.pathname === DATA_PREFIX + '/main' && req.method === 'POST') {
      if (!sameOriginWrite(req)) return sendJson(res, 403, { error: 'Requête refusée : origine non vérifiée.' });
      if (!own) return sendJson(res, 403, { error: 'Aucun droit enregistré pour ce compte.' });
      const body = await readJsonBody(req);
      const companyId = body && typeof body.company === 'string' ? body.company : '';
      const name = auth.displayName || auth.account || by;
      if (body && body.release === true) {
        presence.release(by, companyId || undefined);
        return sendJson(res, 200, { company: companyId, holder: null, mine: false, ttlMs: PRESENCE_TTL_MS });
      }
      // Une société hors périmètre ne donne droit à aucune main : sans ce
      // garde-fou, on pourrait bloquer le budget d'un établissement qu'on
      // n'a même pas le droit de lire.
      //
      // Contrôle fait sur la seule fiche de droits, pas sur `scopeOf` : ce
      // chemin est appelé par battement de cœur, et `scopeOf` demande
      // l'état complet (environnements → groupes → sociétés), donc une
      // lecture et un parsing du fichier de 2 Mo à chaque battement de
      // chaque poste. La liste `allowedCompanies` borne déjà le périmètre
      // réel (`scopeOf` n'en garde qu'un sous-ensemble) : la refuser ici ne
      // peut donc jamais refuser à tort. Une fiche sans cette liste — les
      // contrôleurs — n'est pas restreinte de ce côté, et leur périmètre de
      // lecture est de toute façon large.
      const allowed = Array.isArray(own.allowedCompanies) ? new Set(own.allowedCompanies) : null;
      if (companyId && allowed && !allowed.has(companyId)) {
        return sendJson(res, 403, { error: 'Société hors de votre périmètre.' });
      }
      const claimed = presence.claim(by, name, companyId);
      return sendJson(res, 200, Object.assign({ company: companyId, ttlMs: PRESENCE_TTL_MS }, claimed));
    }
    /* Soumission du budget (14/10/2026) : le statut est tenu par le
       serveur seul (data.mjs, `setSubmission`) ; un envoi ordinaire ne peut
       ni soumettre ni rouvrir. */
    if (url.pathname === DATA_PREFIX + '/soumission' && req.method === 'POST') {
      if (!sameOriginWrite(req)) return sendJson(res, 403, { error: 'Requête refusée : origine non vérifiée.' });
      if (!own) return sendJson(res, 403, { error: 'Aucun droit enregistré pour ce compte.' });
      const body = await readJsonBody(req);
      const companyId = body && typeof body.company === 'string' ? body.company : '';
      const action = body && body.action === 'reopen' ? 'reopen' : body && body.action === 'submit' ? 'submit' : '';
      const result = dataStore.setSubmission(own, companyId, action, { account: by, name: auth.displayName || by });
      console.log(`Budget ${action === 'submit' ? 'soumis' : 'rouvert'} par « ${by} » : ${companyId} (révision ${result.revision})`);
      return sendJson(res, 200, result);
    }
    if (url.pathname !== DATA_PREFIX) return sendJson(res, 404, { error: 'Introuvable.' });
    if (req.method === 'GET') return sendDataJson(req, res, 200, dataStore.read(own));
    if (req.method !== 'PUT') return sendJson(res, 405, { error: 'Méthode non prise en charge.' });
    if (!sameOriginWrite(req)) return sendJson(res, 403, { error: 'Requête refusée : origine non vérifiée.' });
    const body = await readJsonBody(req, DATA_BODY_MAX);
    /* La main avant la révision : une société tenue par quelqu'un d'autre
       ne s'écrit pas, même si la révision de départ est à jour. C'est ce
       qui rend vraie la phrase affichée au navigateur (« X a la main,
       modifications impossibles ») — sans ce refus, elle ne serait qu'un
       avertissement que la première frappe démentirait. */
    const declared = declarationOf(body);
    const refusal = declared ? presence.refusalFor(by, declared.companies, body && body.state) : null;
    if (refusal) return sendJson(res, 409, refusal);
    const result = dataStore.write(own, body && body.baseRevision, body && body.state, by, declared);
    if (result.changedCompanies.length || result.sharedChanged) {
      console.log(`Données enregistrées par « ${by} » (révision ${result.revision}, ${result.changedCompanies.length} société(s)${result.sharedChanged ? ', réglages communs' : ''})`);
    }
    return sendJson(res, 200, result);
  } catch (err) {
    if (err instanceof DataError) return sendJson(res, err.status, Object.assign({ error: err.message }, err.extra || {}));
    if (err instanceof RightsError) return sendJson(res, err.status, { error: err.message });
    console.error('Données :', err);
    return sendJson(res, 500, { error: 'Erreur serveur sur les données.' });
  }
}

/* ---------------- /api/preferences ----------------

   GET  /api/preferences   mes préférences d'affichage ({ companyOrder })
   PUT  /api/preferences   les remplace

   Pas d'identifiant dans le chemin : chacun ne lit et n'écrit que les
   siennes, sous l'identité vérifiée par l'authentification. Aucune fiche de
   droits n'est exigée — ranger ses cartes ne donne accès à rien, et
   l'application croise toujours l'ordre avec le périmètre. */
const PREFERENCES_PATH = '/api/preferences';

async function handlePreferencesApi(req, res, url, auth) {
  if (auth.method === 'none') return sendJson(res, 404, { error: 'Préférences centralisées inactives : le site est ouvert sans authentification.' });
  if (url.pathname !== PREFERENCES_PATH) return sendJson(res, 404, { error: 'Introuvable.' });
  const account = normalizeAccount(auth.account || auth.username);
  if (!account) return sendJson(res, 403, { error: 'Identité non reconnue.' });
  try {
    if (req.method === 'GET') return sendJson(res, 200, preferences.get(account));
    if (req.method !== 'PUT') return sendJson(res, 405, { error: 'Méthode non prise en charge.' });
    if (!sameOriginWrite(req)) return sendJson(res, 403, { error: 'Requête refusée : origine non vérifiée.' });
    return sendJson(res, 200, preferences.set(account, await readJsonBody(req)));
  } catch (err) {
    if (err instanceof PreferencesError || err instanceof RightsError) return sendJson(res, err.status, { error: err.message });
    console.error('Préférences :', err);
    return sendJson(res, 500, { error: 'Erreur serveur sur les préférences.' });
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

  if (url.pathname === '/deconnexion' && (req.method === 'GET' || req.method === 'HEAD')) {
    return handleLogout(req, res);
  }

  const api = url.pathname === API_PREFIX || url.pathname.startsWith(API_PREFIX + '/');
  const dataApi = url.pathname === DATA_PREFIX || url.pathname.startsWith(DATA_PREFIX + '/');
  const preferencesApi = url.pathname === PREFERENCES_PATH;
  // POST n'est admis que sur les données, pour `/api/donnees/main` (qui a
  // la main sur une société, voir presence.mjs) : prendre la main n'est pas
  // une écriture du budget, et un PUT sur une ressource sans corps à
  // remplacer n'aurait pas le bon sens.
  if (req.method !== 'GET' && req.method !== 'HEAD' &&
    !(api && (req.method === 'PUT' || req.method === 'DELETE')) &&
    !(dataApi && (req.method === 'PUT' || req.method === 'POST')) &&
    !(preferencesApi && req.method === 'PUT')) {
    res.writeHead(405, { Allow: api ? 'GET, PUT, DELETE' : dataApi ? 'GET, PUT, POST' : preferencesApi ? 'GET, PUT' : 'GET, HEAD' });
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

  if (api) return handleApi(req, res, url, auth);
  if (dataApi) return handleDataApi(req, res, url, auth);
  if (preferencesApi) return handlePreferencesApi(req, res, url, auth);

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
    // Une déconnexion restée en suspens (fenêtre fermée) est oubliée : sans
    // cela, la prochaine déconnexion ramènerait tout droit sur le site.
    'Set-Cookie': [authInfoCookie(req, auth)].concat(hasLogoutCookie(req)
      ? [LOGOUT_COOKIE + '=; Path=/; Max-Age=0; SameSite=Strict'] : []),
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
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
