// Tests de rights.mjs : fichier des droits dans un dossier temporaire.
// Lancer : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRightsStore, sanitizeRights, sanitizeRole, normalizeRoleId, parseAdminList, normalizeAccount, RightsError } from '../rights.mjs';

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

const chefCuisine = { label: '  Chef   de cuisine ', description: 'Saisie des charges F&B', base: 'directeur',
  permissions: { saisie: ['saisie-ajouter'], payroll: [] }, allowedCostCenters: ['F&B'] };

test('rôles personnalisés : forme contrôlée, jamais à la place d’un rôle intégré', () => {
  const clean = sanitizeRole(Object.assign({ extra: 'ignoré' }, chefCuisine));
  assert.deepEqual(clean, { label: 'Chef de cuisine', description: 'Saisie des charges F&B', base: 'directeur',
    permissions: { saisie: ['saisie-ajouter'], payroll: [] }, allowedCostCenters: ['F&B'] });
  assert.throws(() => sanitizeRole(Object.assign({}, chefCuisine, { label: '  ' })), RightsError, 'nom obligatoire');
  assert.throws(() => sanitizeRole(Object.assign({}, chefCuisine, { base: 'root' })), RightsError, 'vue de base inconnue');
  assert.throws(() => sanitizeRole(Object.assign({}, chefCuisine, { label: 'x'.repeat(61) })), RightsError);
  assert.throws(() => sanitizeRole(Object.assign({}, chefCuisine, { permissions: ['x'] })), RightsError);
  assert.equal(normalizeRoleId('directeur'), '', 'un rôle intégré ne se remplace pas');
  assert.equal(normalizeRoleId('role_ab12'), 'role_ab12');
  assert.equal(normalizeRoleId('a/b'), '');
  // Une fiche à rôle intégré garde sa forme exacte ; un rôle personnalisé ajoute `roleId`.
  assert.ok(!('roleId' in sanitizeRights(directeur)));
  assert.equal(sanitizeRights(Object.assign({ roleId: 'role_ab12' }, directeur)).roleId, 'role_ab12');
  assert.throws(() => sanitizeRights(Object.assign({ roleId: 'directeur' }, directeur)), RightsError);
});

test('rôles personnalisés : créés, renommés, attribués, supprimés sans toucher aux droits', () => {
  const file = tmpFile();
  const store = createRightsStore(file, ['alexis']);
  assert.deepEqual(store.roles(), {}, 'aucun rôle au départ');
  store.setRole('role_chef', chefCuisine, 'alexis');
  assert.equal(createRightsStore(file, []).roles().role_chef.label, 'Chef de cuisine', 'relu par une autre instance');
  assert.equal(store.all().roles.role_chef.base, 'directeur');
  assert.throws(() => store.setRole('role_autre', Object.assign({}, chefCuisine, { label: 'CHEF DE CUISINE' }), 'alexis'),
    (err) => err instanceof RightsError && err.status === 409, 'deux rôles ne portent pas le même nom');
  store.setRole('role_chef', Object.assign({}, chefCuisine, { label: 'Chef cuisine' }), 'alexis');
  assert.equal(store.roles().role_chef.label, 'Chef cuisine', 'renommer son propre rôle est permis');

  assert.throws(() => store.set('bob', Object.assign({ roleId: 'role_inconnu' }, directeur), 'alexis'),
    (err) => err instanceof RightsError && err.status === 409, 'rôle inexistant refusé');
  store.set('bob', Object.assign({ roleId: 'role_chef' }, directeur), 'alexis');
  assert.equal(store.effective('bob').roleId, 'role_chef');
  assert.ok(JSON.parse(readFileSync(file, 'utf8')).log[0].action.includes('Chef cuisine'), 'le journal nomme le rôle');

  assert.deepEqual(store.removeRole('role_chef', 'alexis'), { removed: true, users: 1 });
  assert.deepEqual(store.roles(), {});
  const bob = store.effective('bob');
  assert.ok(!('roleId' in bob), 'le nom du rôle disparaît de la fiche');
  assert.deepEqual(bob.permissions, directeur.permissions, 'les droits restent');
  assert.deepEqual(store.removeRole('role_chef', 'alexis'), { removed: false, users: 0 });
});

test('groupes de sociétés du périmètre : contrôlés, absents d’une fiche qui n’en a pas', () => {
  assert.ok(!('groupIds' in sanitizeRights(directeur)));
  assert.ok(!('groupIds' in sanitizeRights(Object.assign({ groupIds: [] }, directeur))));
  assert.deepEqual(sanitizeRights(Object.assign({ groupIds: ['grp_1', 'grp_1'] }, directeur)).groupIds, ['grp_1']);
  assert.throws(() => sanitizeRights(Object.assign({ groupIds: ['<x>'] }, directeur)), RightsError);
});
