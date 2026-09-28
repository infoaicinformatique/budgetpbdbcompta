/**
 * Droits des personnes de l'annuaire dans l'application, tenus par le
 * serveur : un seul fichier JSON (RIGHTS_FILE), le même pour tous les
 * postes — contrairement aux comptes locaux de l'application, qui vivent
 * dans chaque navigateur.
 *
 * Une fiche par identifiant canonique (voir `ldapAuthenticateEntry`) :
 *
 *   { role, isAdmin, permissions, allowedCompanies, allowedCostCenters,
 *     environmentIds, updatedAt, updatedBy }
 *
 * Les champs ont la forme de ceux d'un compte de l'application
 * (`createUser` dans budget-app.html), pour que ses contrôles d'accès
 * s'appliquent tels quels. `permissions: null` = droits par défaut du rôle.
 *
 * Le serveur ne connaît pas le catalogue des onglets : il ne contrôle que
 * la FORME des droits. L'application ignore ce qui ne correspond à rien.
 *
 * Qui n'a pas de fiche n'a accès à rien — sauf les administrateurs
 * désignés par RIGHTS_ADMINS, qui ont toujours la main : sans eux, un
 * fichier perdu ou une erreur de manipulation fermerait la gestion des
 * droits pour de bon.
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const ROLES = ['controleur', 'directeur'];
const ID_PATTERN = /^[A-Za-z0-9_&.:-]{1,80}$/;
const ACCOUNT_PATTERN = /^[a-z0-9._@-]{1,64}$/;
const LOG_MAX = 200;

/** Erreur de saisie (400) ou de règle (409), distincte d'une panne. */
export class RightsError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status || 400;
  }
}

/** Identifiant canonique : minuscules, jeu de caractères sûr ; `''` si invalide. */
export function normalizeAccount(value) {
  const account = String(value || '').trim().toLowerCase();
  return ACCOUNT_PATTERN.test(account) ? account : '';
}

/** Liste RIGHTS_ADMINS (« a, b » ou « a b ») en identifiants canoniques. */
export function parseAdminList(value) {
  return String(value || '').split(/[\s,;]+/).map(normalizeAccount).filter(Boolean);
}

function idList(value, label) {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value) || value.length > 500) throw new RightsError(label + ' : liste attendue.');
  for (const id of value) {
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw new RightsError(label + ' : identifiant invalide.');
  }
  return Array.from(new Set(value));
}

/**
 * Contrôle et nettoie une fiche reçue de l'application. Lève `RightsError`
 * si la forme est fausse : rien d'inattendu n'entre dans le fichier.
 */
export function sanitizeRights(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RightsError('Fiche de droits attendue.');
  if (ROLES.indexOf(input.role) === -1) throw new RightsError('Rôle inconnu.');
  let permissions = null;
  if (input.permissions !== null && input.permissions !== undefined) {
    if (typeof input.permissions !== 'object' || Array.isArray(input.permissions)) {
      throw new RightsError('Droits d’accès : objet attendu.');
    }
    permissions = {};
    const tabs = Object.keys(input.permissions);
    if (tabs.length > 100) throw new RightsError('Droits d’accès : trop d’onglets.');
    for (const tab of tabs) {
      if (!ID_PATTERN.test(tab)) throw new RightsError('Droits d’accès : onglet invalide.');
      permissions[tab] = idList(input.permissions[tab], 'Rubriques de ' + tab) || [];
    }
  }
  return {
    role: input.role,
    isAdmin: input.isAdmin === true,
    permissions: permissions,
    allowedCompanies: idList(input.allowedCompanies, 'Sociétés'),
    allowedCostCenters: idList(input.allowedCostCenters, 'Centres de coûts'),
    environmentIds: idList(input.environmentIds, 'Environnements') || [],
  };
}

/**
 * Magasin des droits. `admins` : identifiants de RIGHTS_ADMINS. Le fichier
 * est relu à chaque lecture (quelques Ko) : une correction faite à la main
 * sur le serveur est prise en compte sans redémarrage.
 */
export function createRightsStore(filePath, admins) {
  const bootstrap = new Set(admins || []);

  function load() {
    let data;
    try {
      data = JSON.parse(readFileSync(filePath, 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return { version: 1, users: {}, log: [] };
      throw new Error('Fichier des droits illisible (' + filePath + ') : ' + err.message);
    }
    return {
      version: 1,
      users: data && typeof data.users === 'object' && data.users ? data.users : {},
      log: Array.isArray(data && data.log) ? data.log : [],
    };
  }

  function write(data) {
    mkdirSync(dirname(filePath), { recursive: true });
    // Écriture dans un fichier voisin puis renommage : un arrêt en plein
    // milieu laisse l'ancien fichier intact, jamais un fichier à moitié écrit.
    const tmp = filePath + '.tmp';
    writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
    renameSync(tmp, filePath);
  }

  function logChange(data, by, account, action) {
    data.log.unshift({ at: new Date().toISOString(), by: by, account: account, action: action });
    if (data.log.length > LOG_MAX) data.log.length = LOG_MAX;
  }

  /** Nombre d'administrateurs si l'on appliquait `account` → `isAdmin`. */
  function adminCountWith(data, account, isAdmin) {
    const set = new Set(bootstrap);
    for (const name of Object.keys(data.users)) if (data.users[name].isAdmin === true) set.add(name);
    if (isAdmin) set.add(account);
    else if (!bootstrap.has(account)) set.delete(account);
    return set.size;
  }

  return {
    /** La personne est-elle désignée administrateur par RIGHTS_ADMINS ? */
    isBootstrapAdmin(account) {
      return bootstrap.has(account);
    },

    /**
     * Droits effectifs : la fiche enregistrée, forcée administrateur pour
     * RIGHTS_ADMINS ; sans fiche, contrôleur de gestion complet pour
     * RIGHTS_ADMINS, `null` (aucun accès) pour les autres.
     */
    effective(account) {
      const stored = load().users[account] || null;
      if (bootstrap.has(account)) {
        return Object.assign(
          { role: 'controleur', permissions: null, allowedCompanies: null, allowedCostCenters: null, environmentIds: [] },
          stored, { isAdmin: true });
      }
      return stored;
    },

    /** Tout le fichier, pour l'écran d'administration. */
    all() {
      const data = load();
      return { users: data.users, log: data.log.slice(0, 50), admins: Array.from(bootstrap) };
    },

    set(account, input, by) {
      const name = normalizeAccount(account);
      if (!name) throw new RightsError('Identifiant invalide.');
      const rights = sanitizeRights(input);
      const data = load();
      const wasAdmin = Boolean(data.users[name] && data.users[name].isAdmin === true);
      if (wasAdmin && !rights.isAdmin && adminCountWith(data, name, false) === 0) {
        throw new RightsError('Dernier administrateur : lui retirer ce statut fermerait la gestion des droits.', 409);
      }
      data.users[name] = Object.assign(rights, { updatedAt: new Date().toISOString(), updatedBy: by });
      logChange(data, by, name, 'droits enregistrés (' + rights.role + (rights.isAdmin ? ', administrateur' : '') + ')');
      write(data);
      return data.users[name];
    },

    remove(account, by) {
      const name = normalizeAccount(account);
      if (!name) throw new RightsError('Identifiant invalide.');
      const data = load();
      if (!data.users[name]) return false;
      if (data.users[name].isAdmin === true && adminCountWith(data, name, false) === 0) {
        throw new RightsError('Dernier administrateur : retirer ses droits fermerait la gestion des droits.', 409);
      }
      delete data.users[name];
      logChange(data, by, name, 'accès retiré');
      write(data);
      return true;
    },
  };
}
