// Tests de rights.mjs : fichier des droits dans un dossier temporaire.
// Lancer : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRightsStore, sanitizeRights, parseAdminList, normalizeAccount, RightsError } from '../rights.mjs';

const tmpFile = () => join(mkdtempSync(join(tmpdir(), 'droits-')), 'sous-dossier', 'droits.json');
const directeur = { role: 'directeur', isAdmin: false, permissions: { saisie: ['saisie-ajouter'], directeur: [] },
  allowedCompanies: ['co_1'], allowedCostCenters: ['F&B'], environmentIds: ['sg_1'] };

test('identifiants et liste RIGHTS_ADMINS normalisés', () => {
  assert.equal(normalizeAccount(' Prenom.Nom '), 'prenom.nom');
  assert.equal(normalizeAccount('a b'), '');
  assert.equal(normalizeAccount('<script>'), '');
  assert.deepEqual(parseAdminList('Alexis.X, bob ;; <x>'), ['alexis.x', 'bob']);
});

test('sanitizeRights : forme contrôlée, rien d’inattendu ne passe', () => {
  const clean = sanitizeRights(Object.assign({ extra: 'ignoré' }, directeur));
  assert.deepEqual(clean, directeur);
  assert.equal(sanitizeRights({ role: 'controleur' }).permissions, null, 'sans droits : ceux du rôle');
  assert.throws(() => sanitizeRights({ role: 'root' }), RightsError);
  assert.throws(() => sanitizeRights({ role: 'directeur', permissions: ['x'] }), RightsError);
  assert.throws(() => sanitizeRights({ role: 'directeur', permissions: { 'a b': [] } }), RightsError);
  assert.throws(() => sanitizeRights({ role: 'directeur', allowedCompanies: ['<img>'] }), RightsError);
  assert.equal(sanitizeRights({ role: 'directeur', isAdmin: 'oui' }).isAdmin, false, 'seul true vaut administrateur');
});

test('sans fiche : aucun accès, sauf RIGHTS_ADMINS (contrôleur complet)', () => {
  const store = createRightsStore(tmpFile(), ['alexis']);
  assert.equal(store.effective('inconnu'), null);
  const admin = store.effective('alexis');
  assert.equal(admin.isAdmin, true);
  assert.equal(admin.role, 'controleur');
  assert.equal(admin.permissions, null);
});

test('enregistrement persistant, journalisé, et relu par une autre instance', () => {
  const file = tmpFile();
  const store = createRightsStore(file, ['alexis']);
  store.set('Prenom.Nom', directeur, 'alexis');
  const other = createRightsStore(file, []);
  assert.deepEqual(Object.assign({}, other.effective('prenom.nom'), { updatedAt: undefined }),
    Object.assign({}, directeur, { updatedAt: undefined, updatedBy: 'alexis' }));
  const data = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(data.log[0].account, 'prenom.nom');
  assert.equal(data.log[0].by, 'alexis');
  assert.equal(store.remove('prenom.nom', 'alexis'), true);
  assert.equal(store.effective('prenom.nom'), null);
});

test('RIGHTS_ADMINS reste administrateur quoi que dise sa fiche', () => {
  const store = createRightsStore(tmpFile(), ['alexis']);
  store.set('alexis', directeur, 'alexis');
  assert.equal(store.effective('alexis').isAdmin, true);
  assert.equal(store.effective('alexis').role, 'directeur');
});

test('le dernier administrateur ne peut pas être rétrogradé ni retiré', () => {
  const store = createRightsStore(tmpFile(), []);
  store.set('chef', Object.assign({}, directeur, { isAdmin: true }), 'chef');
  assert.throws(() => store.set('chef', directeur, 'chef'), (err) => err instanceof RightsError && err.status === 409);
  assert.throws(() => store.remove('chef', 'chef'), (err) => err.status === 409);
  store.set('adjoint', Object.assign({}, directeur, { isAdmin: true }), 'chef');
  store.set('chef', directeur, 'chef'); // un autre administrateur existe : permis
  assert.equal(store.effective('chef').isAdmin, false);
  store.set('simple', directeur, 'adjoint');
  assert.equal(store.remove('simple', 'adjoint'), true, 'retirer un non-administrateur est toujours permis');
});

test('fichier illisible : erreur explicite, jamais un accès ouvert', () => {
  const file = tmpFile();
  const store = createRightsStore(file, []);
  store.set('a', directeur, 'x');
  writeFileSync(file, '{ cassé');
  assert.throws(() => store.effective('a'), /illisible/);
});
