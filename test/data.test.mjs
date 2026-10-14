// Tests de data.mjs : données budgétaires tenues par le serveur.
// Lancer : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDataStore, scopeOf, filterState, mergeState, declarationOf, DataError } from '../data.mjs';

const tmpFile = () => join(mkdtempSync(join(tmpdir(), 'donnees-')), 'sous-dossier', 'budget.json');

/* Deux environnements : PB (groupe g1 : sociétés a, b) et DB (groupe g2 : société c). */
function sample() {
  return {
    version: 2,
    superGroups: [{ id: 'sgrp_pb', name: 'PB' }, { id: 'sgrp_db', name: 'DB' }],
    groups: [{ id: 'g1', name: 'Groupe 1', superGroupId: 'sgrp_pb' }, { id: 'g2', name: 'Groupe 2', superGroupId: 'sgrp_db' }],
    companies: [
      { id: 'a', name: 'Alpha', groupId: 'g1' },
      { id: 'b', name: 'Bravo', groupId: 'g1' },
      { id: 'c', name: 'Charlie', groupId: 'g2' },
    ],
    lines: [
      { id: 'la', companyId: 'a', amounts: [1] },
      { id: 'lb', companyId: 'b', amounts: [2] },
      { id: 'lc', companyId: 'c', amounts: [3] },
    ],
    employees: [{ id: 'ec', companyId: 'c', name: 'Salarié C', grossMonthly: 5000 }],
    priorActuals: { a: { ca: 1 }, c: { ca: 3 } },
    caEvents: [
      { id: 'e1', companyIds: ['a', 'c'], name: 'Partagé' },
      { id: 'e2', companyIds: ['a'], name: 'Alpha seul' },
    ],
    scenarios: [{ id: 'scn1', name: 'Base' }],
    exchangeRates: { USD: 1.1 },
    users: [{ username: 'local', passwordHash: 'secret' }],
    authLog: [{ type: 'connexion' }],
    activeCompany: 'a',
  };
}

const controleur = { role: 'controleur', isAdmin: false, permissions: null, allowedCompanies: null, environmentIds: [] };
const dirPB = { role: 'directeur', isAdmin: false, permissions: {}, allowedCompanies: null, environmentIds: ['sgrp_pb'] };
const dirA = { role: 'directeur', isAdmin: false, permissions: {}, allowedCompanies: ['a'], environmentIds: [] };

test('périmètre : même règle que allowedCompanyIds de l’application', () => {
  const s = sample();
  assert.equal(scopeOf(controleur, s), null, 'sans restriction');
  assert.deepEqual([...scopeOf(dirPB, s)].sort(), ['a', 'b'], 'environnement → groupes → sociétés');
  assert.deepEqual([...scopeOf(Object.assign({}, dirPB, { allowedCompanies: ['b', 'c'] }), s)], ['b'],
    'la sélection de sociétés réduit l’environnement');
  assert.deepEqual([...scopeOf(dirA, s)], ['a']);
  assert.equal(scopeOf(null, s).size, 0, 'sans fiche : rien');
  assert.equal(scopeOf({ role: 'directeur', allowedCompanies: null, environmentIds: ['inconnu'] }, s), null,
    'un environnement inconnu est ignoré, comme dans l’application');
});

test('lecture filtrée : rien des autres sociétés, rien de privé', () => {
  const out = filterState(sample(), scopeOf(dirA, sample()), dirA);
  assert.deepEqual(out.companies.map((c) => c.id), ['a']);
  assert.deepEqual(out.lines.map((l) => l.id), ['la']);
  assert.deepEqual(out.employees, [], 'aucun salaire d’une autre société');
  assert.deepEqual(Object.keys(out.priorActuals), ['a']);
  assert.deepEqual(out.caEvents.map((e) => [e.id, e.companyIds]), [['e1', ['a']], ['e2', ['a']]],
    'un événement partagé ne révèle pas les autres sociétés');
  assert.deepEqual(out.groups.map((g) => g.id), ['g1']);
  assert.deepEqual(out.superGroups.map((sg) => sg.id), ['sgrp_pb']);
  assert.deepEqual(out.scenarios, sample().scenarios, 'éléments communs transmis');
});

test('magasin vide, première publication réservée à un périmètre sans restriction', () => {
  const store = createDataStore(tmpFile());
  assert.equal(store.read(controleur).empty, true);
  assert.throws(() => store.write(dirA, 0, sample(), 'dir'), (e) => e instanceof DataError && e.status === 409);
  const r = store.write(controleur, 0, sample(), 'alexis');
  assert.equal(r.revision, 1);
  const back = store.read(controleur);
  assert.equal(back.empty, false);
  assert.equal(back.updatedBy, 'alexis');
  assert.equal(back.state.users, undefined, 'comptes locaux jamais enregistrés');
  assert.equal(back.state.authLog, undefined);
  assert.equal(back.state.activeCompany, undefined, 'choix d’affichage propre au poste');
  assert.equal(back.state.companies.length, 3);
});

test('écriture restreinte : seulement ses sociétés, ni création, ni suppression, ni éléments communs', () => {
  const store = createDataStore(tmpFile());
  store.write(controleur, 0, sample(), 'alexis');
  const mine = store.read(dirA);
  const edited = JSON.parse(JSON.stringify(mine.state));
  edited.lines[0].amounts = [100];
  edited.lines.push({ id: 'lpirate', companyId: 'c', amounts: [999] });     // société hors périmètre
  edited.companies.push({ id: 'z', name: 'Nouvelle' });                       // création interdite
  edited.scenarios = [];                                                      // élément commun
  edited.priorActuals = { a: { ca: 10 } };
  const r = store.write(dirA, mine.revision, edited, 'dir');
  assert.deepEqual(r.changedCompanies, ['a']);
  assert.equal(r.sharedChanged, false);

  const all = store.read(controleur).state;
  assert.deepEqual(all.lines.map((l) => [l.id, l.amounts[0]]).sort(), [['la', 100], ['lb', 2], ['lc', 3]]);
  assert.deepEqual(all.companies.map((c) => c.id), ['a', 'b', 'c']);
  assert.equal(all.scenarios.length, 1);
  assert.deepEqual(all.priorActuals, { a: { ca: 10 }, c: { ca: 3 } });
  assert.deepEqual(all.employees.map((e) => e.id), ['ec'], 'les salaires des autres sociétés restent');
  assert.deepEqual(all.caEvents.map((e) => [e.id, e.companyIds]).sort(), [['e1', ['a', 'c']], ['e2', ['a']]],
    'un événement partagé hors périmètre n’est pas amputé');
});

test('une société absente d’un envoi restreint garde ses données', () => {
  const store = createDataStore(tmpFile());
  store.write(controleur, 0, sample(), 'alexis');
  const mine = store.read(dirPB);
  const partial = JSON.parse(JSON.stringify(mine.state));
  partial.companies = partial.companies.filter((c) => c.id !== 'b');
  partial.lines = partial.lines.filter((l) => l.companyId !== 'b');
  store.write(dirPB, mine.revision, partial, 'dir');
  const all = store.read(controleur).state;
  assert.ok(all.lines.some((l) => l.id === 'lb'), 'jamais d’effacement par omission');
  assert.ok(all.companies.some((c) => c.id === 'b'));
});

test('sans restriction : ajouts et suppressions de sociétés, éléments communs', () => {
  const store = createDataStore(tmpFile());
  store.write(controleur, 0, sample(), 'alexis');
  const s = store.read(controleur).state;
  s.companies = s.companies.filter((c) => c.id !== 'c').concat([{ id: 'd', name: 'Delta', groupId: 'g1' }]);
  s.lines = s.lines.filter((l) => l.companyId !== 'c');
  s.employees = [];
  s.exchangeRates = { USD: 1.2 };
  const r = store.write(controleur, 1, s, 'alexis');
  assert.equal(r.sharedChanged, true);
  const all = store.read(controleur).state;
  assert.deepEqual(all.companies.map((c) => c.id), ['a', 'b', 'd']);
  assert.ok(!all.lines.some((l) => l.companyId === 'c'));
  assert.deepEqual(all.caEvents.find((e) => e.id === 'e1').companyIds, ['a'], 'société supprimée retirée des événements');
  assert.equal(all.exchangeRates.USD, 1.2);
});

test('saisies simultanées : sociétés différentes acceptées, même société refusée', () => {
  const store = createDataStore(tmpFile());
  store.write(controleur, 0, sample(), 'alexis');
  const forA = store.read(dirA);
  const forPB = store.read(dirPB);

  const b = JSON.parse(JSON.stringify(forPB.state));
  b.lines.find((l) => l.id === 'lb').amounts = [20];
  assert.equal(store.write(dirPB, forPB.revision, b, 'dirpb').revision, 2);

  // Même base, autre société : pas de conflit.
  const a = JSON.parse(JSON.stringify(forA.state));
  a.lines[0].amounts = [10];
  assert.equal(store.write(dirA, forA.revision, a, 'dira').revision, 3);

  // Base ancienne (1) sur la société a, modifiée en révision 3 : refus.
  const a2 = JSON.parse(JSON.stringify(forA.state));
  a2.lines[0].amounts = [11];
  assert.throws(() => store.write(dirA, forA.revision, a2, 'dira'),
    (e) => e instanceof DataError && e.status === 409 && e.extra.conflicts[0] === 'Alpha' && /dira/.test(e.message));

  // Un envoi identique à l’enregistré ne crée pas de révision.
  const unchanged = store.read(dirA);
  assert.equal(store.write(dirA, unchanged.revision, unchanged.state, 'dira').revision, unchanged.revision);
});

test('fichier écrit de façon atomique, historique gardé', () => {
  const file = tmpFile();
  let clock = Date.parse('2026-10-02T10:00:00Z');
  const store = createDataStore(file, { now: () => clock, historyEveryMs: 1000, historyKeep: 2 });
  store.write(controleur, 0, sample(), 'alexis');
  for (let i = 0; i < 4; i++) {
    clock += 2000;
    const s = store.read(controleur);
    s.state.exchangeRates = { USD: 1 + i };
    store.write(controleur, s.revision, s.state, 'alexis');
  }
  assert.ok(!existsSync(file + '.tmp'));
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).revision, 5);
  const history = readdirSync(join(file, '..', 'historique'));
  assert.equal(history.length, 2, 'seules les dernières copies sont gardées');
});

test('refus explicites', () => {
  const store = createDataStore(tmpFile());
  assert.throws(() => store.write(null, 0, sample(), 'x'), (e) => e.status === 403);
  assert.throws(() => store.write(controleur, 0, { pasDeSocietes: true }, 'x'), DataError);
  assert.throws(() => store.write(controleur, -1, sample(), 'x'), DataError);
  assert.equal(mergeState(sample(), sample(), null, true).changedCompanies.length, 0);
});

test('un poste ne renvoie que ce qu’il a modifié : sa copie périmée d’une autre société est ignorée', () => {
  const store = createDataStore(tmpFile());
  store.write(controleur, 0, sample(), 'alexis');
  const poste1 = store.read(controleur);
  const poste2 = store.read(controleur);

  const s1 = JSON.parse(JSON.stringify(poste1.state));
  s1.lines.find((l) => l.id === 'la').amounts = [10];
  store.write(controleur, poste1.revision, s1, 'p1', declarationOf({ changedCompanies: ['a'], sharedChanged: false }));

  // Poste 2 : modifie c, mais renvoie aussi sa vieille version de a.
  const s2 = JSON.parse(JSON.stringify(poste2.state));
  s2.lines.find((l) => l.id === 'lc').amounts = [30];
  const r = store.write(controleur, poste2.revision, s2, 'p2', declarationOf({ changedCompanies: ['c'], sharedChanged: false }));
  assert.deepEqual(r.changedCompanies, ['c'], 'pas de faux conflit sur a');
  const all = store.read(controleur).state;
  assert.equal(all.lines.find((l) => l.id === 'la').amounts[0], 10, 'la saisie du poste 1 n’est pas défaite');
  assert.equal(all.lines.find((l) => l.id === 'lc').amounts[0], 30);

  // Déclarée, la même société reste en conflit.
  const s3 = JSON.parse(JSON.stringify(poste2.state));
  s3.lines.find((l) => l.id === 'la').amounts = [99];
  assert.throws(() => store.write(controleur, poste2.revision, s3, 'p2', declarationOf({ changedCompanies: ['a'] })),
    (e) => e.status === 409);

  // Suppression et ajout déclarés.
  const now = store.read(controleur);
  const s4 = JSON.parse(JSON.stringify(now.state));
  s4.companies = s4.companies.filter((c) => c.id !== 'b').concat([{ id: 'd', name: 'Delta' }]);
  store.write(controleur, now.revision, s4, 'p1', declarationOf({ changedCompanies: ['b', 'd'] }));
  assert.deepEqual(store.read(controleur).state.companies.map((c) => c.id), ['a', 'c', 'd']);
  assert.equal(declarationOf({}), null);
});

test('périmètre par groupes de sociétés : seuls ou en plus des environnements (09/10/2026)', () => {
  const s = sample();
  // Un troisième groupe, rangé dans aucun environnement.
  s.groups.push({ id: 'g3', name: 'Groupe 3' });
  s.companies.push({ id: 'd', name: 'Delta', groupId: 'g3' });
  const ids = (scope) => (scope === null ? null : [...scope].sort());
  assert.deepEqual(ids(scopeOf({ role: 'directeur', groupIds: ['g2'] }, s)), ['c'], 'un groupe seul');
  assert.deepEqual(ids(scopeOf({ role: 'directeur', environmentIds: ['sgrp_pb'], groupIds: ['g3'] }, s)), ['a', 'b', 'd'],
    'environnement + groupe : union, même hors environnement');
  assert.deepEqual(ids(scopeOf({ role: 'directeur', groupIds: ['g1'], allowedCompanies: ['b', 'c'] }, s)), ['b'],
    'la sélection de sociétés restreint encore');
  assert.deepEqual(ids(scopeOf({ role: 'directeur', groupIds: ['inconnu'] }, s)), null, 'groupe disparu : sans effet');
  const out = filterState(s, scopeOf({ role: 'directeur', groupIds: ['g2'] }, s), { groupIds: ['g2'] });
  assert.deepEqual(out.companies.map((c) => c.id), ['c']);
  assert.deepEqual(out.superGroups.map((sg) => sg.id), ['sgrp_db'], 'l’environnement du groupe suit');
});

/* Soumission du budget (14/10/2026) : statut tenu par le serveur seul,
   budget soumis figé pour tout le monde, réouverture par un administrateur. */
test('soumission : figée côté serveur, réouverture réservée aux administrateurs, tracée', () => {
  const store = createDataStore(tmpFile());
  store.write(controleur, 0, sample(), 'alexis');
  const admin = Object.assign({}, controleur, { isAdmin: true });
  const dirSansSaisie = Object.assign({}, dirA, { permissions: { pnl: ['graphiques'] } });
  const dirSaisie = Object.assign({}, dirA, { permissions: { saisie: ['saisie-ajouter'] } });

  // Hors périmètre ou sans onglet de saisie : refusé.
  assert.throws(() => store.setSubmission(dirSaisie, 'b', 'submit', { account: 'dir' }), (e) => e.status === 403);
  assert.throws(() => store.setSubmission(dirSansSaisie, 'a', 'submit', { account: 'dir' }), (e) => e.status === 403);
  assert.throws(() => store.setSubmission(dirSaisie, 'a', 'autre', { account: 'dir' }), (e) => e.status === 400);

  // Le directeur soumet son budget : nouvelle révision, statut lisible par chacun de son périmètre.
  const before = store.read(dirSaisie).revision;
  const sub = store.setSubmission(dirSaisie, 'a', 'submit', { account: 'm.dupont', name: 'Marie Dupont' });
  assert.equal(sub.revision, before + 1);
  assert.equal(sub.submission.submitted, true);
  assert.equal(sub.submission.by.name, 'Marie Dupont');
  assert.deepEqual(sub.submission.history.map((h) => h.action), ['submit']);
  const seen = store.read(dirA).state.budgetSubmissions;
  assert.equal(seen.a.submitted, true);
  assert.equal(store.read(Object.assign({}, dirA, { allowedCompanies: ['b'] })).state.budgetSubmissions.a, undefined,
    'le statut d’une société hors périmètre n’est pas transmis');
  assert.throws(() => store.setSubmission(dirSaisie, 'a', 'submit', { account: 'dir' }), (e) => e.status === 409, 'déjà soumis');

  // Toute écriture sur ce budget est refusée — administrateur compris — avec un message clair.
  const edited = sample();
  edited.lines[0].amounts = [999];
  let refusal = null;
  try { store.write(admin, sub.revision, edited, 'alexis', { companies: new Set(['a']), shared: false }); } catch (e) { refusal = e; }
  assert.ok(refusal instanceof DataError && refusal.status === 409);
  assert.match(refusal.message, /Ce budget a été soumis par Marie Dupont : vos modifications n’ont pas été enregistrées\./);
  assert.equal(refusal.extra.submitted[0].company, 'a');
  // Même sans déclaration (publication complète) et pour une suppression.
  assert.throws(() => store.write(admin, sub.revision, edited, 'alexis'), (e) => e.status === 409);
  const withoutA = sample();
  withoutA.companies = withoutA.companies.filter((c) => c.id !== 'a');
  assert.throws(() => store.write(admin, sub.revision, withoutA, 'alexis'), (e) => e.status === 409);
  // Un poste dont la base est antérieure à la soumission reçoit le même refus (pas un « conflit »).
  assert.throws(() => store.write(dirA, before, edited, 'm.dupont', { companies: new Set(['a']), shared: false }),
    (e) => e.status === 409 && /soumis/.test(e.message));

  // Les autres sociétés restent modifiables.
  const otherEdit = sample();
  otherEdit.lines[1].amounts = [42];
  const ok = store.write(controleur, sub.revision, otherEdit, 'alexis', { companies: new Set(['b']), shared: false });
  assert.deepEqual(ok.changedCompanies, ['b']);

  // Un envoi ne peut pas « dé-soumettre » : le statut envoyé est ignoré.
  const forged = sample();
  forged.budgetSubmissions = { a: { submitted: false } };
  store.write(admin, ok.revision, forged, 'alexis', { companies: new Set(['c']), shared: false });
  assert.equal(store.read(admin).state.budgetSubmissions.a.submitted, true);

  // Réouverture : refusée à un directeur, acceptée pour un administrateur, tracée.
  assert.throws(() => store.setSubmission(dirSaisie, 'a', 'reopen', { account: 'dir' }),
    (e) => e.status === 403 && /Seul un administrateur/.test(e.message));
  const reopened = store.setSubmission(admin, 'a', 'reopen', { account: 'a.porrati', name: 'Alexis Porrati' });
  assert.equal(reopened.submission.submitted, false);
  assert.deepEqual(reopened.submission.history.map((h) => [h.action, h.by.account]), [['submit', 'm.dupont'], ['reopen', 'a.porrati']]);
  assert.throws(() => store.setSubmission(admin, 'a', 'reopen', { account: 'a.porrati' }), (e) => e.status === 409);
  // Rouvert : de nouveau modifiable.
  const after = store.write(dirA, reopened.revision, edited, 'm.dupont', { companies: new Set(['a']), shared: false });
  assert.deepEqual(after.changedCompanies, ['a']);
});
