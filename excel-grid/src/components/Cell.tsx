/**
 * Une cellule de la grille.
 *
 * Deux modes :
 *  - affichage : la valeur CALCULÉE (résultat de la formule), alignée à
 *    droite si c'est un nombre, comme Excel ;
 *  - édition : un <input> montrant la valeur BRUTE (la formule).
 *
 * Le composant est mémoïsé : sur 40 × 12 cellules, seules celles dont
 * l'état visuel change sont re-rendues. Les callbacks reçus de <Grid>
 * sont donc tous stabilisés par `useCallback` côté parent.
 */

import { memo, type KeyboardEvent, type MouseEvent, type Ref } from 'react';
import type { CellValue } from '../types';

export interface CellProps {
  row: number;
  col: number;
  /** Valeur affichée (résultat calculé). */
  display: CellValue;
  /** Valeur brute : sert d'info-bulle pour voir la formule sans éditer. */
  raw: string;
  isError: boolean;
  isActive: boolean;
  isSelected: boolean;
  /** Cellule dans l'aperçu de recopie pendant le glissement. */
  isFillPreview: boolean;
  /** Affiche la poignée de recopie (coin bas-droit de la sélection). */
  showFillHandle: boolean;
  /** Contenu du champ si cette cellule est en édition, sinon null. */
  editingValue: string | null;
  editRef: Ref<HTMLInputElement>;
  onMouseDown: (row: number, col: number, shift: boolean) => void;
  onMouseEnter: (row: number, col: number) => void;
  onDoubleClick: (row: number, col: number) => void;
  onFillHandleMouseDown: (e: MouseEvent) => void;
  onEditChange: (value: string) => void;
  onEditKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  onEditBlur: () => void;
}

function CellComponent(props: CellProps) {
  const {
    row, col, display, raw, isError, isActive, isSelected, isFillPreview,
    showFillHandle, editingValue, editRef,
    onMouseDown, onMouseEnter, onDoubleClick, onFillHandleMouseDown,
    onEditChange, onEditKeyDown, onEditBlur,
  } = props;

  const isEditing = editingValue !== null;
  const numeric = typeof display === 'number';

  const className = [
    'xl-cell',
    numeric ? 'xl-cell--num' : '',
    isSelected ? 'xl-cell--selected' : '',
    isActive ? 'xl-cell--active' : '',
    isFillPreview ? 'xl-cell--fill' : '',
    isError ? 'xl-cell--error' : '',
  ].filter(Boolean).join(' ');

  return (
    <td
      className={className}
      title={raw.startsWith('=') ? raw : undefined}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        onMouseDown(row, col, e.shiftKey);
      }}
      onMouseEnter={() => onMouseEnter(row, col)}
      onDoubleClick={() => onDoubleClick(row, col)}
    >
      {isEditing ? (
        <input
          ref={editRef}
          className="xl-cell__input"
          value={editingValue}
          onChange={(e) => onEditChange(e.target.value)}
          onKeyDown={onEditKeyDown}
          onBlur={onEditBlur}
          // Évite que le mousedown de la cellule ne reprenne le focus
          onMouseDown={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="xl-cell__text">{display === '' ? '' : String(display)}</span>
      )}

      {showFillHandle && !isEditing && (
        <div
          className="xl-fill-handle"
          title="Recopier : glisser vers la droite ou vers le bas"
          onMouseDown={onFillHandleMouseDown}
        />
      )}
    </td>
  );
}

export const Cell = memo(CellComponent);
