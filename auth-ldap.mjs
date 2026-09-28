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
  const LdapClient = ClientClass || Client;
  // Mot de passe vide : un bind LDAP sans mot de passe est un bind ANONYME,
  // que beaucoup d'annuaires acceptent — il ne doit jamais valoir connexion.
  if (typeof password !== 'string' || password === '') return null;
  if (typeof username !== 'string' || !USERNAME_PATTERN.test(username)) return null;

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
      return await checkOnServer(client, config, username, password);
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

async function checkOnServer(client, config, username, password) {
  let userDn;
  if (config.userDn) {
    userDn = fill(config.userDn, username);
  } else {
    await bindService(client, config);
    const { searchEntries } = await client.search(config.searchBase, {
      scope: 'sub',
      filter: fill(config.searchFilter, escapeFilterValue(username)),
      attributes: ['dn'],
      sizeLimit: 2,
    });
    // Zéro résultat : inconnu. Plusieurs : filtre ambigu, on refuse plutôt
    // que de choisir au hasard entre deux personnes.
    if (searchEntries.length !== 1) return null;
    userDn = searchEntries[0].dn;
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
  return userDn;
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
