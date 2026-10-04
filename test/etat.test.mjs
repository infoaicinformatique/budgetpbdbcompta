// Tests de etat.mjs : état budgétaire partagé, dans un dossier temporaire.
// Lancer : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEtatStore, EtatError, ETAT_MAX_BYTES } from '../etat.mjs';

const tmpFile = () => join(mkdtempSync(join(tmpdir(), 'etat-')), 'sous-dossier', 'etat.json');
const budget = { companies: [{ id: 'soc_1', name: 'Palm Beach' }], lines: [], version: 2 };

test('aucun fichier : version 0 et aucun état — c’est le premier démarrage', () => {
  const store = createEtatStore(tmpFile());
  assert.deepEqual(store.read(), { version: 0, updatedAt: '', updatedBy: '', state: null });
  assert.equal(store.version(), 0);
});

test('première écriture : version 1, l’état relu à l’identique', () => {
  const file = tmpFile();
  const store = createEtatStore(file);
  const saved = store.write(0, budget, 'alexis');
  assert.equal(saved.version, 1);
  assert.equal(saved.updatedBy, 'alexis');
  const read = store.read();
  assert.equal(read.version, 1);
  assert.deepEqual(read.state, budget, 'le serveur n’interprète rien : l’état revient tel quel');
  assert.ok(read.updatedAt.startsWith('20'), 'la date d’écriture est horodatée');
  // Le dossier est créé au besoin, comme pour les droits.
  assert.ok(existsSync(file));
});

test('la version s’incrémente à chaque écriture', () => {
  const store = createEtatStore(tmpFile());
  assert.equal(store.write(0, budget, 'a').version, 1);
  assert.equal(store.write(1, budget, 'b').version, 2);
  assert.equal(store.write(2, budget, 'c').version, 3);
  assert.equal(store.version(), 3);
});

test('version dépassée : écriture refusée en 409, avec la version courante', () => {
  // Le cœur du garde-fou : deux personnes qui saisissent en même temps ne
  // doivent pas s’effacer mutuellement. La seconde est refusée et sait sur
  // quelle version recharger.
  const store = createEtatStore(tmpFile());
  store.write(0, budget, 'alexis');
  try {
    store.write(0, { companies: [], lines: [] }, 'bob');
    assert.fail('une écriture basée sur une version dépassée doit être refusée');
  } catch (err) {
    assert.ok(err instanceof EtatError);
    assert.equal(err.status, 409);
    assert.equal(err.currentVersion, 1, 'la version courante accompagne le refus');
  }
  assert.deepEqual(store.read().state, budget, 'l’état d’origine est intact');
});

test('l’état précédent est conservé pour revenir en arrière d’une écriture', () => {
  const file = tmpFile();
  const store = createEtatStore(file);
  store.write(0, { companies: [{ id: 'soc_1' }], lines: [] }, 'alexis');
  store.write(1, { companies: [], lines: [] }, 'alexis');
  const previous = JSON.parse(readFileSync(file + '.precedent', 'utf8'));
  assert.equal(previous.version, 1);
  assert.equal(previous.state.companies.length, 1, 'la génération précédente reste récupérable à la main');
});

test('formes refusées : pas d’objet, pas de version, trop volumineux', () => {
  const store = createEtatStore(tmpFile());
  assert.throws(() => store.write(0, null, 'a'), EtatError);
  assert.throws(() => store.write(0, [1, 2], 'a'), EtatError, 'un tableau n’est pas un état');
  assert.throws(() => store.write(0, 'texte', 'a'), EtatError);
  assert.throws(() => store.write('0', budget, 'a'), EtatError, 'la version doit être un entier');
  assert.throws(() => store.write(-1, budget, 'a'), EtatError);
  const huge = { big: 'x'.repeat(ETAT_MAX_BYTES + 1) };
  try {
    store.write(0, huge, 'a');
    assert.fail('un état trop volumineux doit être refusé');
  } catch (err) {
    assert.equal(err.status, 413);
  }
  assert.equal(store.version(), 0, 'aucune de ces tentatives n’a écrit');
});

test('fichier abîmé à la main : traité comme vide, jamais comme un état', () => {
  const file = tmpFile();
  const store = createEtatStore(file);
  store.write(0, budget, 'alexis');
  // `state` remplacé par autre chose qu'un objet : on repart de zéro plutôt
  // que de servir n'importe quoi à l'application.
  writeFileSync(file, JSON.stringify({ version: 7, state: 'cassé' }));
  assert.deepEqual(store.read().state, null);
  assert.equal(store.read().version, 0, 'sans état, la version annoncée est 0');
  // JSON illisible : erreur franche, pas un état vide silencieux (le fichier
  // existe, le perdre par écrasement serait pire que s'arrêter).
  writeFileSync(file, '{ pas du json');
  assert.throws(() => store.read(), /illisible/);
});
