/**
 * Préférences d'affichage propres à chaque personne, tenues par le serveur :
 * un seul fichier JSON (PREFERENCES_FILE, volume `droits`), une entrée par
 * identifiant canonique (voir `normalizeAccount`).
 *
 *   { companyOrder: ['soc_a', 'soc_b', …],
 *     display: { textSize, density, motion, palette }, updatedAt }
 *
 * `companyOrder` : l'ordre dans lequel la personne a rangé ses sociétés sur
 * l'écran d'accueil (glisser-déposer des cartes, 08/10/2026). Ce n'est
 * qu'un ordre d'affichage : il ne donne accès à rien — l'application le
 * croise toujours avec le périmètre de droits, et une société inconnue ou
 * disparue y est simplement ignorée.
 *
 * `display` : réglages visuels de Paramètres › Préférences d'affichage
 * (08/10/2026) — taille du texte, densité des tableaux, animations, palette
 * de couleurs (seize archétypes, dont la charte par défaut). Chaque
 * valeur est prise dans une liste fermée (`DISPLAY_OPTIONS`, la même que
 * dans budget-app.html) ; une valeur absente vaut le réglage par défaut.
 *
 * Un `PUT` ne remplace que ce qu'il envoie : ranger ses cartes ne remet pas
 * ses réglages visuels à zéro, et inversement.
 *
 * Contrairement aux droits (réservés aux administrateurs) et aux budgets
 * (partagés), chacun lit et écrit SA seule entrée : `/api/preferences` ne
 * prend pas d'identifiant, il sert celui de la personne connectée.
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const ID_PATTERN = /^[A-Za-z0-9_&.:-]{1,80}$/;
const ORDER_MAX = 500;

/** Valeurs permises de chaque réglage visuel, la première étant celle par défaut. */
export const DISPLAY_OPTIONS = {
  textSize: ['normal', 'petit', 'grand', 'tres-grand'],
  density: ['normale', 'compacte', 'aeree'],
  motion: ['normales', 'reduites'],
  palette: ['charte', 'vert-comptable', 'vert-tableur', 'bleu-erp', 'bleu-marine', 'bleu-cloud',
    'bleu-bureautique', 'turquoise', 'violet-gestion', 'indigo', 'bordeaux', 'orange',
    'anthracite', 'ardoise', 'sapin-cuivre', 'contraste'],
};

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
  const clean = {};
  if (input.companyOrder !== undefined) {
    const order = input.companyOrder;
    if (!Array.isArray(order) || order.length > ORDER_MAX) throw new PreferencesError('Ordre des sociétés : liste attendue.');
    for (const id of order) {
      if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw new PreferencesError('Ordre des sociétés : identifiant invalide.');
    }
    clean.companyOrder = Array.from(new Set(order));
  }
  if (input.display !== undefined) {
    const display = input.display;
    if (!display || typeof display !== 'object' || Array.isArray(display)) throw new PreferencesError('Affichage : réglages attendus.');
    clean.display = {};
    for (const key of Object.keys(DISPLAY_OPTIONS)) {
      if (display[key] === undefined) continue;
      if (DISPLAY_OPTIONS[key].indexOf(display[key]) === -1) throw new PreferencesError('Affichage : valeur inconnue pour « ' + key + ' ».');
      clean.display[key] = display[key];
    }
  }
  if (!Object.keys(clean).length) throw new PreferencesError('Préférences attendues.');
  return clean;
}

/** Préférences complètes d'une entrée du fichier (valeurs par défaut comprises). */
function complete(entry) {
  const display = {};
  for (const key of Object.keys(DISPLAY_OPTIONS)) {
    const value = entry && entry.display ? entry.display[key] : undefined;
    display[key] = DISPLAY_OPTIONS[key].indexOf(value) === -1 ? DISPLAY_OPTIONS[key][0] : value;
  }
  return {
    companyOrder: entry && Array.isArray(entry.companyOrder) ? entry.companyOrder.slice() : [],
    display: display,
  };
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
    /** Préférences de `account`, complétées des valeurs par défaut pour ce qu'elle n'a pas réglé. */
    get(account) {
      return complete(load().users[account]);
    },
    /** Met à jour les préférences de `account` (et d'elle seule) avec ce qui est envoyé ; rend l'ensemble. */
    set(account, input) {
      const clean = sanitizePreferences(input);
      const data = load();
      const previous = data.users[account] || {};
      const next = Object.assign({}, previous, clean, { updatedAt: new Date().toISOString() });
      if (clean.display) next.display = Object.assign({}, previous.display || {}, clean.display);
      data.users[account] = next;
      write(data);
      return complete(next);
    },
  };
}
