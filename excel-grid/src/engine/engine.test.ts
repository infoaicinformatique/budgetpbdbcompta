/**
 * Tests du moteur, exécutables sans dépendances :
 *   node --experimental-strip-types src/engine/engine.test.ts
 */
import assert from 'node:assert';
import { colToLabel, labelToCol, parseRef, formatRef, cellKey } from './coords.ts';
import { computeGrid, evaluateRaw, parseLiteral } from './evaluate.ts';
import { shiftFormula, shiftRawValue } from './refs.ts';
import { detectSeries, seriesValueAt, applyFill, computeFillTarget, parseDate } from './fill.ts';
import type { CellMap } from '../types.ts';

let passed = 0;
const tests: [string, () => void][] = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

const grid = (entries: Record<string, string>): CellMap => {
  const m: CellMap = {};
  for (const [ref, raw] of Object.entries(entries)) {
    const p = parseRef(ref)!;
    m[cellKey(p.row, p.col)] = { rawValue: raw };
  }
  return m;
};
const valueAt = (cells: CellMap, ref: string) => {
  const p = parseRef(ref)!;
  return computeGrid(cells)[cellKey(p.row, p.col)]?.value;
};
const rawAt = (cells: CellMap, ref: string) => {
  const p = parseRef(ref)!;
  return cells[cellKey(p.row, p.col)]?.rawValue ?? '';
};

/* ---------------- coordonnées ---------------- */
test('colToLabel / labelToCol', () => {
  assert.equal(colToLabel(0), 'A');
  assert.equal(colToLabel(25), 'Z');
  assert.equal(colToLabel(26), 'AA');
  assert.equal(labelToCol('A'), 0);
  assert.equal(labelToCol('AA'), 26);
});

test('parseRef gère les $ absolus', () => {
  assert.deepEqual(parseRef('A1'), { row: 0, col: 0, absRow: false, absCol: false });
  assert.deepEqual(parseRef('$B$3'), { row: 2, col: 1, absRow: true, absCol: true });
  assert.equal(formatRef({ row: 2, col: 1, absRow: true, absCol: true }), '$B$3');
  assert.equal(parseRef('A0'), null);
});

/* ---------------- littéraux ---------------- */
test('parseLiteral : nombres FR et texte', () => {
  assert.equal(parseLiteral('12'), 12);
  assert.equal(parseLiteral('12,5'), 12.5);
  assert.equal(parseLiteral('1 500'), 1500);
  assert.equal(parseLiteral('Loyer'), 'Loyer');
  assert.equal(parseLiteral(''), '');
});

/* ---------------- formules ---------------- */
test('arithmétique et priorités', () => {
  const g = grid({ A1: '2', B1: '3' });
  assert.equal(valueAt(g, 'A1'), 2);
  assert.equal(evaluateRaw('=1+2*3', () => 0), 7);
  assert.equal(evaluateRaw('=(1+2)*3', () => 0), 9);
  assert.equal(evaluateRaw('=10/4', () => 0), 2.5);
  assert.equal(evaluateRaw('=-3+1', () => 0), -2);
});

test('références simples entre cellules', () => {
  const g = grid({ A1: '10', B1: '5', C1: '=A1+B2', B2: '7' });
  assert.equal(valueAt(g, 'C1'), 17);
});

test('=A1*2 et chaînage de formules', () => {
  const g = grid({ A1: '4', A2: '=A1*2', A3: '=A2*2' });
  assert.equal(valueAt(g, 'A2'), 8);
  assert.equal(valueAt(g, 'A3'), 16);
});

test('SUM et MOYENNE sur une plage', () => {
  const g = grid({ A1: '1', A2: '2', A3: '3', A4: '4', A5: '5', B1: '=SUM(A1:A5)', B2: '=MOYENNE(A1:A5)' });
  assert.equal(valueAt(g, 'B1'), 15);
  assert.equal(valueAt(g, 'B2'), 3);
});

test('fonctions avec arguments multiples et séparateur ;', () => {
  const g = grid({ A1: '1', A2: '2', B1: '=SUM(A1:A2;10)', B2: '=MAX(A1:A2)', B3: '=MIN(A1:A2)' });
  assert.equal(valueAt(g, 'B1'), 13);
  assert.equal(valueAt(g, 'B2'), 2);
  assert.equal(valueAt(g, 'B3'), 1);
});

test('SUM ignore le texte, comme Excel', () => {
  const g = grid({ A1: '1', A2: 'texte', A3: '2', B1: '=SUM(A1:A3)' });
  assert.equal(valueAt(g, 'B1'), 3);
});

test('erreurs : division par zéro, nom inconnu, cycle', () => {
  assert.equal(valueAt(grid({ A1: '=1/0' }), 'A1'), '#DIV/0!');
  assert.equal(valueAt(grid({ A1: '=BIDULE(1)' }), 'A1'), '#NOM?');
  const cyc = grid({ A1: '=B1', B1: '=A1' });
  assert.equal(valueAt(cyc, 'A1'), '#CYCLE!');
});

test('cellule vide vaut 0 dans un calcul', () => {
  assert.equal(valueAt(grid({ A1: '=Z9+5' }), 'A1'), 5);
});

/* ---------------- décalage de références ---------------- */
test('shiftFormula : décalage relatif', () => {
  assert.equal(shiftFormula('A1+B1', 0, 1), 'B1+C1');
  assert.equal(shiftFormula('A1+B1', 1, 0), 'A2+B2');
  assert.equal(shiftFormula('SUM(A1:A5)', 0, 2), 'SUM(C1:C5)');
});

test('shiftFormula : $ fige la référence', () => {
  assert.equal(shiftFormula('$A1*2', 0, 3), '$A1*2');
  assert.equal(shiftFormula('A$1*2', 5, 0), 'A$1*2');
  assert.equal(shiftFormula('$A$1*2', 4, 4), '$A$1*2');
});

test('shiftFormula : hors grille -> #REF!', () => {
  assert.equal(shiftFormula('A1*2', 0, -1), '#REF!*2');
});

test('shiftFormula ne touche pas au texte entre guillemets', () => {
  assert.equal(shiftFormula('"A1 fixe"&A1', 0, 1), '"A1 fixe"&B1');
});

test('shiftRawValue laisse les littéraux intacts', () => {
  assert.equal(shiftRawValue('42', 3, 3), '42');
  assert.equal(shiftRawValue('Loyer', 3, 3), 'Loyer');
  assert.equal(shiftRawValue('=A1', 1, 0), '=A2');
});

/* ---------------- séries ---------------- */
test('detectSeries : nombre unique -> pas de 1', () => {
  const s = detectSeries(['1'])!;
  assert.equal(s.kind, 'number');
  assert.equal(seriesValueAt(s, 1), '2');
  assert.equal(seriesValueAt(s, 2), '3');
});

test('detectSeries : deux nombres -> pas déduit', () => {
  const s = detectSeries(['10', '20'])!;
  assert.equal(seriesValueAt(s, 2), '30');
  assert.equal(seriesValueAt(s, 3), '40');
});

test('detectSeries : dates jj/mm', () => {
  assert.ok(parseDate('01/01'));
  const s = detectSeries(['01/01'])!;
  assert.equal(s.kind, 'date');
  assert.equal(seriesValueAt(s, 1), '02/01');
  assert.equal(seriesValueAt(s, 2), '03/01');
});

test('detectSeries : dates jj/mm/aaaa avec passage de mois', () => {
  const s = detectSeries(['30/01/2027'])!;
  assert.equal(seriesValueAt(s, 1), '31/01/2027');
  assert.equal(seriesValueAt(s, 2), '01/02/2027');
});

test('detectSeries : texte et formules -> pas de série', () => {
  assert.equal(detectSeries(['Loyer']), null);
  assert.equal(detectSeries(['=A1']), null);
  assert.equal(detectSeries(['1', 'texte']), null);
});

/* ---------------- recopie ---------------- */
test('applyFill : nombres vers la droite', () => {
  const g = grid({ A1: '1' });
  const r = applyFill(g, { r1: 0, c1: 0, r2: 0, c2: 0 }, { r1: 0, c1: 1, r2: 0, c2: 3 }, 'right', 50, 26);
  assert.equal(rawAt(r.cells, 'B1'), '2');
  assert.equal(rawAt(r.cells, 'C1'), '3');
  assert.equal(rawAt(r.cells, 'D1'), '4');
});

test('applyFill : texte recopié tel quel', () => {
  const g = grid({ A1: 'Loyer' });
  const r = applyFill(g, { r1: 0, c1: 0, r2: 0, c2: 0 }, { r1: 0, c1: 1, r2: 0, c2: 2 }, 'right', 50, 26);
  assert.equal(rawAt(r.cells, 'B1'), 'Loyer');
  assert.equal(rawAt(r.cells, 'C1'), 'Loyer');
});

test('applyFill : motif texte répété cycliquement', () => {
  const g = grid({ A1: 'X', B1: 'Y' });
  const r = applyFill(g, { r1: 0, c1: 0, r2: 0, c2: 1 }, { r1: 0, c1: 2, r2: 0, c2: 5 }, 'right', 50, 26);
  assert.equal(rawAt(r.cells, 'C1'), 'X');
  assert.equal(rawAt(r.cells, 'D1'), 'Y');
  assert.equal(rawAt(r.cells, 'E1'), 'X');
  assert.equal(rawAt(r.cells, 'F1'), 'Y');
});

test('applyFill : formule décalée vers le bas', () => {
  const g = grid({ A1: '5', B1: '3', C1: '=A1+B1' });
  const r = applyFill(g, { r1: 0, c1: 2, r2: 0, c2: 2 }, { r1: 1, c1: 2, r2: 2, c2: 2 }, 'down', 50, 26);
  assert.equal(rawAt(r.cells, 'C2'), '=A2+B2');
  assert.equal(rawAt(r.cells, 'C3'), '=A3+B3');
});

test('applyFill : formule décalée vers la droite', () => {
  const g = grid({ A1: '2', A2: '=A1*2' });
  const r = applyFill(g, { r1: 1, c1: 0, r2: 1, c2: 0 }, { r1: 1, c1: 1, r2: 1, c2: 2 }, 'right', 50, 26);
  assert.equal(rawAt(r.cells, 'B2'), '=B1*2');
  assert.equal(rawAt(r.cells, 'C2'), '=C1*2');
});

test('applyFill : plusieurs lignes en parallèle', () => {
  const g = grid({ A1: '1', A2: '10' });
  const r = applyFill(g, { r1: 0, c1: 0, r2: 1, c2: 0 }, { r1: 0, c1: 1, r2: 1, c2: 2 }, 'right', 50, 26);
  assert.equal(rawAt(r.cells, 'B1'), '2');
  assert.equal(rawAt(r.cells, 'C1'), '3');
  assert.equal(rawAt(r.cells, 'B2'), '11');
  assert.equal(rawAt(r.cells, 'C2'), '12');
});

test('applyFill : recopie vers la gauche décrémente', () => {
  const g = grid({ C1: '10', D1: '20' });
  const r = applyFill(g, { r1: 0, c1: 2, r2: 0, c2: 3 }, { r1: 0, c1: 0, r2: 0, c2: 1 }, 'left', 50, 26);
  assert.equal(rawAt(r.cells, 'B1'), '0');
  assert.equal(rawAt(r.cells, 'A1'), '-10');
});

test('computeFillTarget : direction dominante', () => {
  const src = { r1: 0, c1: 0, r2: 0, c2: 0 };
  assert.equal(computeFillTarget(src, { row: 0, col: 3 })!.direction, 'right');
  assert.equal(computeFillTarget(src, { row: 4, col: 0 })!.direction, 'down');
  assert.equal(computeFillTarget(src, { row: 0, col: 0 }), null);
});

test('recopie puis évaluation : la somme suit', () => {
  const g = grid({ A1: '1', B1: '2', C1: '=SUM(A1:B1)' });
  const r = applyFill(g, { r1: 0, c1: 0, r2: 0, c2: 2 }, { r1: 1, c1: 0, r2: 1, c2: 2 }, 'down', 50, 26);
  assert.equal(rawAt(r.cells, 'C2'), '=SUM(A2:B2)');
  assert.equal(valueAt(r.cells, 'A2'), 2);
  assert.equal(valueAt(r.cells, 'B2'), 3);
  assert.equal(valueAt(r.cells, 'C2'), 5);
});

/* ---------------- exécution ---------------- */
for (const [name, fn] of tests) {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error(`✗ ${name}\n  ${(e as Error).message}`);
  }
}
console.log(`${passed}/${tests.length} tests passés`);
if (passed !== tests.length) process.exit(1);
