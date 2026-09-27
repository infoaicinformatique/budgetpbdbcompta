/**
 * Conversion entre coordonnées numériques (row, col) et références Excel (A1).
 * Les colonnes suivent la base 26 "bijective" d'Excel : A..Z, AA..AZ, BA...
 */

/** 0 -> "A", 25 -> "Z", 26 -> "AA" */
export function colToLabel(col: number): string {
  let label = '';
  let n = col;
  while (n >= 0) {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  }
  return label;
}

/** "A" -> 0, "Z" -> 25, "AA" -> 26 */
export function labelToCol(label: string): number {
  let n = 0;
  const up = label.toUpperCase();
  for (let i = 0; i < up.length; i++) {
    n = n * 26 + (up.charCodeAt(i) - 64);
  }
  return n - 1;
}

/** Clé de stockage d'une cellule dans la map de la grille. */
export function cellKey(row: number, col: number): string {
  return `${row}:${col}`;
}

export interface ParsedRef {
  row: number;
  col: number;
  absRow: boolean;
  absCol: boolean;
}

const REF_RE = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/;

/** "A1" | "$A$1" -> { row, col, absRow, absCol } (0-indexé). */
export function parseRef(ref: string): ParsedRef | null {
  const m = REF_RE.exec(ref);
  if (!m) return null;
  const col = labelToCol(m[2]);
  const row = parseInt(m[4], 10) - 1;
  if (row < 0) return null;
  return { row, col, absRow: m[3] === '$', absCol: m[1] === '$' };
}

/** { row, col, absRow, absCol } -> "A1" | "$A$1" */
export function formatRef(r: ParsedRef): string {
  return `${r.absCol ? '$' : ''}${colToLabel(r.col)}${r.absRow ? '$' : ''}${r.row + 1}`;
}
