/**
 * Store de la grille : un `useReducer` unique.
 *
 * Choix : useReducer plutôt que Zustand car toute la logique métier vit
 * déjà dans `src/engine`. Le reducer se contente d'orchestrer des
 * transitions pures, ce qui rend l'historique (Ctrl+Z) trivial : il
 * suffit d'empiler la `CellMap` précédente avant toute mutation.
 */

import { cellKey } from '../engine/coords';
import { applyFill, computeFillTarget } from '../engine/fill';
import { shiftRawValue } from '../engine/refs';
import type {
  CellCoord,
  CellMap,
  CellRange,
  Clipboard,
  FillDirection,
  Selection,
} from '../types';

export const ROWS = 40;
export const COLS = 12; // A..L

export interface GridState {
  cells: CellMap;
  selection: Selection;
  /** Cellule en cours d'édition + contenu du champ (null = pas d'édition). */
  editing: { row: number; col: number; value: string } | null;
  clipboard: Clipboard | null;
  /** Zone survolée pendant le drag de la poignée (aperçu "ghost"). */
  fillPreview: { target: CellRange; direction: FillDirection } | null;
  /** true tant que le bouton est enfoncé sur la poignée. */
  fillDragging: boolean;
  /** true pendant une sélection à la souris. */
  selectDragging: boolean;
  past: CellMap[];
  future: CellMap[];
}

export type Action =
  | { type: 'SET_CELL'; row: number; col: number; raw: string }
  | { type: 'SELECT'; coord: CellCoord; extend?: boolean }
  | { type: 'MOVE'; dRow: number; dCol: number; extend?: boolean; jump?: boolean }
  | { type: 'SELECT_ALL' }
  | { type: 'START_EDIT'; row: number; col: number; initial?: string }
  | { type: 'UPDATE_EDIT'; value: string }
  | { type: 'COMMIT_EDIT'; dRow?: number; dCol?: number }
  | { type: 'CANCEL_EDIT' }
  | { type: 'CLEAR_RANGE' }
  | { type: 'COPY'; cut?: boolean }
  | { type: 'PASTE'; text?: string }
  | { type: 'FILL_START' }
  | { type: 'FILL_HOVER'; coord: CellCoord }
  | { type: 'FILL_COMMIT' }
  | { type: 'SELECT_DRAG'; dragging: boolean }
  | { type: 'UNDO' }
  | { type: 'REDO' };

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Rectangle normalisé couvert par la sélection. */
export function selectionRange(sel: Selection): CellRange {
  return {
    r1: Math.min(sel.anchor.row, sel.focus.row),
    r2: Math.max(sel.anchor.row, sel.focus.row),
    c1: Math.min(sel.anchor.col, sel.focus.col),
    c2: Math.max(sel.anchor.col, sel.focus.col),
  };
}

export function inRange(range: CellRange, row: number, col: number): boolean {
  return row >= range.r1 && row <= range.r2 && col >= range.c1 && col <= range.c2;
}

const clampRow = (r: number) => Math.max(0, Math.min(ROWS - 1, r));
const clampCol = (c: number) => Math.max(0, Math.min(COLS - 1, c));

/** Empile l'état courant dans l'historique avant une mutation. */
function pushHistory(state: GridState): Pick<GridState, 'past' | 'future'> {
  return { past: [...state.past.slice(-99), state.cells], future: [] };
}

function getRaw(cells: CellMap, row: number, col: number): string {
  return cells[cellKey(row, col)]?.rawValue ?? '';
}

function setRaw(cells: CellMap, row: number, col: number, raw: string): CellMap {
  const next = { ...cells };
  const key = cellKey(row, col);
  if (raw === '') delete next[key];
  else next[key] = { rawValue: raw };
  return next;
}

/* ------------------------------------------------------------------ */
/* Presse-papier                                                       */
/* ------------------------------------------------------------------ */

/**
 * Construit le contenu copié : on mémorise les valeurs BRUTES (formules
 * comprises) afin de pouvoir décaler les références au collage, ainsi
 * qu'une version TSV pour l'échange avec les applications externes.
 */
function buildClipboard(cells: CellMap, range: CellRange, cut: boolean): Clipboard {
  const rawValues: string[][] = [];
  for (let r = range.r1; r <= range.r2; r++) {
    const row: string[] = [];
    for (let c = range.c1; c <= range.c2; c++) row.push(getRaw(cells, r, c));
    rawValues.push(row);
  }
  return { range, rawValues, cut, tsv: rawValues.map((r) => r.join('\t')).join('\n') };
}

/* ------------------------------------------------------------------ */
/* Reducer                                                             */
/* ------------------------------------------------------------------ */

export function gridReducer(state: GridState, action: Action): GridState {
  switch (action.type) {
    /* ----- saisie ----- */
    case 'SET_CELL': {
      return {
        ...state,
        ...pushHistory(state),
        cells: setRaw(state.cells, action.row, action.col, action.raw),
      };
    }

    case 'START_EDIT':
      return {
        ...state,
        editing: {
          row: action.row,
          col: action.col,
          value: action.initial !== undefined ? action.initial : getRaw(state.cells, action.row, action.col),
        },
      };

    case 'UPDATE_EDIT':
      return state.editing ? { ...state, editing: { ...state.editing, value: action.value } } : state;

    case 'COMMIT_EDIT': {
      if (!state.editing) return state;
      const { row, col, value } = state.editing;
      // Valider sans avoir rien changé (F2 puis Entrée) ne doit pas créer
      // une étape d'historique : Ctrl+Z deviendrait un coup dans le vide.
      const unchanged = getRaw(state.cells, row, col) === value;
      const target = {
        row: clampRow(row + (action.dRow ?? 0)),
        col: clampCol(col + (action.dCol ?? 0)),
      };
      return {
        ...state,
        ...(unchanged ? null : pushHistory(state)),
        cells: unchanged ? state.cells : setRaw(state.cells, row, col, value),
        editing: null,
        selection: { anchor: target, focus: target },
      };
    }

    case 'CANCEL_EDIT':
      return { ...state, editing: null };

    /* ----- sélection ----- */
    case 'SELECT': {
      const coord = { row: clampRow(action.coord.row), col: clampCol(action.coord.col) };
      return {
        ...state,
        editing: null,
        selection: action.extend
          ? { anchor: state.selection.anchor, focus: coord }
          : { anchor: coord, focus: coord },
      };
    }

    case 'MOVE': {
      const { focus, anchor } = state.selection;
      const step = action.jump ? 1000 : 1;
      const coord = {
        row: clampRow(focus.row + action.dRow * step),
        col: clampCol(focus.col + action.dCol * step),
      };
      return {
        ...state,
        editing: null,
        selection: action.extend ? { anchor, focus: coord } : { anchor: coord, focus: coord },
      };
    }

    case 'SELECT_ALL':
      return {
        ...state,
        selection: { anchor: { row: 0, col: 0 }, focus: { row: ROWS - 1, col: COLS - 1 } },
      };

    case 'SELECT_DRAG':
      return { ...state, selectDragging: action.dragging };

    /* ----- effacement ----- */
    case 'CLEAR_RANGE': {
      const range = selectionRange(state.selection);
      let cells = state.cells;
      let touched = false;
      for (let r = range.r1; r <= range.r2; r++) {
        for (let c = range.c1; c <= range.c2; c++) {
          if (getRaw(cells, r, c) === '') continue; // déjà vide
          cells = setRaw(cells, r, c, '');
          touched = true;
        }
      }
      // Effacer une zone déjà vide n'ajoute pas d'étape d'historique.
      if (!touched) return state;
      return { ...state, ...pushHistory(state), cells };
    }

    /* ----- copier / couper ----- */
    case 'COPY': {
      const range = selectionRange(state.selection);
      return { ...state, clipboard: buildClipboard(state.cells, range, action.cut ?? false) };
    }

    /* ----- coller ----- */
    case 'PASTE': {
      const dest = selectionRange(state.selection);
      const clip = state.clipboard;
      let cells = state.cells;

      // Collage interne : on dispose des formules d'origine, on décale
      // donc les références relatives selon le déplacement du rectangle.
      const isInternal = clip && (action.text === undefined || action.text === clip.tsv);

      if (isInternal && clip) {
        const dRow = dest.r1 - clip.range.r1;
        const dCol = dest.c1 - clip.range.c1;

        if (clip.cut) {
          for (let r = clip.range.r1; r <= clip.range.r2; r++)
            for (let c = clip.range.c1; c <= clip.range.c2; c++) cells = setRaw(cells, r, c, '');
        }

        clip.rawValues.forEach((rowVals, dr) => {
          rowVals.forEach((raw, dc) => {
            const row = dest.r1 + dr;
            const col = dest.c1 + dc;
            if (row >= ROWS || col >= COLS) return;
            cells = setRaw(cells, row, col, shiftRawValue(raw, dRow, dCol, ROWS, COLS));
          });
        });

        return {
          ...state,
          ...pushHistory(state),
          cells,
          clipboard: clip.cut ? null : clip,
          selection: {
            anchor: { row: dest.r1, col: dest.c1 },
            focus: {
              row: clampRow(dest.r1 + clip.rawValues.length - 1),
              col: clampCol(dest.c1 + (clip.rawValues[0]?.length ?? 1) - 1),
            },
          },
        };
      }

      // Collage externe (Excel, Sheets, éditeur de texte) : TSV brut.
      if (!action.text) return state;
      const rows = action.text.replace(/\r/g, '').split('\n');
      if (rows.length && rows[rows.length - 1] === '') rows.pop();
      rows.forEach((line, dr) => {
        line.split('\t').forEach((val, dc) => {
          const row = dest.r1 + dr;
          const col = dest.c1 + dc;
          if (row >= ROWS || col >= COLS) return;
          cells = setRaw(cells, row, col, val.trim());
        });
      });
      return {
        ...state,
        ...pushHistory(state),
        cells,
        selection: {
          anchor: { row: dest.r1, col: dest.c1 },
          focus: {
            row: clampRow(dest.r1 + rows.length - 1),
            col: clampCol(dest.c1 + (rows[0]?.split('\t').length ?? 1) - 1),
          },
        },
      };
    }

    /* ----- poignée de recopie ----- */
    case 'FILL_START':
      return { ...state, fillDragging: true, fillPreview: null };

    case 'FILL_HOVER': {
      if (!state.fillDragging) return state;
      const source = selectionRange(state.selection);
      const preview = computeFillTarget(source, action.coord);
      return { ...state, fillPreview: preview };
    }

    case 'FILL_COMMIT': {
      if (!state.fillPreview) return { ...state, fillDragging: false, fillPreview: null };
      const source = selectionRange(state.selection);
      const { target, direction } = state.fillPreview;
      const result = applyFill(state.cells, source, target, direction, ROWS, COLS);
      return {
        ...state,
        ...pushHistory(state),
        cells: result.cells,
        fillDragging: false,
        fillPreview: null,
        selection: {
          anchor: { row: result.range.r1, col: result.range.c1 },
          focus: { row: result.range.r2, col: result.range.c2 },
        },
      };
    }

    /* ----- historique ----- */
    case 'UNDO': {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      return {
        ...state,
        cells: previous,
        past: state.past.slice(0, -1),
        future: [state.cells, ...state.future].slice(0, 100),
        editing: null,
      };
    }

    case 'REDO': {
      if (state.future.length === 0) return state;
      const next = state.future[0];
      return {
        ...state,
        cells: next,
        past: [...state.past, state.cells],
        future: state.future.slice(1),
        editing: null,
      };
    }

    default:
      return state;
  }
}

export function createInitialState(cells: CellMap): GridState {
  return {
    cells,
    selection: { anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } },
    editing: null,
    clipboard: null,
    fillPreview: null,
    fillDragging: false,
    selectDragging: false,
    past: [],
    future: [],
  };
}
