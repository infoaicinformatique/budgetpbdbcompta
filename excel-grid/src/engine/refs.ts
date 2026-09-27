/**
 * Décalage des références relatives d'une formule.
 *
 * C'est le cœur du comportement Excel "copier une formule ailleurs" :
 *   =A1+B1   copié une colonne à droite  ->  =B1+C1
 *   =A1+B1   copié une ligne en dessous  ->  =A2+B2
 *   =$A1*2   copié à droite              ->  =$A1*2   ($ fige la colonne)
 *
 * On travaille sur les tokens plutôt que par regex globale : ainsi une
 * chaîne de caractères comme ="A1 est un texte" n'est jamais réécrite,
 * et les positions (start/end) permettent de reconstruire la formule à
 * l'identique en dehors des références.
 */

import { formatRef, parseRef } from './coords';
import { tokenize, FormulaError } from './lexer';

/**
 * @param formula formule SANS le "=" initial
 * @param dRow    décalage vertical (en lignes)
 * @param dCol    décalage horizontal (en colonnes)
 * @param maxRow  borne de la grille : au-delà, la référence devient #REF!
 * @param maxCol  idem pour les colonnes
 */
export function shiftFormula(
  formula: string,
  dRow: number,
  dCol: number,
  maxRow = Infinity,
  maxCol = Infinity,
): string {
  let tokens;
  try {
    tokens = tokenize(formula);
  } catch {
    // Formule non lexable : on la laisse telle quelle plutôt que de la casser.
    return formula;
  }

  let out = '';
  let cursor = 0;

  for (const tok of tokens) {
    if (tok.type === 'EOF') break;
    if (tok.type !== 'REF') continue;

    const ref = parseRef(tok.value);
    if (!ref) continue;

    // Seules les composantes NON absolues bougent.
    const newRow = ref.absRow ? ref.row : ref.row + dRow;
    const newCol = ref.absCol ? ref.col : ref.col + dCol;

    const replacement =
      newRow < 0 || newCol < 0 || newRow > maxRow - 1 || newCol > maxCol - 1
        ? '#REF!'
        : formatRef({ ...ref, row: newRow, col: newCol });

    out += formula.slice(cursor, tok.start) + replacement;
    cursor = tok.end;
  }

  out += formula.slice(cursor);
  return out;
}

/**
 * Décale une saisie brute complète : ne touche qu'aux formules,
 * les littéraux (nombres, texte) sont recopiés tels quels.
 */
export function shiftRawValue(
  raw: string,
  dRow: number,
  dCol: number,
  maxRow?: number,
  maxCol?: number,
): string {
  if (!raw.startsWith('=')) return raw;
  return '=' + shiftFormula(raw.slice(1), dRow, dCol, maxRow, maxCol);
}

export { FormulaError };
