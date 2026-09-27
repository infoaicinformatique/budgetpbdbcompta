/**
 * Tests du plan comptable et de l'agrégation P&L.
 *   node --experimental-strip-types src/engine/chart.test.ts
 */
import assert from 'node:assert';
import {
  ACCOUNTS,
  CENTER_OVERRIDES,
  COST_CENTERS,
  MONTHS,
  RATIO_GROUPS,
  accountsOfCenter,
  budgetableAccounts,
  categoryOf,
  costCenter,
  findAccount,
  searchAccounts,
  summarize,
  total,
  unclassifiedCharges,
  type BudgetLine,
} from './chart.ts';
import {
  BUDGET_COMPANY,
  BUDGET_CONTROLS,
  BUDGET_LINES,
} from '../data/budget-patio-2026.generated.ts';

let passed = 0;
const tests: [string, () => void][] = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

/** Ligne de budget : un montant identique sur les douze mois. */
let counter = 0;
const line = (account: string, name: string, monthly: number): BudgetLine => ({
  id: `L${++counter}`,
  account,
  name,
  amounts: new Array(MONTHS).fill(monthly),
});

/* ---------------- chargement du plan ---------------- */

test('le plan comptable est chargé et cohérent', () => {
  assert.ok(ACCOUNTS.length > 1000, 'plan trop court');
  const kinds = ACCOUNTS.reduce<Record<string, number>>((acc, a) => {
    acc[a.kind] = (acc[a.kind] ?? 0) + 1;
    return acc;
  }, {});
  assert.equal(kinds.produit, 52);
  assert.equal(kinds.charge, 320);
  assert.equal(kinds.bilan, 660);
  // Tous les numéros sont uniques et à 8 chiffres.
  const numbers = new Set(ACCOUNTS.map((a) => a.account));
  assert.equal(numbers.size, ACCOUNTS.length);
  assert.ok(ACCOUNTS.every((a) => /^\d{8}$/.test(a.account)));
});

test('les comptes budgétables excluent le bilan', () => {
  const budgetable = budgetableAccounts();
  assert.equal(budgetable.length, 372);
  assert.ok(budgetable.every((a) => a.kind !== 'bilan'));
});

test('une seule charge reste à classer, et elle est signalée', () => {
  const orphans = unclassifiedCharges();
  assert.equal(orphans.length, 1);
  assert.equal(orphans[0].account, '61110100');
});

test('toute charge classée a un centre connu et une catégorie', () => {
  for (const account of ACCOUNTS) {
    if (account.kind !== 'charge' || !account.center) continue;
    assert.doesNotThrow(() => costCenter(account.center!), account.account);
    assert.ok(categoryOf(account), `catégorie manquante pour ${account.account}`);
  }
});

test('les produits sont tous dans la catégorie Produits', () => {
  for (const account of ACCOUNTS) {
    if (account.kind === 'produit') assert.equal(categoryOf(account), 'Produits');
    if (account.kind === 'bilan') assert.equal(categoryOf(account), null);
  }
});

test('les neuf centres de coûts sont distincts, RPOI seul hors GOP', () => {
  assert.equal(COST_CENTERS.length, 9);
  assert.equal(new Set(COST_CENTERS.map((c) => c.code)).size, 9);
  assert.equal(new Set(COST_CENTERS.map((c) => c.category)).size, 9);
  const horsGop = COST_CENTERS.filter((c) => !c.inGop);
  assert.deepEqual(horsGop.map((c) => c.id), ['RPOI']);
  assert.equal(costCenter('RPOI').category, 'Other Taxes');
  assert.equal(costCenter('F&B').code, 1);
});

test('chaque centre porte des comptes', () => {
  for (const center of COST_CENTERS) {
    assert.ok(accountsOfCenter(center.id).length > 0, `centre vide : ${center.id}`);
  }
  // Le PCG donne 65 comptes au F&B et 46 au RPOI ; la redevance de marque
  // est reclassée de l'un vers l'autre (voir CENTER_OVERRIDES).
  assert.equal(accountsOfCenter('F&B').length, 64);
  assert.equal(accountsOfCenter('RPOI').length, 47);
});

test('les comptes des groupes de ratios existent tous', () => {
  for (const group of Object.values(RATIO_GROUPS)) {
    for (const account of group) {
      assert.ok(findAccount(account), `compte de ratio absent du plan : ${account}`);
    }
  }
});

test('la recherche accepte le numéro 2026, l’historique et le libellé', () => {
  assert.equal(searchAccounts('60101100')[0]?.account, '60101100');
  assert.equal(searchAccounts('601101')[0]?.account, '60101100');   // ancien numéro
  assert.ok(searchAccounts('achats boissons').some((a) => a.account === '60101100'));
  assert.equal(searchAccounts('   ').length, 0);
});

test('les comptes fusionnés gardent leurs libellés d’origine', () => {
  const tva = findAccount('63520900');
  assert.ok(tva);
  assert.deepEqual(tva!.legacy, ['791109', '791309']);
  assert.deepEqual(tva!.variants, ['TVA offerts 20%', 'TVA offerts 10%']);
});

/* ---------------- agrégation ---------------- */

test('GOP exclut RPOI, EBITDA l’inclut', () => {
  const s = summarize([
    line('70101100', 'Bar — soirées', 1000),     // produit
    line('60101100', 'Boissons — cave', 300),    // charge F&B (dans le GOP)
    line('61320900', 'Loyer principal', 200),    // charge RPOI (hors GOP)
  ]);
  assert.equal(total(s.produits), 12000);
  assert.equal(total(s.charges), 6000);
  assert.equal(total(s.chargesGop), 3600);
  assert.equal(total(s.otherTaxes), 2400);
  // GOP = 12000 − 3600 ; EBITDA = 12000 − 6000
  assert.equal(total(s.gop), 8400);
  assert.equal(total(s.ebitda), 6000);
  // Mois par mois aussi, pas seulement en cumul.
  assert.equal(s.gop[0], 700);
  assert.equal(s.ebitda[0], 500);
});

test('la ventilation par centre et par catégorie retombe sur les totaux', () => {
  const s = summarize([
    line('60101100', 'Boissons', 100),        // F&B
    line('62110900', 'Intérim', 50),          // RPOI
    line('64901900', 'Avantages en nature', 25), // RPOI
  ]);
  assert.equal(total(s.byCenter['F&B']), 1200);
  assert.equal(total(s.byCenter.RPOI), 900);
  assert.equal(total(s.byCategory['Operating charge']), 1200);
  assert.equal(total(s.byCategory['Other Taxes']), 900);
  const parCentre = COST_CENTERS.reduce((sum, c) => sum + total(s.byCenter[c.id]), 0);
  assert.equal(parCentre, total(s.charges));
});

test('deux lignes nommées s’additionnent sur le même compte', () => {
  const s = summarize([
    line('60101100', 'Cave — vins', 100),
    line('60101100', 'Cave — spiritueux', 40),
  ]);
  assert.equal(total(s.byAccount['60101100']), 1680);
  assert.equal(total(s.charges), 1680);
});

test('une ligne sans nom est refusée : traçabilité obligatoire', () => {
  const s = summarize([
    line('60101100', '   ', 500),
    line('60101100', 'Cave', 100),
  ]);
  assert.equal(s.rejected.length, 1);
  assert.match(s.rejected[0].reason, /sans nom/);
  assert.equal(total(s.charges), 1200); // seule la ligne nommée compte
});

test('compte inconnu, compte de bilan et compte à classer sont refusés', () => {
  const s = summarize([
    line('99999999', 'Compte imaginaire', 100),
    line('10100000', 'Capital', 100),       // bilan
    line('61110100', 'Sous-traitance groupe', 100), // charge sans centre
  ]);
  assert.equal(s.rejected.length, 3);
  assert.match(s.rejected[0].reason, /absent du plan/);
  assert.match(s.rejected[1].reason, /bilan/);
  assert.match(s.rejected[2].reason, /à classer/);
  assert.equal(total(s.charges), 0);
});

test('ratios coût Food, coût Bev et marge brute', () => {
  const s = summarize([
    line('70105100', 'Petit-déjeuner', 1000),   // CA Food
    line('70101100', 'Bar', 500),               // CA Bev
    line('60103100', 'Denrées', 300),           // coût Food
    line('60101100', 'Boissons', 100),          // coût Bev
  ]);
  assert.equal(s.ratios.food, 0.3);
  assert.equal(s.ratios.beverage, 0.2);
  // (18000 − 3600 − 1200) / 18000
  assert.ok(Math.abs(s.ratios.grossMargin! - 13200 / 18000) < 1e-9);
});

test('sans chiffre d’affaires, les ratios valent null au lieu de diviser par zéro', () => {
  const s = summarize([line('60103100', 'Denrées', 100)]);
  assert.equal(s.ratios.food, null);
  assert.equal(s.ratios.beverage, null);
  assert.equal(s.ratios.grossMargin, null);
});

test('un budget vide donne un P&L à zéro, pas une erreur', () => {
  const s = summarize([]);
  assert.equal(total(s.produits), 0);
  assert.equal(total(s.ebitda), 0);
  assert.equal(s.rejected.length, 0);
  assert.equal(s.gop.length, MONTHS);
});

/* ---------------- budget réel importé ---------------- */

test('la redevance de marque est reclassée hors GOP', () => {
  assert.equal(CENTER_OVERRIDES['65123100'], 'RPOI');
  const account = findAccount('65123100');
  assert.ok(account);
  assert.equal(account!.center, 'RPOI');
  assert.equal(categoryOf(account!), 'Other Taxes');
});

test('le budget PATIO 2026 reproduit le P&L du classeur Excel', () => {
  assert.equal(BUDGET_COMPANY, 'LPM test');
  assert.ok(BUDGET_LINES.length > 50, 'budget vide');
  const s = summarize(BUDGET_LINES);
  // Aucune ligne écartée : chaque compte du budget est connu et classé.
  assert.deepEqual(s.rejected.map((r) => r.reason), []);
  // Chaque ligne est nommée — la règle de traçabilité tient sur données réelles.
  assert.ok(BUDGET_LINES.every((line) => line.name.trim().length > 0));

  const near = (mine: number, theirs: number, label: string) => assert.ok(
    Math.abs(mine - theirs) < 1,
    `${label} : ${Math.round(mine)} contre ${Math.round(theirs)} dans le classeur`,
  );
  near(total(s.produits), BUDGET_CONTROLS.revenue, 'produits');
  near(total(s.charges), BUDGET_CONTROLS.charges, 'charges');
  near(total(s.otherTaxes), BUDGET_CONTROLS.otherTaxes, 'Other Taxes');
  near(total(s.gop), BUDGET_CONTROLS.gop, 'GOP');
  near(total(s.ebitda), BUDGET_CONTROLS.ebitda, 'EBITDA');
});

test('le budget se ventile sur tous les centres attendus', () => {
  const s = summarize(BUDGET_LINES);
  // F&B, HR, AG, MARK, POMEC, IT, MAT et RPOI portent des montants ;
  // Sécurité est à zéro dans ce budget.
  for (const id of ['F&B', 'HR', 'AG', 'MARK', 'POMEC', 'IT', 'MAT', 'RPOI'] as const) {
    assert.ok(total(s.byCenter[id]) > 0, `centre sans montant : ${id}`);
  }
  assert.equal(total(s.byCenter.SECU), 0);
  // La somme des centres, plus la masse salariale (sortie des centres
  // depuis le 03/08/2026 — elle n'apparaît plus qu'une fois, sur sa
  // propre ligne Payroll, pas aussi noyée dans chaque centre), retombe
  // sur le total des charges.
  assert.ok(Math.abs(
    COST_CENTERS.reduce((sum, c) => sum + total(s.byCenter[c.id]), 0) + total(s.payroll) - total(s.charges),
  ) < 0.01);
});

/* ---------------- exécution ---------------- */
for (const [name, fn] of tests) {
  try { fn(); passed++; }
  catch (e) { console.error(`✗ ${name}\n  ${(e as Error).message}`); }
}
console.log(`${passed}/${tests.length} tests plan comptable passés`);
if (passed !== tests.length) process.exit(1);
