/**
 * Grille complète : en-têtes, cellules, calques (contour de copie et
 * aperçu de recopie), gestion clavier/souris et copier-coller.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ClipboardEvent,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { Cell } from './Cell';
import { FormulaBar } from './FormulaBar';
import { CELL_H, CELL_W, COL_HEAD_H, ROW_HEAD_W, rangeToRect } from './layout';
import { cellKey, colToLabel } from '../engine/coords';
import { computeGrid } from '../engine/evaluate';
import {
  COLS,
  ROWS,
  createInitialState,
  gridReducer,
  inRange,
  selectionRange,
} from '../state/gridReducer';
import { buildSampleCells } from '../data/sample';
import './grid.css';

export function Grid() {
  const [state, dispatch] = useReducer(gridReducer, buildSampleCells(), createInitialState);
  const gridRef = useRef<HTMLDivElement>(null);
  const editRef = useRef<HTMLInputElement>(null);

  /** Couche calculée, recalculée uniquement quand les saisies changent. */
  const computed = useMemo(() => computeGrid(state.cells), [state.cells]);

  // Mémoïsé : `range` sert de dépendance à plusieurs `useCallback`.
  // Recalculé à chaque rendu, il les invaliderait tous inutilement.
  const range = useMemo(() => selectionRange(state.selection), [state.selection]);
  const active = state.selection.focus;
  const activeRaw = state.cells[cellKey(active.row, active.col)]?.rawValue ?? '';

  /* ---------------------------------------------------------------- */
  /* Focus                                                             */
  /* ---------------------------------------------------------------- */

  // On ne repositionne le curseur qu'au CHANGEMENT de cellule éditée.
  // Dépendre de `state.editing` en entier resélectionnerait le texte à
  // chaque frappe : impossible alors de saisir plus d'un caractère.
  const editingKey = state.editing ? `${state.editing.row}:${state.editing.col}` : null;
  useEffect(() => {
    if (!editingKey) { gridRef.current?.focus(); return; }
    const el = editRef.current;
    if (!el) return;
    // Si la saisie a démarré depuis la barre de formule, c'est elle qui
    // doit garder le curseur : sinon le champ de la cellule le lui vole
    // dès le premier caractère et la frappe part au mauvais endroit.
    const activeEl = document.activeElement;
    if (activeEl instanceof HTMLElement && activeEl.closest('.xl-formula-bar')) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, [editingKey]);

  /* ---------------------------------------------------------------- */
  /* Souris : sélection et poignée de recopie                          */
  /* ---------------------------------------------------------------- */

  const isEditing = state.editing !== null;

  const handleCellMouseDown = useCallback((row: number, col: number, shift: boolean) => {
    if (isEditing) dispatch({ type: 'COMMIT_EDIT' });
    dispatch({ type: 'SELECT', coord: { row, col }, extend: shift });
    dispatch({ type: 'SELECT_DRAG', dragging: true });
    gridRef.current?.focus();
  }, [isEditing]);

  const handleCellMouseEnter = useCallback((row: number, col: number) => {
    if (state.fillDragging) dispatch({ type: 'FILL_HOVER', coord: { row, col } });
    else if (state.selectDragging) dispatch({ type: 'SELECT', coord: { row, col }, extend: true });
  }, [state.fillDragging, state.selectDragging]);

  const handleFillHandleMouseDown = useCallback((e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dispatch({ type: 'FILL_START' });
  }, []);

  const handleDoubleClick = useCallback((row: number, col: number) => {
    dispatch({ type: 'START_EDIT', row, col });
  }, []);

  const handleEditChange = useCallback((value: string) => {
    dispatch({ type: 'UPDATE_EDIT', value });
  }, []);

  const handleEditBlur = useCallback(() => {
    dispatch({ type: 'COMMIT_EDIT' });
  }, []);

  // Relâchement du bouton n'importe où : fin du glissement.
  useEffect(() => {
    const onUp = () => {
      if (state.fillDragging) dispatch({ type: 'FILL_COMMIT' });
      if (state.selectDragging) dispatch({ type: 'SELECT_DRAG', dragging: false });
    };
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, [state.fillDragging, state.selectDragging]);

  /* ---------------------------------------------------------------- */
  /* Clavier                                                           */
  /* ---------------------------------------------------------------- */

  const onKeyDown = (e: KeyboardEvent) => {
    if (state.editing) return; // l'input gère ses propres touches
    const ctrl = e.ctrlKey || e.metaKey;

    if (ctrl) {
      const k = e.key.toLowerCase();
      if (k === 'z') { e.preventDefault(); dispatch({ type: e.shiftKey ? 'REDO' : 'UNDO' }); return; }
      if (k === 'y') { e.preventDefault(); dispatch({ type: 'REDO' }); return; }
      if (k === 'a') { e.preventDefault(); dispatch({ type: 'SELECT_ALL' }); return; }
      // c / x / v passent par les évènements natifs copy / cut / paste
    }

    switch (e.key) {
      case 'ArrowUp':    e.preventDefault(); dispatch({ type: 'MOVE', dRow: -1, dCol: 0, extend: e.shiftKey, jump: ctrl }); return;
      case 'ArrowDown':  e.preventDefault(); dispatch({ type: 'MOVE', dRow: 1,  dCol: 0, extend: e.shiftKey, jump: ctrl }); return;
      case 'ArrowLeft':  e.preventDefault(); dispatch({ type: 'MOVE', dRow: 0,  dCol: -1, extend: e.shiftKey, jump: ctrl }); return;
      case 'ArrowRight': e.preventDefault(); dispatch({ type: 'MOVE', dRow: 0,  dCol: 1,  extend: e.shiftKey, jump: ctrl }); return;
      case 'Tab':        e.preventDefault(); dispatch({ type: 'MOVE', dRow: 0, dCol: e.shiftKey ? -1 : 1 }); return;
      case 'Enter':      e.preventDefault(); dispatch({ type: 'MOVE', dRow: e.shiftKey ? -1 : 1, dCol: 0 }); return;
      case 'F2':         e.preventDefault(); dispatch({ type: 'START_EDIT', row: active.row, col: active.col }); return;
      case 'Delete':
      case 'Backspace':  e.preventDefault(); dispatch({ type: 'CLEAR_RANGE' }); return;
      case 'Home':       e.preventDefault(); dispatch({ type: 'SELECT', coord: { row: active.row, col: 0 }, extend: e.shiftKey }); return;
      case 'End':        e.preventDefault(); dispatch({ type: 'SELECT', coord: { row: active.row, col: COLS - 1 }, extend: e.shiftKey }); return;
      default: break;
    }

    // Frappe d'un caractère imprimable : démarre l'édition en remplaçant
    // le contenu, comme Excel.
    if (!ctrl && !e.altKey && e.key.length === 1) {
      e.preventDefault();
      dispatch({ type: 'START_EDIT', row: active.row, col: active.col, initial: e.key });
    }
  };

  const onEditKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter')       { e.preventDefault(); dispatch({ type: 'COMMIT_EDIT', dRow: e.shiftKey ? -1 : 1, dCol: 0 }); }
    else if (e.key === 'Tab')    { e.preventDefault(); dispatch({ type: 'COMMIT_EDIT', dRow: 0, dCol: e.shiftKey ? -1 : 1 }); }
    else if (e.key === 'Escape') { e.preventDefault(); dispatch({ type: 'CANCEL_EDIT' }); }
  }, []);

  /* ---------------------------------------------------------------- */
  /* Copier / couper / coller                                          */
  /* ---------------------------------------------------------------- */

  /** Valeurs AFFICHÉES de la sélection, au format TSV (ce qu'attend Excel). */
  const selectionAsTsv = useCallback((r = range): string => {
    const lines: string[] = [];
    for (let row = r.r1; row <= r.r2; row++) {
      const cols: string[] = [];
      for (let col = r.c1; col <= r.c2; col++) {
        cols.push(String(computed[cellKey(row, col)]?.value ?? ''));
      }
      lines.push(cols.join('\t'));
    }
    return lines.join('\n');
  }, [computed, range]);

  const onCopy = (e: ClipboardEvent) => {
    if (state.editing) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', selectionAsTsv());
    dispatch({ type: 'COPY' });
  };

  const onCut = (e: ClipboardEvent) => {
    if (state.editing) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', selectionAsTsv());
    dispatch({ type: 'COPY', cut: true });
  };

  const onPaste = (e: ClipboardEvent) => {
    if (state.editing) return;
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    // Si le texte du presse-papier correspond à ce que nous avons copié
    // nous-mêmes, on passe par le presse-papier interne : les formules
    // sont alors recollées avec leurs références décalées.
    const clip = state.clipboard;
    const internalTsv = clip ? selectionAsTsv(clip.range) : null;
    dispatch({ type: 'PASTE', text: text === internalTsv ? undefined : text });
  };

  /* ---------------------------------------------------------------- */
  /* Rendu                                                             */
  /* ---------------------------------------------------------------- */

  // Les dimensions viennent de layout.ts et sont injectées dans le CSS,
  // pour que les calques et la table restent toujours alignés.
  const sizeVars = {
    '--xl-cell-w': `${CELL_W}px`,
    '--xl-cell-h': `${CELL_H}px`,
    '--xl-row-head-w': `${ROW_HEAD_W}px`,
    '--xl-col-head-h': `${COL_HEAD_H}px`,
  } as CSSProperties;

  const copiedRect = state.clipboard ? rangeToRect(state.clipboard.range) : null;
  const fillTarget = state.fillPreview?.target ?? null;
  const fillRect = fillTarget ? rangeToRect(fillTarget) : null;

  return (
    <div className="xl-app" style={sizeVars}>
      <FormulaBar
        active={active}
        value={state.editing ? state.editing.value : activeRaw}
        onChange={(value) => {
          if (state.editing) dispatch({ type: 'UPDATE_EDIT', value });
          else dispatch({ type: 'START_EDIT', row: active.row, col: active.col, initial: value });
        }}
        onCommit={() => dispatch({ type: 'COMMIT_EDIT', dRow: 1, dCol: 0 })}
        onCancel={() => dispatch({ type: 'CANCEL_EDIT' })}
      />

      <div
        className="xl-grid-wrapper"
        ref={gridRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onCopy={onCopy}
        onCut={onCut}
        onPaste={onPaste}
      >
        <div className="xl-sheet">
          <table className="xl-grid">
            <thead>
              <tr>
                <th className="xl-corner" />
                {Array.from({ length: COLS }, (_, col) => (
                  <th
                    key={col}
                    className={'xl-col-head' + (col >= range.c1 && col <= range.c2 ? ' xl-head--active' : '')}
                  >
                    {colToLabel(col)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: ROWS }, (_, row) => (
                <tr key={row}>
                  <th className={'xl-row-head' + (row >= range.r1 && row <= range.r2 ? ' xl-head--active' : '')}>
                    {row + 1}
                  </th>
                  {Array.from({ length: COLS }, (_, col) => {
                    const key = cellKey(row, col);
                    const cell = computed[key];
                    const editingThis =
                      state.editing !== null && state.editing.row === row && state.editing.col === col;
                    return (
                      <Cell
                        key={col}
                        row={row}
                        col={col}
                        display={cell?.value ?? ''}
                        raw={state.cells[key]?.rawValue ?? ''}
                        isError={Boolean(cell?.error)}
                        isActive={active.row === row && active.col === col}
                        isSelected={inRange(range, row, col)}
                        isFillPreview={fillTarget ? inRange(fillTarget, row, col) : false}
                        showFillHandle={row === range.r2 && col === range.c2}
                        editingValue={editingThis ? state.editing!.value : null}
                        editRef={editRef}
                        onMouseDown={handleCellMouseDown}
                        onMouseEnter={handleCellMouseEnter}
                        onDoubleClick={handleDoubleClick}
                        onFillHandleMouseDown={handleFillHandleMouseDown}
                        onEditChange={handleEditChange}
                        onEditKeyDown={onEditKeyDown}
                        onEditBlur={handleEditBlur}
                      />
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          {/* Contour pointillé animé autour de la plage copiée (un seul
              rectangle, comme Excel — pas un liseré par cellule). */}
          {copiedRect && <div className="xl-ants" style={copiedRect} />}

          {/* Aperçu ("ghost") de la zone qui sera remplie pendant le drag. */}
          {fillRect && <div className="xl-fill-ghost" style={fillRect} />}
        </div>
      </div>

      <div className="xl-status">
        <span>
          {colToLabel(range.c1)}{range.r1 + 1}
          {(range.r1 !== range.r2 || range.c1 !== range.c2) && `:${colToLabel(range.c2)}${range.r2 + 1}`}
          {(range.r1 !== range.r2 || range.c1 !== range.c2) &&
            ` — ${(range.r2 - range.r1 + 1) * (range.c2 - range.c1 + 1)} cellules`}
        </span>
        <span className="xl-status__hint">
          Tirez le carré vert · Ctrl+C / Ctrl+V · Ctrl+Z · F2 pour éditer
        </span>
      </div>
    </div>
  );
}
