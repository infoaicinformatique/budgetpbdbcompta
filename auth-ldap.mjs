/**
 * Authentification par annuaire LDAP (Active Directory, OpenLDAP…).
 *
 * Le navigateur ne parle pas LDAP : c'est le serveur qui vérifie
 * l'identifiant et le mot de passe saisis dans la fenêtre d'authentification
 * Basic, en ouvrant une session (« bind ») sur l'annuaire au nom de
 * l'utilisateur. Rien n'est stocké : ni mot de passe, ni compte.
 *
 * Deux façons de trouver l'utilisateur dans l'annuaire :
 *
 *   - bind direct (LDAP_USER_DN) : le DN est construit à partir d'un modèle,
 *     `uid={username},ou=people,dc=exemple,dc=fr` ou, pour Active Directory,
 *     `{username}@exemple.local` ;
 *   - recherche puis bind (LDAP_SEARCH_BASE) : on cherche l'entrée avec
 *     LDAP_SEARCH_FILTER, éventuellement au nom d'un compte de service
 *     (LDAP_BIND_DN / LDAP_BIND_PASSWORD), puis on se connecte avec son DN.
 *
 * LDAP_GROUP_DN, facultatif, réserve l'accès aux membres d'un groupe.
 *
 * Aucune donnée venue de la requête n'entre dans un DN ou un filtre sans
 * contrôle : le nom d'utilisateur est limité à un jeu de caractères sûr, et
 * les valeurs placées dans un filtre sont en plus échappées (RFC 4515).
 */
import { readFileSync } from 'node:fs';
import { Client, InvalidCredentialsError } from 'ldapts';

/** Lettres, chiffres, point, tiret, souligné, arobase : rien qui ait un sens en DN ou en filtre. */
const USERNAME_PATTERN = /^[A-Za-z0-9._@-]{1,64}$/;

/** Échappe une valeur placée dans un filtre LDAP (RFC 4515). */
export function escapeFilterValue(value) {
  return String(value).replace(/[\\*()\0]/g, function (c) {
    return '\\' + c.charCodeAt(0).toString(16).padStart(2, '0');
  });
}

function fill(template, username) {
  return template.split('{username}').join(username);
}

function truthy(value) {
  return /^(1|true|oui|yes)$/i.test(String(value || '').trim());
}

/**
 * Lit la configuration dans les variables d'environnement. Renvoie `null`
 * si LDAP_URL est vide (LDAP désactivé), lève une erreur si la
 * configuration est incomplète — le serveur refuse alors de démarrer
 * plutôt que de s'ouvrir sans contrôle.
 */
export function ldapConfigFromEnv(env) {
  const urls = String(env.LDAP_URL || '').split(/[\s,]+/).filter(Boolean);
  if (!urls.length) return null;
  for (const url of urls) {
    if (!/^ldaps?:\/\/[^/]+\/?$/i.test(url)) {
      throw new Error('LDAP_URL invalide : « ' + url + ' » (attendu ldap://hôte:389 ou ldaps://hôte:636).');
    }
  }
  const config = {
    urls: urls,
    userDn: String(env.LDAP_USER_DN || '').trim(),
    bindDn: String(env.LDAP_BIND_DN || '').trim(),
    bindPassword: env.LDAP_BIND_PASSWORD || '',
    searchBase: String(env.LDAP_SEARCH_BASE || '').trim(),
    searchFilter: String(env.LDAP_SEARCH_FILTER || '').trim()
      || '(|(uid={username})(sAMAccountName={username})(userPrincipalName={username}))',
    groupDn: String(env.LDAP_GROUP_DN || '').trim(),
    startTls: truthy(env.LDAP_STARTTLS),
    tlsOptions: { rejectUnauthorized: !/^(0|false|non|no)$/i.test(String(env.LDAP_TLS_REJECT_UNAUTHORIZED || '').trim()) },
    timeoutMs: Number(env.LDAP_TIMEOUT_MS) || 5000,
  };
  if (env.LDAP_CA_FILE) config.tlsOptions.ca = [readFileSync(env.LDAP_CA_FILE)];

  if (!config.userDn && !config.searchBase) {
    throw new Error('LDAP : renseigner LDAP_USER_DN (bind direct) ou LDAP_SEARCH_BASE (recherche).');
  }
  if (config.userDn && config.searchBase) {
    throw new Error('LDAP : LDAP_USER_DN et LDAP_SEARCH_BASE sont exclusifs, n’en garder qu’un.');
  }
  if (config.userDn && !config.userDn.includes('{username}')) {
    throw new Error('LDAP_USER_DN doit contenir {username}.');
  }
  if (!config.searchFilter.includes('{username}')) {
    throw new Error('LDAP_SEARCH_FILTER doit contenir {username}.');
  }
  if (config.bindDn && !config.bindPassword) {
    throw new Error('LDAP_BIND_DN est renseigné sans LDAP_BIND_PASSWORD.');
  }
  // Le contrôle de groupe compare le DN de l'utilisateur aux membres du
  // groupe : il faut un vrai DN, pas une adresse user@domaine.
  if (config.groupDn && config.userDn && !config.userDn.includes('=')) {
    throw new Error('LDAP_GROUP_DN demande un DN complet : utiliser LDAP_SEARCH_BASE plutôt qu’un LDAP_USER_DN de la forme user@domaine.');
  }
  return config;
}

/** Description courte, sans secret, pour le journal de démarrage. */
export function describeLdapConfig(config) {
  const mode = config.userDn ? 'bind direct (' + config.userDn + ')' : 'recherche dans ' + config.searchBase;
  return config.urls.join(', ') + (config.startTls ? ' + StartTLS' : '') + ', ' + mode
    + (config.groupDn ? ', groupe ' + config.groupDn : '');
}

/**
 * Ce que l'écran Paramètres de l'application peut afficher de la
 * configuration : serveurs, chiffrement, périmètre de recherche, groupe.
 * Jamais le compte de service ni son mot de passe.
 *
 * `encryption` : `ldaps` si toutes les URL sont en ldaps://, `starttls` si
 * StartTLS est demandé, `partiel` si seules certaines URL sont chiffrées,
 * `aucun` sinon (mots de passe en clair entre le serveur et l'annuaire).
 */
export function publicLdapInfo(config) {
  const secured = config.urls.filter(function (url) { return /^ldaps:/i.test(url); }).length;
  let encryption = 'aucun';
  if (config.startTls) encryption = 'starttls';
  else if (secured === config.urls.length) encryption = 'ldaps';
  else if (secured > 0) encryption = 'partiel';
  return {
    urls: config.urls.slice(),
    encryption: encryption,
    mode: config.userDn ? 'direct' : 'recherche',
    base: config.userDn || config.searchBase,
    group: config.groupDn,
  };
}

/** Erreur d'annuaire (injoignable, compte de service refusé…) : ce n'est pas un mauvais mot de passe. */
export class LdapUnavailableError extends Error {}

/**
 * Vérifie un couple identifiant / mot de passe. Renvoie le DN de
 * l'utilisateur s'il est accepté, `null` s'il est refusé ; lève
 * `LdapUnavailableError` si l'annuaire ne répond pas correctement.
 *
 * `ClientClass` n'est paramétrable que pour les tests.
 */
export async function ldapAuthenticate(config, username, password, ClientClass) {
  const entry = await ldapAuthenticateEntry(config, username, password, ClientClass);
  return entry ? entry.dn : null;
}

/**
 * Comme `ldapAuthenticate`, mais renvoie l'entrée : `{ dn, account,
 * displayName, mail }`. `account` est l'identifiant CANONIQUE de la personne
 * (sAMAccountName, sinon uid, sinon l'identifiant saisi sans son
 * « @domaine »), en minuscules : c'est la clé de ses droits dans
 * l'application, qu'elle se connecte en « prenom.nom » ou avec son UPN.
 */
export async function ldapAuthenticateEntry(config, username, password, ClientClass) {
  // Mot de passe vide : un bind LDAP sans mot de passe est un bind ANONYME,
  // que beaucoup d'annuaires acceptent — il ne doit jamais valoir connexion.
  if (typeof password !== 'string' || password === '') return null;
  if (typeof username !== 'string' || !USERNAME_PATTERN.test(username)) return null;
  return withDirectory(config, ClientClass, function (client) {
    return checkOnServer(client, config, username, password);
  });
}

/**
 * Membres du groupe LDAP_GROUP_DN : `[{ dn, account, displayName, mail }]`, triés
 * par nom affiché. Sert à l'écran des droits de l'application, pour que
 * l'administrateur voie qui peut entrer sans connaître l'annuaire. Lu au
 * nom du compte de service ; `[]` sans groupe configuré.
 */
export async function ldapListGroupMembers(config, ClientClass) {
  if (!config.groupDn) return [];
  return withDirectory(config, ClientClass, async function (client) {
    await bindService(client, config);
    const { searchEntries } = await client.search(config.groupDn, {
      scope: 'base', filter: '(objectClass=*)', attributes: ['member', 'uniqueMember'],
    });
    if (!searchEntries.length) throw new LdapUnavailableError('groupe introuvable : ' + config.groupDn);
    const group = searchEntries[0];
    const dns = [].concat(attribute(group, 'member'), attribute(group, 'uniqueMember'));
    const members = [];
    for (const dn of dns) {
      let entry = null;
      try {
        const found = await client.search(dn, { scope: 'base', filter: '(objectClass=*)', attributes: ENTRY_ATTRIBUTES });
        entry = found.searchEntries[0] || null;
      } catch (err) {
        if (isConnectionError(err)) throw err;
        // Membre illisible (supprimé, hors de portée du compte de service) :
        // on le montre quand même, par son DN.
      }
      const account = entry ? accountOf(entry, '') : '';
      members.push({
        dn: dn, account: account,
        displayName: entry ? displayNameOf(entry) : '',
        mail: entry ? mailOf(entry) : '',
      });
    }
    return members.sort(function (a, b) {
      return (a.displayName || a.account || a.dn).localeCompare(b.displayName || b.account || b.dn, 'fr');
    });
  });
}

/**
 * Retrouve une personne de l'annuaire SANS mot de passe, au nom du compte de
 * service : d'abord par identifiant (filtre LDAP_SEARCH_FILTER), puis par
 * adresse de courrier. Sert en ExApp Nextcloud, où l'identité vient de
 * Nextcloud : son identifiant interne d'un utilisateur LDAP peut être un UUID
 * plutôt que le sAMAccountName qui sert de clé aux droits. Renvoie
 * `{ dn, account, displayName, mail }` ou `null` (inconnu, ou ambigu).
 */
export async function ldapFindEntry(config, login, mail, ClientClass) {
  if (!config.searchBase || !config.bindDn) return null;
  return withDirectory(config, ClientClass, async function (client) {
    await bindService(client, config);
    const filters = [];
    if (typeof login === 'string' && USERNAME_PATTERN.test(login)) {
      filters.push(fill(config.searchFilter, escapeFilterValue(login)));
    }
    if (typeof mail === 'string' && /^[^\s@]+@[^\s@]+$/.test(mail)) {
      const m = escapeFilterValue(mail);
      filters.push('(|(mail=' + m + ')(userPrincipalName=' + m + '))');
    }
    for (const filter of filters) {
      const { searchEntries } = await client.search(config.searchBase, {
        scope: 'sub', filter: filter, attributes: ENTRY_ATTRIBUTES, sizeLimit: 2,
      });
      // Plusieurs résultats : on refuse plutôt que de choisir au hasard.
      if (searchEntries.length === 1) {
        const entry = searchEntries[0];
        return { dn: entry.dn, account: accountOf(entry, ''), displayName: displayNameOf(entry), mail: mailOf(entry) };
      }
    }
    return null;
  });
}

/** Ouvre une connexion sur la première URL joignable et y exécute `fn(client)`. */
async function withDirectory(config, ClientClass, fn) {
  const LdapClient = ClientClass || Client;
  let lastError = null;
  // Plusieurs URL : on passe à la suivante seulement si la précédente est
  // injoignable. Une réponse de l'annuaire (même un refus) est définitive.
  for (const url of config.urls) {
    const client = new LdapClient({
      url: url,
      timeout: config.timeoutMs,
      connectTimeout: config.timeoutMs,
      // Seulement pour ldaps:// : ldapts ouvre une connexion TLS dès qu'il
      // reçoit des tlsOptions, même sur ldap:// — ce qui casserait le mode
      // en clair comme StartTLS (qui reçoit ses options à part).
      tlsOptions: /^ldaps:/i.test(url) ? config.tlsOptions : undefined,
    });
    try {
      if (config.startTls) await client.startTLS(config.tlsOptions);
      return await fn(client);
    } catch (err) {
      if (err instanceof LdapUnavailableError) throw err;
      if (!isConnectionError(err)) throw new LdapUnavailableError('Annuaire LDAP ' + url + ' : ' + err.message);
      lastError = err;
    } finally {
      try { await client.unbind(); } catch (e) { /* connexion déjà fermée */ }
    }
  }
  throw new LdapUnavailableError('Annuaire LDAP injoignable : ' + (lastError ? lastError.message : 'aucune URL'));
}

function isConnectionError(err) {
  const code = err && err.code;
  return ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)
    || /timeout|timed out|connect/i.test(String(err && err.message));
}

const ENTRY_ATTRIBUTES = ['sAMAccountName', 'uid', 'displayName', 'cn', 'mail'];

/** Une adresse plausible : on ne devine pas, on refuse ce qui n'en a pas la forme. */
const MAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Valeurs d'un attribut ldapts (absent, chaîne ou tableau), en chaînes. */
function values(value) {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]).map(String);
}

/** Attribut d'une entrée, quelle que soit la casse que l'annuaire lui donne. */
function attribute(entry, name) {
  if (!entry) return [];
  const wanted = name.toLowerCase();
  const key = Object.keys(entry).find(function (k) { return k.toLowerCase() === wanted; });
  return key ? values(entry[key]) : [];
}

/** Identifiant canonique d'une entrée, en minuscules (voir `ldapAuthenticateEntry`). */
function accountOf(entry, typed) {
  const found = attribute(entry, 'sAMAccountName')[0] || attribute(entry, 'uid')[0]
    || String(typed || '').split('@')[0];
  return found.trim().toLowerCase();
}

function displayNameOf(entry) {
  return (attribute(entry, 'displayName')[0] || attribute(entry, 'cn')[0] || '').trim();
}

/**
 * Adresse de courrier de l'entrée, en minuscules, `''` si l'annuaire n'en
 * porte pas. SEUL l'attribut `mail` est lu : le `userPrincipalName` d'un
 * Active Directory ressemble à une adresse (« prenom.nom@domaine ») sans en
 * être forcément une — s'en servir enverrait du courrier dans le vide.
 * L'adresse appartient à l'annuaire : l'application l'affiche, ne la
 * conserve pas et ne la modifie jamais.
 */
function mailOf(entry) {
  const found = attribute(entry, 'mail').map(function (v) { return v.trim().toLowerCase(); })
    .find(function (v) { return MAIL_PATTERN.test(v); });
  return found || '';
}

async function checkOnServer(client, config, username, password) {
  let userDn;
  let entry = null;
  if (config.userDn) {
    userDn = fill(config.userDn, username);
  } else {
    await bindService(client, config);
    const { searchEntries } = await client.search(config.searchBase, {
      scope: 'sub',
      filter: fill(config.searchFilter, escapeFilterValue(username)),
      attributes: ENTRY_ATTRIBUTES,
      sizeLimit: 2,
    });
    // Zéro résultat : inconnu. Plusieurs : filtre ambigu, on refuse plutôt
    // que de choisir au hasard entre deux personnes.
    if (searchEntries.length !== 1) return null;
    entry = searchEntries[0];
    userDn = entry.dn;
  }

  try {
    await client.bind(userDn, password);
  } catch (err) {
    if (err instanceof InvalidCredentialsError) return null;
    throw err;
  }

  if (config.groupDn) {
    // Lecture du groupe au nom du compte de service s'il existe, sinon au
    // nom de l'utilisateur qui vient de se connecter.
    if (config.bindDn) await bindService(client, config);
    const dn = escapeFilterValue(userDn);
    const { searchEntries } = await client.search(config.groupDn, {
      scope: 'base',
      filter: '(|(member=' + dn + ')(uniqueMember=' + dn + ')(memberUid=' + escapeFilterValue(username) + '))',
      attributes: ['dn'],
    });
    if (!searchEntries.length) return null;
  }
  return { dn: userDn, account: accountOf(entry, username), displayName: displayNameOf(entry), mail: mailOf(entry) };
}

async function bindService(client, config) {
  if (!config.bindDn) return; // recherche anonyme, si l'annuaire l'autorise
  try {
    await client.bind(config.bindDn, config.bindPassword);
  } catch (err) {
    // Annuaire injoignable : laisser passer, pour basculer sur l'URL suivante.
    if (isConnectionError(err)) throw err;
    // Le compte de service refusé est une panne de configuration, pas un
    // mauvais mot de passe de l'utilisateur.
    throw new LdapUnavailableError('compte de service LDAP refusé (' + err.message + ')');
  }
}
