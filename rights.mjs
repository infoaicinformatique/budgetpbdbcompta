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
 * Rôles personnalisés (09/10/2026) : le même fichier porte, sous `roles`,
 * les rôles créés par les administrateurs dans Paramètres › Rôles, en plus
 * des deux rôles intégrés (contrôleur de gestion, directeur) :
 *
 *   { label, description, base, permissions, allowedCostCenters,
 *     updatedAt, updatedBy }
 *
 * `base` est l'un des rôles intégrés : il décide de la vue (vue Directeur
 * ou vue complète) ; `permissions` et `allowedCostCenters` sont les droits
 * de départ donnés à une personne quand on lui attribue ce rôle. Une fiche
 * qui porte un rôle personnalisé garde `role` = sa base et y ajoute
 * `roleId` : l'application continue de raisonner sur les deux rôles
 * intégrés, le rôle personnalisé n'est qu'un nom et un point de départ.
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
const ROLE_MAX = 50;
const ROLE_LABEL_MAX = 60;
const ROLE_DESCRIPTION_MAX = 300;

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

/** Droits par onglet `{ onglet: [rubrique, …] }`, contrôlés comme ceux d'une fiche. */
function permissionsMap(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RightsError('Droits d’accès : objet attendu.');
  }
  const permissions = {};
  const tabs = Object.keys(value);
  if (tabs.length > 100) throw new RightsError('Droits d’accès : trop d’onglets.');
  for (const tab of tabs) {
    if (!ID_PATTERN.test(tab)) throw new RightsError('Droits d’accès : onglet invalide.');
    permissions[tab] = idList(value[tab], 'Rubriques de ' + tab) || [];
  }
  return permissions;
}

/** Texte libre d'une ligne : espaces resserrés, sans caractère de contrôle. */
function plainText(value, max, label) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') throw new RightsError(label + ' : texte attendu.');
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length > max) throw new RightsError(label + ' : ' + max + ' caractères au plus.');
  return text;
}

/** Identifiant d'un rôle personnalisé : jamais celui d'un rôle intégré. */
export function normalizeRoleId(value) {
  const id = String(value || '');
  return ID_PATTERN.test(id) && ROLES.indexOf(id) === -1 ? id : '';
}

/**
 * Contrôle et nettoie un rôle personnalisé reçu de l'application.
 */
export function sanitizeRole(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RightsError('Rôle attendu.');
  const label = plainText(input.label, ROLE_LABEL_MAX, 'Nom du rôle');
  if (!label) throw new RightsError('Nom du rôle : obligatoire.');
  if (ROLES.indexOf(input.base) === -1) throw new RightsError('Vue de base inconnue.');
  return {
    label: label,
    description: plainText(input.description, ROLE_DESCRIPTION_MAX, 'Description du rôle'),
    base: input.base,
    permissions: permissionsMap(input.permissions === undefined || input.permissions === null ? {} : input.permissions),
    allowedCostCenters: idList(input.allowedCostCenters, 'Centres de coûts'),
  };
}

/**
 * Contrôle et nettoie une fiche reçue de l'application. Lève `RightsError`
 * si la forme est fausse : rien d'inattendu n'entre dans le fichier.
 */
export function sanitizeRights(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RightsError('Fiche de droits attendue.');
  if (ROLES.indexOf(input.role) === -1) throw new RightsError('Rôle inconnu.');
  const permissions = input.permissions === null || input.permissions === undefined
    ? null : permissionsMap(input.permissions);
  // `roleId` n'apparaît que s'il désigne un rôle personnalisé : une fiche à
  // rôle intégré garde exactement sa forme d'avant les rôles personnalisés.
  const roleId = input.roleId === undefined || input.roleId === null || input.roleId === ''
    ? '' : normalizeRoleId(input.roleId);
  if (input.roleId && !roleId) throw new RightsError('Rôle personnalisé : identifiant invalide.');
  const rights = {
    role: input.role,
    isAdmin: input.isAdmin === true,
    permissions: permissions,
    allowedCompanies: idList(input.allowedCompanies, 'Sociétés'),
    allowedCostCenters: idList(input.allowedCostCenters, 'Centres de coûts'),
    environmentIds: idList(input.environmentIds, 'Environnements') || [],
  };
  if (roleId) rights.roleId = roleId;
  return rights;
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
      if (err.code === 'ENOENT') return { version: 1, users: {}, roles: {}, log: [] };
      throw new Error('Fichier des droits illisible (' + filePath + ') : ' + err.message);
    }
    return {
      version: 1,
      users: data && typeof data.users === 'object' && data.users ? data.users : {},
      roles: data && typeof data.roles === 'object' && data.roles && !Array.isArray(data.roles) ? data.roles : {},
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
      return { users: data.users, roles: data.roles, log: data.log.slice(0, 50), admins: Array.from(bootstrap) };
    },

    /** Rôles personnalisés : lus par toute personne connectée (leur nom s'affiche dans Paramètres). */
    roles() {
      return load().roles;
    },

    set(account, input, by) {
      const name = normalizeAccount(account);
      if (!name) throw new RightsError('Identifiant invalide.');
      const rights = sanitizeRights(input);
      const data = load();
      if (rights.roleId && !data.roles[rights.roleId]) {
        throw new RightsError('Ce rôle n’existe plus : actualisez la page et choisissez-en un autre.', 409);
      }
      const wasAdmin = Boolean(data.users[name] && data.users[name].isAdmin === true);
      if (wasAdmin && !rights.isAdmin && adminCountWith(data, name, false) === 0) {
        throw new RightsError('Dernier administrateur : lui retirer ce statut fermerait la gestion des droits.', 409);
      }
      data.users[name] = Object.assign(rights, { updatedAt: new Date().toISOString(), updatedBy: by });
      const roleName = rights.roleId ? data.roles[rights.roleId].label : rights.role;
      logChange(data, by, name, 'droits enregistrés (' + roleName + (rights.isAdmin ? ', administrateur' : '') + ')');
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

    /** Crée ou modifie un rôle personnalisé. Deux rôles ne portent pas le même nom. */
    setRole(id, input, by) {
      const roleId = normalizeRoleId(id);
      if (!roleId) throw new RightsError('Identifiant de rôle invalide.');
      const role = sanitizeRole(input);
      const data = load();
      if (!data.roles[roleId] && Object.keys(data.roles).length >= ROLE_MAX) {
        throw new RightsError('Trop de rôles : ' + ROLE_MAX + ' au plus.', 409);
      }
      const same = Object.keys(data.roles).find(function (other) {
        return other !== roleId && String(data.roles[other].label || '').toLowerCase() === role.label.toLowerCase();
      });
      if (same) throw new RightsError('Un rôle porte déjà le nom « ' + role.label + ' ».', 409);
      const created = !data.roles[roleId];
      data.roles[roleId] = Object.assign(role, { updatedAt: new Date().toISOString(), updatedBy: by });
      logChange(data, by, '', 'rôle « ' + role.label + ' » ' + (created ? 'créé' : 'modifié'));
      write(data);
      return data.roles[roleId];
    },

    /**
     * Supprime un rôle personnalisé. Les personnes qui le portaient gardent
     * leurs droits tels quels ; seul le nom du rôle disparaît de leur fiche
     * (elles retombent sur sa vue de base). Rend le nombre de fiches touchées.
     */
    removeRole(id, by) {
      const roleId = normalizeRoleId(id);
      if (!roleId) throw new RightsError('Identifiant de rôle invalide.');
      const data = load();
      const role = data.roles[roleId];
      if (!role) return { removed: false, users: 0 };
      let users = 0;
      for (const name of Object.keys(data.users)) {
        if (data.users[name].roleId === roleId) {
          delete data.users[name].roleId;
          users += 1;
        }
      }
      delete data.roles[roleId];
      logChange(data, by, '', 'rôle « ' + role.label + ' » supprimé' + (users ? ' (' + (users > 1 ? users + ' fiches gardent leurs droits' : '1 fiche garde ses droits') + ')' : ''));
      write(data);
      return { removed: true, users: users };
    },
  };
}
