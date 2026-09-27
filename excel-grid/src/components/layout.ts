/**
 * Dimensions de la feuille.
 *
 * Ces constantes sont la source unique de vérité : elles sont injectées
 * dans le CSS via des variables (`--xl-cell-w`...) et réutilisées en JS
 * pour positionner les calques (contour de copie, aperçu de recopie).
 * On peut ainsi dessiner UN seul rectangle autour d'une plage, comme
 * Excel, au lieu d'un liseré autour de chaque cellule.
 */

export const CELL_W = 92;
export const CELL_H = 22;
export const ROW_HEAD_W = 40;
export const COL_HEAD_H = 20;

import type { CellRange } from '../types';

export interface RectStyle {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Position en pixels d'une plage, relative au coin haut-gauche de la feuille. */
export function rangeToRect(range: CellRange): RectStyle {
  return {
    left: ROW_HEAD_W + range.c1 * CELL_W,
    top: COL_HEAD_H + range.r1 * CELL_H,
    width: (range.c2 - range.c1 + 1) * CELL_W,
    height: (range.r2 - range.r1 + 1) * CELL_H,
  };
}
