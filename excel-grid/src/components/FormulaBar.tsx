/**
 * Barre de formule : affiche la référence de la cellule active (zone Nom)
 * et sa valeur brute, éditable — exactement comme dans Excel.
 */

import { colToLabel } from '../engine/coords';
import type { CellCoord } from '../types';

interface FormulaBarProps {
  active: CellCoord;
  /** Valeur brute affichée (formule si la cellule en contient une). */
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}

export function FormulaBar({ active, value, onChange, onCommit, onCancel }: FormulaBarProps) {
  return (
    <div className="xl-formula-bar">
      <div className="xl-name-box">{colToLabel(active.col)}{active.row + 1}</div>
      <div className="xl-fx">fx</div>
      <input
        className="xl-formula-input"
        value={value}
        placeholder="Saisir une valeur ou une formule (=A1+B1, =SUM(A1:A5), =MOYENNE(B1:B3))"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); onCommit(); }
          else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        }}
      />
    </div>
  );
}
