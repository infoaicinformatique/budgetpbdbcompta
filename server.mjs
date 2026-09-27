/**
 * Serveur de production de Budget Manager.
 *
 * Sert uniquement `budget-app.html` (l'application tient dans ce fichier) :
 * aucun autre fichier du dépôt n'est exposé — ni le document de reprise,
 * ni le plan comptable Excel, ni les scripts.
 *
 * Aucune dépendance : Node ≥ 22 suffit.
 *
 * Variables d'environnement :
 *   HOST                 adresse d'écoute (défaut 127.0.0.1, derrière le reverse proxy)
 *   PORT                 port d'écoute (défaut 3000)
 *   PUBLIC_HOST          nom de domaine public (défaut budgetpbdbcompta.aic-informatique.net)
 *   BASIC_AUTH_USER      } si les deux sont renseignés, l'accès demande
 *   BASIC_AUTH_PASSWORD  } un identifiant et un mot de passe
 */
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { gzipSync, brotliCompressSync, constants as zlib } from 'node:zlib';
import { createHash, timingSafeEqual } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_HOST = process.env.PUBLIC_HOST || 'budgetpbdbcompta.aic-informatique.net';
const AUTH_USER = process.env.BASIC_AUTH_USER || '';
const AUTH_PASSWORD = process.env.BASIC_AUTH_PASSWORD || '';
const authEnabled = AUTH_USER !== '' && AUTH_PASSWORD !== '';

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

const expectedAuth = authEnabled
  ? Buffer.from('Basic ' + Buffer.from(`${AUTH_USER}:${AUTH_PASSWORD}`).toString('base64'))
  : null;
function authorized(req) {
  if (!authEnabled) return true;
  const given = Buffer.from(req.headers.authorization || '');
  return given.length === expectedAuth.length && timingSafeEqual(given, expectedAuth);
}

const baseHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

const server = createServer((req, res) => {
  for (const [k, v] of Object.entries(baseHeaders)) res.setHeader(k, v);
  const url = new URL(req.url, `http://${req.headers.host || PUBLIC_HOST}`);

  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end('ok\n');
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end();
  }

  if (!authorized(req)) {
    res.writeHead(401, {
      'WWW-Authenticate': 'Basic realm="Budget Manager", charset="UTF-8"',
      'Content-Type': 'text/plain; charset=utf-8',
    });
    return res.end('Authentification requise\n');
  }

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
});

loadApp();
server.listen(PORT, HOST, () => {
  console.log(`Budget Manager en écoute sur http://${HOST}:${PORT}`);
  console.log(`URL publique : https://${PUBLIC_HOST}`);
  console.log(authEnabled ? 'Authentification Basic : activée' : 'Authentification Basic : désactivée');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
