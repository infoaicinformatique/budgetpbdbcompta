/**
 * Grille pré-remplie pour tester immédiatement toutes les fonctionnalités :
 *  - B2 contient une date -> tirer la poignée vers la droite incrémente les jours
 *  - A3 contient un nombre -> tirer vers le bas incrémente 1, 2, 3...
 *  - E4:E6 contiennent des formules relatives -> les copier décale les réfs
 *  - B8 contient un SUM sur une plage
 */

import { cellKey, parseRef } from '../engine/coords';
import type { CellMap } from '../types';

const SAMPLE: Record<string, string> = {
  A1: 'Démo tableur',

  // Ligne de dates : sélectionner B2 puis tirer la poignée vers la droite
  A2: 'Date',
  B2: '01/01/2027',

  // Série numérique : sélectionner A3 (ou A3:A4) puis tirer vers le bas
  A3: '1',

  // Petit tableau avec formules
  C3: 'Qté',
  D3: 'PU',
  E3: 'Total',
  C4: '2', D4: '10', E4: '=C4*D4',
  C5: '5', D5: '3',  E5: '=C5*D5',
  C6: '4', D6: '7',  E6: '=C6*D6',

  C8: 'Somme',
  E8: '=SUM(E4:E6)',
  C9: 'Moyenne',
  E9: '=MOYENNE(E4:E6)',

  // Texte : la recopie le duplique tel quel
  A6: 'Loyer',
};

export function buildSampleCells(): CellMap {
  const cells: CellMap = {};
  for (const [ref, raw] of Object.entries(SAMPLE)) {
    const p = parseRef(ref);
    if (p) cells[cellKey(p.row, p.col)] = { rawValue: raw };
  }
  return cells;
}
