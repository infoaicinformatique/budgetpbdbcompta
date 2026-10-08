/**
 * Préférences d'affichage propres à chaque personne, tenues par le serveur :
 * un seul fichier JSON (PREFERENCES_FILE, volume `droits`), une entrée par
 * identifiant canonique (voir `normalizeAccount`).
 *
 *   { companyOrder: ['soc_a', 'soc_b', …], updatedAt }
 *
 * `companyOrder` : l'ordre dans lequel la personne a rangé ses sociétés sur
 * l'écran d'accueil (glisser-déposer des cartes, 08/10/2026). Ce n'est
 * qu'un ordre d'affichage : il ne donne accès à rien — l'application le
 * croise toujours avec le périmètre de droits, et une société inconnue ou
 * disparue y est simplement ignorée.
 *
 * Contrairement aux droits (réservés aux administrateurs) et aux budgets
 * (partagés), chacun lit et écrit SA seule entrée : `/api/preferences` ne
 * prend pas d'identifiant, il sert celui de la personne connectée.
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const ID_PATTERN = /^[A-Za-z0-9_&.:-]{1,80}$/;
const ORDER_MAX = 500;

/** Erreur de saisie (400), distincte d'une panne. */
export class PreferencesError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status || 400;
  }
}

/**
 * Contrôle et nettoie des préférences reçues de l'application. Lève
 * `PreferencesError` si la forme est fausse : rien d'inattendu n'entre dans
 * le fichier. Les doublons sont retirés (première position conservée).
 */
export function sanitizePreferences(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PreferencesError('Préférences attendues.');
  const order = input.companyOrder;
  if (!Array.isArray(order) || order.length > ORDER_MAX) throw new PreferencesError('Ordre des sociétés : liste attendue.');
  for (const id of order) {
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw new PreferencesError('Ordre des sociétés : identifiant invalide.');
  }
  return { companyOrder: Array.from(new Set(order)) };
}

/**
 * Magasin des préférences. Le fichier est relu à chaque lecture (quelques
 * Ko) et réécrit par fichier voisin puis renommage, comme celui des droits.
 */
export function createPreferencesStore(filePath) {
  function load() {
    let data;
    try {
      data = JSON.parse(readFileSync(filePath, 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return { version: 1, users: {} };
      throw new Error('Fichier des préférences illisible (' + filePath + ') : ' + err.message);
    }
    return { version: 1, users: data && typeof data.users === 'object' && data.users ? data.users : {} };
  }

  function write(data) {
    mkdirSync(dirname(filePath), { recursive: true });
    const tmp = filePath + '.tmp';
    writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
    renameSync(tmp, filePath);
  }

  return {
    /** Préférences de `account` ; une personne qui n'a encore rien rangé reçoit une liste vide. */
    get(account) {
      const entry = load().users[account];
      return { companyOrder: entry && Array.isArray(entry.companyOrder) ? entry.companyOrder.slice() : [] };
    },
    /** Remplace les préférences de `account` (et d'elle seule). */
    set(account, input) {
      const clean = sanitizePreferences(input);
      const data = load();
      data.users[account] = Object.assign({}, clean, { updatedAt: new Date().toISOString() });
      write(data);
      return clean;
    },
  };
}
