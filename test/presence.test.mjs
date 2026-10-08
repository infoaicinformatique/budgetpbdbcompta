// Tests de presence.mjs : qui a la main sur un budget.
// Lancer : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPresenceStore, PRESENCE_TTL_MS } from '../presence.mjs';

/** Magasin à horloge simulée : le temps n'avance que quand on le décide. */
function store(ttlMs = 1000) {
  let clock = 1_000_000;
  const s = createPresenceStore({ now: () => clock, ttlMs });
  return { s, advance: (ms) => { clock += ms; }, at: () => clock };
}

test('la première personne à annoncer une société obtient la main', () => {
  const { s } = store();
  const first = s.claim('a.porrati', 'Alexis Porrati', 'pb');
  assert.equal(first.mine, true, 'la première personne obtient la main');
  assert.equal(first.holder.account, 'a.porrati');
  assert.equal(first.holder.name, 'Alexis Porrati');
});

test('la deuxième personne est en lecture seule, et sait qui a la main', () => {
  const { s } = store();
  s.claim('a.porrati', 'Alexis Porrati', 'pb');
  const second = s.claim('j.quere', 'Jean Quéré', 'pb');
  assert.equal(second.mine, false, 'la personne arrivée ensuite n’a pas la main');
  assert.equal(second.holder.account, 'a.porrati', 'et on lui dit qui l’a');
  assert.equal(second.holder.name, 'Alexis Porrati', 'nommément, pas par identifiant seul');
});

test('deux sociétés différentes ne se gênent jamais', () => {
  const { s } = store();
  assert.equal(s.claim('j.quere', 'Jean Quéré', 'pb').mine, true);
  assert.equal(s.claim('c.mira', 'Claire Mira', 'db').mine, true,
    'un autre établissement reste libre : la main est par société');
  assert.equal(s.claim('j.quere', 'Jean Quéré', 'pb').mine, true, 'chacun garde la sienne');
});

test('un battement de cœur garde la main sans en changer l’heure de prise', () => {
  const { s, advance } = store(1000);
  const first = s.claim('a.porrati', 'Alexis', 'pb');
  advance(900);
  const again = s.claim('a.porrati', 'Alexis', 'pb');
  assert.equal(again.mine, true, 'son propre battement la conserve');
  assert.equal(again.holder.since, first.holder.since,
    'l’heure de prise ne bouge pas : c’est la même main, pas une nouvelle');
  advance(900);
  assert.equal(s.claim('j.quere', 'Jean', 'pb').mine, false,
    'et elle n’est pas passée à quelqu’un d’autre entre-temps');
});

test('la main se libère d’elle-même après le délai sans nouvelle', () => {
  const { s, advance } = store(1000);
  s.claim('a.porrati', 'Alexis', 'pb');
  advance(1001);
  // Un onglet fermé ou un poste éteint ne doit pas bloquer le budget.
  assert.equal(s.holderOf('pb'), null, 'la main est rendue faute de nouvelles');
  const next = s.claim('j.quere', 'Jean', 'pb');
  assert.equal(next.mine, true, 'la personne suivante peut la prendre');
  assert.equal(next.holder.account, 'j.quere');
});

test('heldByOther : la question que pose l’écriture avant d’enregistrer', () => {
  const { s, advance } = store(1000);
  s.claim('a.porrati', 'Alexis Porrati', 'pb');
  assert.equal(s.heldByOther('a.porrati', 'pb'), null,
    'celui qui a la main écrit sans entrave');
  const blocked = s.heldByOther('j.quere', 'pb');
  assert.ok(blocked, 'un autre est bloqué');
  assert.equal(blocked.name, 'Alexis Porrati', 'et le refus peut le nommer');
  assert.equal(s.heldByOther('j.quere', 'db'), null, 'une société libre ne bloque personne');
  advance(1001);
  assert.equal(s.heldByOther('j.quere', 'pb'), null, 'une main expirée ne bloque plus');
});

test('rendre la main : la sienne seulement, une société ou toutes', () => {
  const { s } = store();
  s.claim('a.porrati', 'Alexis', 'pb');
  s.claim('a.porrati', 'Alexis', 'db');
  s.claim('j.quere', 'Jean', 'cannes');

  assert.equal(s.release('j.quere', 'pb'), 0, 'on ne reprend pas la main de quelqu’un d’autre');
  assert.equal(s.claim('j.quere', 'Jean', 'pb').mine, false, 'elle est donc toujours à Alexis');

  assert.equal(s.release('a.porrati', 'pb'), 1, 'sa propre main sur une société précise');
  assert.equal(s.claim('j.quere', 'Jean', 'pb').mine, true, 'la société est libérée');
  assert.ok(s.all().db, 'son autre main est intacte');

  assert.equal(s.release('a.porrati'), 1, 'sans société : toutes les siennes (déconnexion)');
  assert.equal(s.all().db, undefined);
  assert.ok(s.all().cannes, 'celles des autres ne bougent pas');
  assert.equal(s.release(''), 0, 'un compte vide ne libère rien');
});

test('une annonce sans société, ou sans compte, ne prend aucune main', () => {
  const { s } = store();
  assert.deepEqual(s.claim('a.porrati', 'Alexis', ''), { holder: null, mine: false });
  assert.deepEqual(s.claim('', 'Personne', 'pb'), { holder: null, mine: false });
  assert.deepEqual(s.all(), {}, 'et rien n’est enregistré');
});

test('le délai par défaut laisse passer plusieurs battements', () => {
  // Le navigateur bat toutes les 20 s : le délai doit survivre à deux
  // battements manqués, sinon la main sauterait au moindre hoquet réseau.
  assert.ok(PRESENCE_TTL_MS >= 60 * 1000, 'délai trop court pour un battement de 20 s');
  assert.ok(PRESENCE_TTL_MS <= 5 * 60 * 1000, 'délai trop long : un onglet fermé bloquerait le budget');
});

test('refusalFor : la phrase opposée à une saisie refusée nomme la personne et la société', () => {
  const { s } = store();
  const state = { companies: [{ id: 'pb', name: 'Palm Beach' }, { id: 'db', name: 'Dolce Beach' }] };
  s.claim('a.porrati', 'Alexis Porrati', 'pb');

  assert.equal(s.refusalFor('a.porrati', ['pb'], state), null,
    'celui qui a la main enregistre sans refus');
  assert.equal(s.refusalFor('j.quere', ['db'], state), null,
    'une autre société ne concerne pas cette main');
  assert.equal(s.refusalFor('j.quere', [], state), null, 'rien de déclaré, rien à refuser');

  const refusal = s.refusalFor('j.quere', ['db', 'pb'], state);
  assert.ok(refusal, 'une société tenue par quelqu’un d’autre fait refuser l’écriture');
  assert.equal(refusal.handCompany, 'pb', 'la société en cause est nommée');
  assert.equal(refusal.handHolder.name, 'Alexis Porrati');
  assert.match(refusal.error, /Palm Beach/, 'la société apparaît par son nom, pas par son identifiant');
  assert.match(refusal.error, /Alexis Porrati/, 'et la personne qui a la main');
  assert.match(refusal.error, /n’a pas été enregistrée/,
    'la phrase doit dire que la modification est perdue, pas laisser croire le contraire');

  // Société inconnue de l'état : on se rabat sur l'identifiant plutôt que
  // de produire une phrase trouée.
  s.claim('a.porrati', 'Alexis Porrati', 'inconnue');
  assert.match(s.refusalFor('j.quere', ['inconnue'], state).error, /« inconnue »/);
  assert.match(s.refusalFor('j.quere', ['inconnue'], null).error, /« inconnue »/,
    'un état absent ne doit pas faire échouer le refus');
});

test('refusalFor accepte un Set, comme le déclare le corps d’une écriture', () => {
  // `declarationOf` (data.mjs) rend `companies` sous forme de Set.
  const { s } = store();
  s.claim('a.porrati', 'Alexis', 'pb');
  const refusal = s.refusalFor('j.quere', new Set(['pb']), { companies: [{ id: 'pb', name: 'Palm Beach' }] });
  assert.ok(refusal && refusal.handCompany === 'pb', 'un Set doit être parcouru comme un tableau');
});
