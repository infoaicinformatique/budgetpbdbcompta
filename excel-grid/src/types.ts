/** Types partagés par le moteur, le store et les composants. */

export type CellValue = string | number;

/** Ce que l'utilisateur a saisi ("12", "=A1+2", "Loyer"...). */
export interface CellData {
  rawValue: string;
}

/** Résultat de l'évaluation d'une cellule. */
export interface ComputedCell {
  value: CellValue;
  /** Code d'erreur Excel (#REF!, #DIV/0!, #CYCLE!...) ou null. */
  error: string | null;
}

/** Grille creuse : seules les cellules non vides sont stockées. Clé = "row:col". */
export type CellMap = Record<string, CellData>;
export type ComputedMap = Record<string, ComputedCell>;

export interface CellCoord {
  row: number;
  col: number;
}

/** Rectangle normalisé (r1 <= r2, c1 <= c2). */
export interface CellRange {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

/**
 * Sélection courante : `anchor` est la cellule d'origine (celle qui reste
 * fixe quand on étend avec Shift), `focus` la cellule active.
 */
export interface Selection {
  anchor: CellCoord;
  focus: CellCoord;
}

/** Contenu copié : rectangle de valeurs brutes + origine (pour les réfs relatives). */
export interface Clipboard {
  range: CellRange;
  /** rawValues[ligne][colonne] relatif au coin haut-gauche du rectangle. */
  rawValues: string[][];
  cut: boolean;
  /** Version TSV, pour reconnaître un collage interne vs externe. */
  tsv: string;
}

export type FillDirection = 'right' | 'down' | 'left' | 'up';
