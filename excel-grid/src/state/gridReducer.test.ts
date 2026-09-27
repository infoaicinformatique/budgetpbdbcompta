/**
 * Tests du reducer : saisie, sélection, copier-coller (avec décalage des
 * références), recopie et historique.
 *   node --experimental-strip-types src/state/gridReducer.test.ts
 */
import assert from 'node:assert';
import { cellKey, parseRef } from '../engine/coords.ts';
import { computeGrid } from '../engine/evaluate.ts';
import {
  createInitialState,
  gridReducer,
  selectionRange,
  type Action,
  type GridState,
} from './gridReducer.ts';
import type { CellMap } from '../types.ts';

let passed = 0;
const tests: [string, () => void][] = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

const coord = (ref: string) => {
  const p = parseRef(ref)!;
  return { row: p.row, col: p.col };
};
const raw = (s: GridState, ref: string) => {
  const c = coord(ref);
  return s.cells[cellKey(c.row, c.col)]?.rawValue ?? '';
};
const value = (s: GridState, ref: string) => {
  const c = coord(ref);
  return computeGrid(s.cells)[cellKey(c.row, c.col)]?.value ?? '';
};
const run = (state: GridState, ...actions: Action[]) =>
  actions.reduce((s, a) => gridReducer(s, a), state);

const start = (entries: Record<string, string> = {}): GridState => {
  const cells: CellMap = {};
  for (const [ref, v] of Object.entries(entries)) {
    const c = coord(ref);
    cells[cellKey(c.row, c.col)] = { rawValue: v };
  }
  return createInitialState(cells);
};

/* ---------------- saisie ---------------- */
test('saisie via START_EDIT / COMMIT_EDIT', () => {
  const s = run(start(),
    { type: 'SELECT', coord: coord('B2') },
    { type: 'START_EDIT', row: 1, col: 1, initial: '1' },
    { type: 'UPDATE_EDIT', value: '12' },
    { type: 'UPDATE_EDIT', value: '125' },
    { type: 'COMMIT_EDIT', dRow: 1, dCol: 0 },
  );
  assert.equal(raw(s, 'B2'), '125');
  assert.equal(value(s, 'B2'), 125);
  // le curseur descend d'une ligne, comme Excel
  assert.deepEqual(s.selection.focus, { row: 2, col: 1 });
  assert.equal(s.editing, null);
});

test('Échap annule la saisie', () => {
  const s = run(start({ A1: '5' }),
    { type: 'START_EDIT', row: 0, col: 0, initial: '9' },
    { type: 'CANCEL_EDIT' },
  );
  assert.equal(raw(s, 'A1'), '5');
});

/* ---------------- sélection ---------------- */
test('Maj+clic étend la sélection depuis l’ancre', () => {
  const s = run(start(),
    { type: 'SELECT', coord: coord('B2') },
    { type: 'SELECT', coord: coord('D5'), extend: true },
  );
  assert.deepEqual(selectionRange(s.selection), { r1: 1, c1: 1, r2: 4, c2: 3 });
});

test('sélection normalisée si on remonte vers le haut-gauche', () => {
  const s = run(start(),
    { type: 'SELECT', coord: coord('D5') },
    { type: 'SELECT', coord: coord('B2'), extend: true },
  );
  assert.deepEqual(selectionRange(s.selection), { r1: 1, c1: 1, r2: 4, c2: 3 });
});

test('les déplacements restent dans la grille', () => {
  const s = run(start(), { type: 'MOVE', dRow: -1, dCol: -1 });
  assert.deepEqual(s.selection.focus, { row: 0, col: 0 });
});

/* ---------------- effacement ---------------- */
test('Suppr efface toute la plage sélectionnée', () => {
  const s = run(start({ A1: '1', B1: '2', A2: '3', B2: '4' }),
    { type: 'SELECT', coord: coord('A1') },
    { type: 'SELECT', coord: coord('B2'), extend: true },
    { type: 'CLEAR_RANGE' },
  );
  assert.equal(raw(s, 'A1'), '');
  assert.equal(raw(s, 'B2'), '');
});

/* ---------------- copier / coller ---------------- */
test('copier-coller une formule décale les références', () => {
  // C1 = A1+B1 ; on le colle en C2 -> doit devenir =A2+B2
  const s = run(start({ A1: '1', B1: '2', A2: '10', B2: '20', C1: '=A1+B1' }),
    { type: 'SELECT', coord: coord('C1') },
    { type: 'COPY' },
    { type: 'SELECT', coord: coord('C2') },
    { type: 'PASTE' },
  );
  assert.equal(raw(s, 'C2'), '=A2+B2');
  assert.equal(value(s, 'C2'), 30);
  // l'original est intact
  assert.equal(raw(s, 'C1'), '=A1+B1');
});

test('copier-coller conserve la forme rectangulaire', () => {
  const s = run(start({ A1: '1', B1: '2', A2: '3', B2: '4' }),
    { type: 'SELECT', coord: coord('A1') },
    { type: 'SELECT', coord: coord('B2'), extend: true },
    { type: 'COPY' },
    { type: 'SELECT', coord: coord('D5') },
    { type: 'PASTE' },
  );
  assert.equal(raw(s, 'D5'), '1');
  assert.equal(raw(s, 'E5'), '2');
  assert.equal(raw(s, 'D6'), '3');
  assert.equal(raw(s, 'E6'), '4');
  // la sélection couvre la zone collée
  assert.deepEqual(selectionRange(s.selection), { r1: 4, c1: 3, r2: 5, c2: 4 });
});

test('les références absolues ne bougent pas au collage', () => {
  const s = run(start({ A1: '7', C1: '=$A$1*2' }),
    { type: 'SELECT', coord: coord('C1') },
    { type: 'COPY' },
    { type: 'SELECT', coord: coord('D3') },
    { type: 'PASTE' },
  );
  assert.equal(raw(s, 'D3'), '=$A$1*2');
  assert.equal(value(s, 'D3'), 14);
});

test('couper puis coller vide la source', () => {
  const s = run(start({ A1: 'x' }),
    { type: 'SELECT', coord: coord('A1') },
    { type: 'COPY', cut: true },
    { type: 'SELECT', coord: coord('B1') },
    { type: 'PASTE' },
  );
  assert.equal(raw(s, 'A1'), '');
  assert.equal(raw(s, 'B1'), 'x');
  assert.equal(s.clipboard, null);
});

test('collage externe au format TSV', () => {
  const s = run(start(),
    { type: 'SELECT', coord: coord('A1') },
    { type: 'PASTE', text: '1\t2\n3\t4\n' },
  );
  assert.equal(raw(s, 'A1'), '1');
  assert.equal(raw(s, 'B1'), '2');
  assert.equal(raw(s, 'A2'), '3');
  assert.equal(raw(s, 'B2'), '4');
});

test('le collage est tronqué aux limites de la grille', () => {
  const s = run(start(),
    { type: 'SELECT', coord: coord('L1') }, // dernière colonne
    { type: 'PASTE', text: '1\t2\t3' },
  );
  assert.equal(raw(s, 'L1'), '1');
  assert.equal(Object.keys(s.cells).length, 1); // les 2 autres sont hors grille
});

/* ---------------- recopie ---------------- */
test('recopie : aperçu puis validation', () => {
  let s = start({ A1: '1' });
  s = run(s,
    { type: 'SELECT', coord: coord('A1') },
    { type: 'FILL_START' },
    { type: 'FILL_HOVER', coord: coord('A4') },
  );
  assert.deepEqual(s.fillPreview?.target, { c1: 0, c2: 0, r1: 1, r2: 3 });
  assert.equal(s.fillPreview?.direction, 'down');

  s = gridReducer(s, { type: 'FILL_COMMIT' });
  assert.equal(raw(s, 'A2'), '2');
  assert.equal(raw(s, 'A3'), '3');
  assert.equal(raw(s, 'A4'), '4');
  assert.equal(s.fillDragging, false);
  // la sélection englobe source + zone remplie
  assert.deepEqual(selectionRange(s.selection), { r1: 0, c1: 0, r2: 3, c2: 0 });
});

test('recopie d’une formule vers le bas', () => {
  let s = start({ A1: '2', B1: '3', C1: '=A1*B1', A2: '4', B2: '5' });
  s = run(s,
    { type: 'SELECT', coord: coord('C1') },
    { type: 'FILL_START' },
    { type: 'FILL_HOVER', coord: coord('C2') },
    { type: 'FILL_COMMIT' },
  );
  assert.equal(raw(s, 'C2'), '=A2*B2');
  assert.equal(value(s, 'C2'), 20);
});

test('FILL_HOVER ignoré si le glissement n’a pas démarré', () => {
  const s = run(start({ A1: '1' }), { type: 'FILL_HOVER', coord: coord('A5') });
  assert.equal(s.fillPreview, null);
});

/* ---------------- historique ---------------- */
test('Ctrl+Z annule une saisie', () => {
  let s = run(start({ A1: 'avant' }),
    { type: 'START_EDIT', row: 0, col: 0, initial: 'après' },
    { type: 'COMMIT_EDIT' },
  );
  assert.equal(raw(s, 'A1'), 'après');
  s = gridReducer(s, { type: 'UNDO' });
  assert.equal(raw(s, 'A1'), 'avant');
});

test('Ctrl+Z annule un collage, Ctrl+Y le rétablit', () => {
  let s = run(start({ A1: '1' }),
    { type: 'SELECT', coord: coord('A1') },
    { type: 'COPY' },
    { type: 'SELECT', coord: coord('B1') },
    { type: 'PASTE' },
  );
  assert.equal(raw(s, 'B1'), '1');
  s = gridReducer(s, { type: 'UNDO' });
  assert.equal(raw(s, 'B1'), '');
  s = gridReducer(s, { type: 'REDO' });
  assert.equal(raw(s, 'B1'), '1');
});

test('Ctrl+Z annule une recopie', () => {
  let s = run(start({ A1: '1' }),
    { type: 'SELECT', coord: coord('A1') },
    { type: 'FILL_START' },
    { type: 'FILL_HOVER', coord: coord('A3') },
    { type: 'FILL_COMMIT' },
  );
  assert.equal(raw(s, 'A3'), '3');
  s = gridReducer(s, { type: 'UNDO' });
  assert.equal(raw(s, 'A3'), '');
  assert.equal(raw(s, 'A1'), '1');
});

test('valider sans modifier ne crée pas d’étape d’historique', () => {
  const s = run(start({ A1: 'Loyer' }),
    { type: 'START_EDIT', row: 0, col: 0 },   // F2 : reprend la valeur existante
    { type: 'COMMIT_EDIT' },                  // Entrée : rien n'a changé
  );
  assert.equal(s.past.length, 0);
  assert.equal(raw(s, 'A1'), 'Loyer');
});

test('effacer une zone déjà vide ne crée pas d’étape d’historique', () => {
  const s = run(start({ A1: '1' }),
    { type: 'SELECT', coord: coord('D5') },
    { type: 'CLEAR_RANGE' },
  );
  assert.equal(s.past.length, 0);

  const t = run(start({ A1: '1' }),
    { type: 'SELECT', coord: coord('A1') },
    { type: 'CLEAR_RANGE' },
  );
  assert.equal(t.past.length, 1);
  assert.equal(raw(t, 'A1'), '');
});

test('UNDO sans historique ne casse rien', () => {
  const s = gridReducer(start({ A1: '1' }), { type: 'UNDO' });
  assert.equal(raw(s, 'A1'), '1');
});

/* ---------------- exécution ---------------- */
for (const [name, fn] of tests) {
  try { fn(); passed++; }
  catch (e) { console.error(`✗ ${name}\n  ${(e as Error).message}`); }
}
console.log(`${passed}/${tests.length} tests reducer passés`);
if (passed !== tests.length) process.exit(1);
