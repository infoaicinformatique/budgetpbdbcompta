/* ==================================================================
   DONNÉES BUDGÉTAIRES TENUES PAR LE SERVEUR

   Une seule copie des sociétés et des budgets, dans un fichier JSON
   (`DATA_FILE`, volume Docker `/data`). Chaque personne n'en reçoit que
   les sociétés de ses droits (`scopeOf`, même calcul que
   `allowedCompanyIds` dans budget-app.html) et ne peut écrire que
   celles-là (`mergeState`). Les éléments communs (groupes,
   environnements, plans, scénarios, taux…) ne s'écrivent qu'avec un
   périmètre sans restriction.

   Saisies simultanées : chaque société garde le numéro de la dernière
   révision qui l'a modifiée. Une écriture faite sur une base plus ancienne
   qui touche une société modifiée depuis est refusée (409) ; deux
   personnes sur des sociétés différentes ne se gênent jamais.

   Tout est synchrone entre la lecture du fichier et son écriture : Node
   ne traite qu'une requête à la fois dans cet intervalle, deux écritures
   ne peuvent donc pas se croiser.
   ================================================================== */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export class DataError extends Error {
  constructor(message, status = 400, extra = null) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/* Tableaux dont chaque élément appartient à une société (`companyId`). */
export const COMPANY_ARRAYS = ['lines', 'versions', 'employees', 'payrollExtras', 'caLines', 'objectives', 'editLog'];

/* Dictionnaires indexés par identifiant de société — `COMPANY_KEYED_STATE`
   dans budget-app.html. */
export const COMPANY_DICTS = [
  'dailyRevenue', 'dailyBudgetRevenue', 'priorActuals', 'serviceMatrix',
  'payrollLockedRates', 'caVentilation', 'caCategoryVentilation', 'caWeighting',
];

/* Jamais enregistré ni renvoyé : comptes et journal de sécurité propres au
   mode local, et choix d'affichage propres à chaque poste. `companyOrders`
   (ordre des sociétés de l'accueil, par compte local) : en mode serveur,
   cet ordre vit sur le profil de la personne (preferences.mjs). */
export const PRIVATE_KEYS = ['users', 'authLog', 'activeCompany', 'activeEnvironmentId', 'activeScenario', 'lastSavedAt', 'companyOrders'];

const SPECIAL_KEYS = new Set(['companies', 'caEvents', ...COMPANY_ARRAYS, ...COMPANY_DICTS, ...PRIVATE_KEYS]);

const HISTORY_EVERY_MS = 10 * 60 * 1000;
const HISTORY_KEEP = 200;

const asArray = (v) => (Array.isArray(v) ? v : []);
const asObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);

/** Clés communes (ni propres à une société, ni privées) présentes dans un état. */
function globalKeys(...states) {
  const keys = new Set();
  for (const s of states) for (const k of Object.keys(asObject(s))) if (!SPECIAL_KEYS.has(k)) keys.add(k);
  return [...keys].sort();
}

/**
 * Sociétés qu'une fiche de droits autorise, ou `null` (aucune restriction).
 * Même règle que `allowedCompanyIds` côté application : des environnements
 * bornent la liste (union de leurs sociétés, via groupe → environnement),
 * `allowedCompanies` la restreint encore s'il est renseigné. Sans fiche :
 * rien.
 */
export function scopeOf(rights, state) {
  if (!rights || typeof rights !== 'object') return new Set();
  const companies = asArray(state && state.companies);
  const groups = asArray(state && state.groups);
  const knownEnvironments = new Set(asArray(state && state.superGroups).map((sg) => sg && sg.id));
  const environments = asArray(rights.environmentIds).filter((id) => knownEnvironments.has(id));
  const chosen = Array.isArray(rights.allowedCompanies) ? new Set(rights.allowedCompanies) : null;
  if (environments.length) {
    const groupIds = new Set(groups.filter((g) => g && environments.includes(g.superGroupId)).map((g) => g.id));
    const inEnvironments = companies.filter((c) => c && groupIds.has(c.groupId)).map((c) => c.id);
    return new Set(chosen ? inEnvironments.filter((id) => chosen.has(id)) : inEnvironments);
  }
  return chosen;
}

/** Peut-on écrire les éléments communs ? Périmètre sans restriction seulement. */
export function canEditShared(rights, scope) {
  return Boolean(rights) && scope === null && (rights.role === 'controleur' || rights.isAdmin === true);
}

/** Part d'un état propre à une société : sert à savoir si elle a changé. */
function companySlice(state, id) {
  const s = asObject(state);
  const slice = { company: asArray(s.companies).find((c) => c && c.id === id) || null };
  for (const key of COMPANY_ARRAYS) slice[key] = asArray(s[key]).filter((x) => x && x.companyId === id);
  for (const key of COMPANY_DICTS) slice[key] = asObject(s[key])[id];
  slice.caEvents = asArray(s.caEvents).filter((e) => e && asArray(e.companyIds).includes(id));
  return slice;
}

function sharedSlice(state) {
  const s = asObject(state);
  const out = {};
  for (const key of globalKeys(s)) out[key] = s[key];
  return out;
}

/**
 * Ce que reçoit une personne : ses sociétés et ce qui s'y rattache, plus
 * les éléments communs utiles. Groupes et environnements sont réduits à
 * ceux qui portent l'une de ses sociétés (ou un environnement de sa fiche).
 */
export function filterState(state, scope, rights) {
  const s = asObject(state);
  const out = {};
  for (const key of globalKeys(s)) out[key] = s[key];
  const keep = (id) => scope === null || scope.has(id);
  out.companies = asArray(s.companies).filter((c) => c && keep(c.id));
  for (const key of COMPANY_ARRAYS) out[key] = asArray(s[key]).filter((x) => x && keep(x.companyId));
  for (const key of COMPANY_DICTS) {
    const dict = {};
    for (const [id, value] of Object.entries(asObject(s[key]))) if (keep(id)) dict[id] = value;
    out[key] = dict;
  }
  out.caEvents = asArray(s.caEvents)
    .filter((e) => e && asArray(e.companyIds).some(keep))
    .map((e) => (scope === null ? e : Object.assign({}, e, { companyIds: asArray(e.companyIds).filter(keep) })));
  if (scope !== null) {
    const groupIds = new Set(out.companies.map((c) => c.groupId).filter(Boolean));
    out.groups = asArray(s.groups).filter((g) => g && groupIds.has(g.id));
    const environmentIds = new Set(out.groups.map((g) => g.superGroupId).filter(Boolean));
    for (const id of asArray(rights && rights.environmentIds)) environmentIds.add(id);
    out.superGroups = asArray(s.superGroups).filter((sg) => sg && environmentIds.has(sg.id));
  }
  return out;
}

/**
 * Fusionne ce qu'envoie une personne dans l'état enregistré.
 * - Sans restriction : son état fait foi (ajouts et suppressions de
 *   sociétés compris), à l'exception des clés privées.
 * - Avec restriction : seules ses sociétés existantes sont reprises ; elle
 *   ne crée ni ne supprime de société, ne touche ni aux autres ni aux
 *   éléments communs, ni aux événements partagés avec une société hors de
 *   son périmètre.
 * `declared` ({ companies: Set, shared }) limite encore la reprise à ce que
 * l'envoi dit avoir modifié : un poste renvoie tout son état, y compris des
 * sociétés qu'un autre vient de changer et dont sa copie est périmée —
 * sans cette déclaration, ce serait un faux conflit, ou un retour en
 * arrière. `null` : tout l'envoi (première publication).
 * @returns {{ state, changedCompanies: string[], sharedChanged: boolean }}
 */
export function mergeState(stored, incoming, scope, shared, declared = null) {
  const base = asObject(stored);
  const sent = asObject(incoming);
  const keep = (id) => scope === null || scope.has(id);
  const touchable = (id) => !declared || declared.companies.has(id);
  const storedIds = new Set(asArray(base.companies).map((c) => c && c.id));
  const full = scope === null && shared;
  const sentById = new Map(asArray(sent.companies).filter((c) => c && typeof c.id === 'string').map((c) => [c.id, c]));

  let companies;
  if (full && !declared) {
    companies = [...sentById.values()];
  } else if (full) {
    companies = [];
    for (const c of asArray(base.companies).filter(Boolean)) {
      if (!touchable(c.id)) companies.push(c);
      else if (sentById.has(c.id)) companies.push(sentById.get(c.id));
      // touchable et absente de l'envoi : supprimée
    }
    for (const [id, c] of sentById) if (!storedIds.has(id) && touchable(id)) companies.push(c);
  } else {
    companies = asArray(base.companies).filter(Boolean)
      .map((c) => (keep(c.id) && touchable(c.id) && sentById.has(c.id) ? sentById.get(c.id) : c));
  }
  const finalIds = new Set(companies.map((c) => c.id));
  // Une société n'est reprise de l'envoi que si elle y figure : une société
  // absente d'un envoi restreint garde ses données (jamais d'effacement
  // par omission).
  const writable = (id) => finalIds.has(id) && sentById.has(id) && touchable(id) && (full || (keep(id) && storedIds.has(id)));

  const out = {};
  const takeShared = full && (!declared || declared.shared);
  for (const key of globalKeys(takeShared ? sent : base)) out[key] = (takeShared ? sent : base)[key];
  out.companies = companies;
  for (const key of COMPANY_ARRAYS) {
    out[key] = asArray(base[key]).filter((x) => x && !writable(x.companyId) && finalIds.has(x.companyId))
      .concat(asArray(sent[key]).filter((x) => x && writable(x.companyId)));
  }
  for (const key of COMPANY_DICTS) {
    const dict = {};
    for (const [id, value] of Object.entries(asObject(base[key]))) if (!writable(id) && finalIds.has(id)) dict[id] = value;
    for (const [id, value] of Object.entries(asObject(sent[key]))) if (writable(id)) dict[id] = value;
    out[key] = dict;
  }
  // Événements partagés entre sociétés : repris de l'envoi seulement si
  // toutes leurs sociétés sont modifiables ici ; un événement enregistré
  // qui en touche une autre reste tel quel (l'envoi n'en contient qu'une
  // vue amputée, voir `filterState`).
  const fullyWritable = (e) => asArray(e.companyIds).length > 0 && asArray(e.companyIds).every(writable);
  const lockedEventIds = new Set(asArray(base.caEvents).filter((e) => e && !fullyWritable(e)).map((e) => e.id));
  out.caEvents = asArray(base.caEvents).filter((e) => e && !fullyWritable(e))
    .map((e) => Object.assign({}, e, { companyIds: asArray(e.companyIds).filter((id) => finalIds.has(id)) }))
    .filter((e) => e.companyIds.length)
    .concat(asArray(sent.caEvents).filter((e) => e && !lockedEventIds.has(e.id) && fullyWritable(e)));

  const touched = new Set([...storedIds, ...finalIds]);
  const changedCompanies = [...touched].filter((id) => id && !same(companySlice(base, id), companySlice(out, id)));
  const sharedChanged = !same(sharedSlice(base), sharedSlice(out));
  return { state: out, changedCompanies, sharedChanged };
}

/** Déclaration de l'envoi (`changedCompanies`, `sharedChanged`), ou `null` si absente. */
export function declarationOf(body) {
  if (!body || !Array.isArray(body.changedCompanies)) return null;
  return {
    companies: new Set(body.changedCompanies.filter((id) => typeof id === 'string')),
    shared: body.sharedChanged === true,
  };
}

/**
 * Magasin des données : un fichier JSON, écrit de façon atomique (fichier
 * temporaire puis renommage), avec un historique horodaté (une copie au
 * plus toutes les dix minutes, les 200 dernières gardées).
 */
export function createDataStore(file, options = {}) {
  const historyDir = options.historyDir || join(dirname(file), 'historique');
  const historyEvery = options.historyEveryMs ?? HISTORY_EVERY_MS;
  const historyKeep = options.historyKeep ?? HISTORY_KEEP;
  const now = options.now || (() => Date.now());

  function load() {
    let raw;
    try {
      raw = readFileSync(file, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') return { revision: 0, updatedAt: null, updatedBy: null, state: null, companyRevisions: {}, sharedRevision: 0 };
      throw e;
    }
    const doc = JSON.parse(raw);
    return {
      revision: Number(doc.revision) || 0,
      updatedAt: doc.updatedAt || null,
      updatedBy: doc.updatedBy || null,
      state: doc.state && typeof doc.state === 'object' ? doc.state : null,
      companyRevisions: asObject(doc.companyRevisions),
      sharedRevision: Number(doc.sharedRevision) || 0,
      historyAt: doc.historyAt || null,
    };
  }

  /** Copie du fichier actuel dans l'historique. @returns l'heure de copie, ou celle de la précédente. */
  function keepHistory(previousAt) {
    if (!existsSync(file) || historyKeep <= 0) return previousAt || null;
    if (previousAt && now() - Date.parse(previousAt) < historyEvery) return previousAt;
    mkdirSync(historyDir, { recursive: true });
    const copies = readdirSync(historyDir).filter((n) => /^budget-.*\.json$/.test(n)).sort();
    const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-');
    copyFileSync(file, join(historyDir, 'budget-' + stamp + '.json'));
    copies.push('budget-' + stamp + '.json');
    for (const old of copies.slice(0, Math.max(0, copies.length - historyKeep))) unlinkSync(join(historyDir, old));
    return new Date(now()).toISOString();
  }

  function write(doc, previous) {
    mkdirSync(dirname(file), { recursive: true });
    doc.historyAt = keepHistory(previous && previous.historyAt);
    const tmp = file + '.tmp';
    writeFileSync(tmp, JSON.stringify(doc), { mode: 0o600 });
    renameSync(tmp, file);
  }

  return {
    /** Ce que reçoit une personne. `empty` : aucune donnée encore publiée. */
    read(rights) {
      const doc = load();
      if (!doc.state) {
        return { revision: doc.revision, empty: true, state: null, updatedAt: null, updatedBy: null,
          access: { unrestricted: Boolean(rights), shared: canEditShared(rights, null) } };
      }
      const scope = scopeOf(rights, doc.state);
      return {
        revision: doc.revision,
        empty: false,
        state: filterState(doc.state, scope, rights),
        updatedAt: doc.updatedAt,
        updatedBy: doc.updatedBy,
        access: { unrestricted: scope === null, shared: canEditShared(rights, scope) },
      };
    },

    revision() {
      return load().revision;
    },

    /**
     * Enregistre ce qu'envoie une personne, sur la base de la révision
     * `baseRevision` qu'elle avait reçue.
     */
    write(rights, baseRevision, incoming, by, declared = null) {
      if (!rights) throw new DataError('Aucun droit enregistré pour ce compte : écriture refusée.', 403);
      if (!incoming || typeof incoming !== 'object' || !Array.isArray(incoming.companies)) {
        throw new DataError('Données illisibles : liste des sociétés absente.');
      }
      const base = Number(baseRevision);
      if (!Number.isInteger(base) || base < 0) throw new DataError('Révision de départ invalide.');
      const doc = load();

      if (!doc.state) {
        // Première publication : réservée à un périmètre sans restriction.
        if (!canEditShared(rights, null)) {
          throw new DataError('La base n’est pas encore initialisée : un administrateur doit d’abord publier les données.', 409);
        }
        const merged = mergeState({}, incoming, null, true);
        const revision = doc.revision + 1;
        const companyRevisions = {};
        for (const c of merged.state.companies) companyRevisions[c.id] = revision;
        write({ revision, updatedAt: new Date(now()).toISOString(), updatedBy: by, state: merged.state, companyRevisions, sharedRevision: revision }, doc);
        return { revision, changedCompanies: merged.state.companies.map((c) => c.id), sharedChanged: true };
      }

      const scope = scopeOf(rights, doc.state);
      const shared = canEditShared(rights, scope);
      const merged = mergeState(doc.state, incoming, scope, shared, declared);

      const conflicts = merged.changedCompanies.filter((id) => (Number(doc.companyRevisions[id]) || 0) > base);
      const sharedConflict = merged.sharedChanged && doc.sharedRevision > base;
      if (conflicts.length || sharedConflict) {
        const names = conflicts.map((id) => {
          const c = asArray(doc.state.companies).find((x) => x && x.id === id) || asArray(incoming.companies).find((x) => x && x.id === id);
          return c && c.name ? c.name : id;
        });
        throw new DataError(
          (names.length ? 'Modifié entre-temps par ' + (doc.updatedBy || 'une autre personne') + ' : ' + names.join(', ') + '.'
            : 'Réglages communs modifiés entre-temps par ' + (doc.updatedBy || 'une autre personne') + '.'),
          409, { revision: doc.revision, conflicts: names, sharedConflict });
      }
      if (!merged.changedCompanies.length && !merged.sharedChanged) {
        return { revision: doc.revision, changedCompanies: [], sharedChanged: false };
      }

      const revision = doc.revision + 1;
      const companyRevisions = {};
      for (const c of merged.state.companies) companyRevisions[c.id] = Number(doc.companyRevisions[c.id]) || 0;
      for (const id of merged.changedCompanies) if (merged.state.companies.some((c) => c.id === id)) companyRevisions[id] = revision;
      write({
        revision,
        updatedAt: new Date(now()).toISOString(),
        updatedBy: by,
        state: merged.state,
        companyRevisions,
        sharedRevision: merged.sharedChanged ? revision : doc.sharedRevision,
      }, doc);
      return { revision, changedCompanies: merged.changedCompanies, sharedChanged: merged.sharedChanged };
    },
  };
}
