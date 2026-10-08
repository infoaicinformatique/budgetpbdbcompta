// Tests de preferences.mjs : ordre des sociétés de l'accueil, par personne.
// Lancer : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPreferencesStore, sanitizePreferences, PreferencesError, DISPLAY_OPTIONS } from '../preferences.mjs';

function store() {
  const dir = mkdtempSync(join(tmpdir(), 'prefs-'));
  const file = join(dir, 'preferences.json');
  return { s: createPreferencesStore(file), file, done: () => rmSync(dir, { recursive: true, force: true }) };
}

const DEFAULT_DISPLAY = { textSize: 'normal', density: 'normale', motion: 'normales', palette: 'charte' };

test('une personne qui n’a encore rien réglé reçoit un ordre vide et l’affichage par défaut', () => {
  const { s, done } = store();
  assert.deepEqual(s.get('a.porrati'), { companyOrder: [], display: DEFAULT_DISPLAY });
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
  for (const bad of [null, [], {}, { companyOrder: 'a' }, { companyOrder: [1] }, { companyOrder: ['../x'] },
    { companyOrder: new Array(501).fill('a') }, { display: 'grand' }, { display: { textSize: 'énorme' } },
    { display: { density: 3 } }, { display: { palette: 'rose-fluo' } }]) {
    assert.throws(() => s.set('a.porrati', bad), PreferencesError);
  }
  assert.deepEqual(s.get('a.porrati').companyOrder, [], 'rien n’a été enregistré');
  done();
});

test('les champs inconnus ne passent pas dans le fichier', () => {
  assert.deepEqual(Object.keys(sanitizePreferences({ companyOrder: [], isAdmin: true })), ['companyOrder']);
  assert.deepEqual(sanitizePreferences({ display: { textSize: 'grand', couleur: 'rouge' } }),
    { display: { textSize: 'grand' } });
});

test('les réglages d’affichage s’enregistrent sans toucher à l’ordre des sociétés, et inversement', () => {
  const { s, done } = store();
  s.set('a.porrati', { companyOrder: ['soc_b', 'soc_a'] });
  const afterDisplay = s.set('a.porrati', { display: { textSize: 'grand' } });
  assert.deepEqual(afterDisplay.companyOrder, ['soc_b', 'soc_a'], 'l’ordre est conservé');
  assert.deepEqual(afterDisplay.display, { textSize: 'grand', density: 'normale', motion: 'normales', palette: 'charte' });
  s.set('a.porrati', { display: { density: 'compacte' } });
  assert.deepEqual(s.get('a.porrati').display, { textSize: 'grand', density: 'compacte', motion: 'normales', palette: 'charte' },
    'un réglage envoyé seul ne remet pas les autres à zéro');
  s.set('a.porrati', { companyOrder: ['soc_a'] });
  assert.equal(s.get('a.porrati').display.textSize, 'grand', 'ranger ses cartes ne touche pas à l’affichage');
  assert.deepEqual(s.get('n.hovnanian').display, DEFAULT_DISPLAY, 'chacun a son profil');
  done();
});

test('une palette de couleurs connue s’enregistre ; seize au choix, la charte par défaut', () => {
  const { s, done } = store();
  assert.equal(DISPLAY_OPTIONS.palette.length, 16, 'quinze archétypes plus la charte');
  assert.equal(s.set('a.porrati', { display: { palette: 'bleu-marine' } }).display.palette, 'bleu-marine');
  done();
});

test('la première valeur de chaque réglage est celle par défaut', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(DISPLAY_OPTIONS).map(([k, v]) => [k, v[0]])), DEFAULT_DISPLAY);
});
