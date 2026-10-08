// Tests de preferences.mjs : ordre des sociétés de l'accueil, par personne.
// Lancer : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPreferencesStore, sanitizePreferences, PreferencesError } from '../preferences.mjs';

function store() {
  const dir = mkdtempSync(join(tmpdir(), 'prefs-'));
  const file = join(dir, 'preferences.json');
  return { s: createPreferencesStore(file), file, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test('une personne qui n’a encore rien rangé reçoit un ordre vide', () => {
  const { s, done } = store();
  assert.deepEqual(s.get('a.porrati'), { companyOrder: [] });
  done();
});

test('l’ordre enregistré est relu tel quel, et seulement pour cette personne', () => {
  const { s, file, done } = store();
  s.set('a.porrati', { companyOrder: ['soc_b', 'soc_a', 'soc_c'] });
  s.set('n.hovnanian', { companyOrder: ['soc_c'] });
  assert.deepEqual(s.get('a.porrati').companyOrder, ['soc_b', 'soc_a', 'soc_c']);
  assert.deepEqual(s.get('n.hovnanian').companyOrder, ['soc_c'], 'chacun garde le sien');
  const onDisk = JSON.parse(readFileSync(file, 'utf8'));
  assert.ok(onDisk.users['a.porrati'].updatedAt, 'la date de mise à jour est notée');
  done();
});

test('les doublons sont retirés, première position conservée', () => {
  assert.deepEqual(sanitizePreferences({ companyOrder: ['a', 'b', 'a'] }).companyOrder, ['a', 'b']);
});

test('une forme inattendue est refusée sans rien écrire', () => {
  const { s, done } = store();
  for (const bad of [null, [], { companyOrder: 'a' }, { companyOrder: [1] }, { companyOrder: ['../x'] },
    { companyOrder: new Array(501).fill('a') }]) {
    assert.throws(() => s.set('a.porrati', bad), PreferencesError);
  }
  assert.deepEqual(s.get('a.porrati').companyOrder, [], 'rien n’a été enregistré');
  done();
});

test('les champs inconnus ne passent pas dans le fichier', () => {
  assert.deepEqual(Object.keys(sanitizePreferences({ companyOrder: [], isAdmin: true })), ['companyOrder']);
});
