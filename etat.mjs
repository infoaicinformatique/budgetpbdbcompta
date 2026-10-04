/**
 * État budgétaire tenu par le serveur : un seul fichier JSON (ETAT_FILE),
 * le même pour tous les postes.
 *
 * Alexis, 04/10/2026 : « je ne veux pas que les informations soient
 * enregistré dans le poste et navigateur mais plus sur le serveur ». Jusque
 * là, chaque navigateur gardait son propre budget dans son IndexedDB : deux
 * personnes sur deux postes ne voyaient jamais les mêmes sociétés. Le
 * serveur fait désormais foi, et le navigateur ne garde qu'un filet de
 * sécurité pour les modifications pas encore envoyées.
 *
 * Forme du fichier :
 *
 *   { version, updatedAt, updatedBy, state }
 *
 * `version` est un entier qui s'incrémente à CHAQUE écriture. L'application
 * envoie la version sur laquelle elle a travaillé (`baseVersion`) ; si elle
 * ne correspond plus, l'écriture est refusée (409) et l'application recharge
 * en le disant. Sans ce garde-fou, deux personnes qui saisissent en même
 * temps s'effaceraient mutuellement sans que personne ne s'en aperçoive.
 *
 * Le serveur ne comprend RIEN au contenu de `state` : c'est l'affaire de
 * l'application (règles métier, GOP/EBITDA, plan comptable). Il ne contrôle
 * que la forme — un objet JSON, pas trop gros — et l'écrit sans l'interpréter.
 * Un seul fichier de secours est conservé (`<fichier>.precedent`) : de quoi
 * revenir en arrière d'une écriture, à la main, si une saisie tourne mal.
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Taille maximale de l'état sérialisé. Mesuré : 34 Ko pour trois budgets importés. */
export const ETAT_MAX_BYTES = 24 * 1024 * 1024;

/** Erreur de saisie (400), de version (409) ou de taille (413). */
export class EtatError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status || 400;
  }
}

/**
 * Magasin de l'état. Le fichier est relu à chaque lecture : une restauration
 * faite à la main sur le serveur est prise en compte sans redémarrage.
 */
export function createEtatStore(filePath) {
  function load() {
    let data;
    try {
      data = JSON.parse(readFileSync(filePath, 'utf8'));
    } catch (err) {
      // Pas de fichier : aucun état encore enregistré. C'est l'état normal
      // au premier démarrage — la première application qui se connecte y
      // dépose le sien (voir `pushServerState` côté navigateur).
      if (err.code === 'ENOENT') return { version: 0, updatedAt: '', updatedBy: '', state: null };
      throw new Error('Fichier d’état illisible (' + filePath + ') : ' + err.message);
    }
    const version = Number.isInteger(data && data.version) && data.version >= 0 ? data.version : 0;
    const state = data && typeof data.state === 'object' && data.state && !Array.isArray(data.state)
      ? data.state
      : null;
    return {
      version: state ? version : 0,
      updatedAt: typeof (data && data.updatedAt) === 'string' ? data.updatedAt : '',
      updatedBy: typeof (data && data.updatedBy) === 'string' ? data.updatedBy : '',
      state: state,
    };
  }

  return {
    /** L'état enregistré, tel quel. `state` à `null` tant que rien n'a été déposé. */
    read() {
      return load();
    },

    /** Version courante seule, sans transporter l'état (pour journaliser). */
    version() {
      return load().version;
    },

    /**
     * Écrit un nouvel état. `baseVersion` doit être la version lue par
     * l'appelant ; sinon l'écriture est refusée et la version courante est
     * rendue avec l'erreur, pour que l'application sache quoi recharger.
     */
    write(baseVersion, state, by) {
      if (!state || typeof state !== 'object' || Array.isArray(state)) {
        throw new EtatError('État attendu : un objet JSON.');
      }
      if (!Number.isInteger(baseVersion) || baseVersion < 0) {
        throw new EtatError('Version de départ attendue (un entier).');
      }
      const serialized = JSON.stringify(state);
      if (Buffer.byteLength(serialized, 'utf8') > ETAT_MAX_BYTES) {
        throw new EtatError('État trop volumineux pour être enregistré.', 413);
      }
      const current = load();
      if (baseVersion !== current.version) {
        const conflict = new EtatError(
          'Quelqu’un a enregistré entre-temps (version ' + current.version + ').', 409);
        conflict.currentVersion = current.version;
        throw conflict;
      }
      const next = {
        version: current.version + 1,
        updatedAt: new Date().toISOString(),
        updatedBy: by || '?',
        state: state,
      };
      mkdirSync(dirname(filePath), { recursive: true });
      // Copie de l'état précédent AVANT d'écrire le nouveau : une seule
      // génération en arrière, mais elle sauve d'une mauvaise saisie.
      try {
        copyFileSync(filePath, filePath + '.precedent');
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
      // Écriture dans un fichier voisin puis renommage : un arrêt en plein
      // milieu laisse l'ancien fichier intact, jamais un fichier à moitié écrit.
      const tmp = filePath + '.tmp';
      writeFileSync(tmp, JSON.stringify(next) + '\n', { mode: 0o600 });
      renameSync(tmp, filePath);
      return { version: next.version, updatedAt: next.updatedAt, updatedBy: next.updatedBy };
    },
  };
}
