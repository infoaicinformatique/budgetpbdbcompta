/**
 * Logique de la poignée de recopie (fill handle).
 *
 * Règles reproduites depuis Excel :
 *  - Formule       -> recopiée avec décalage des références relatives.
 *  - Nombres       -> série arithmétique. Une seule cellule => pas de +1
 *                     dans Excel, mais le cahier des charges demande une
 *                     incrémentation : on incrémente donc de 1.
 *                     Plusieurs cellules => le pas est déduit de l'écart.
 *  - Dates         -> même principe, le pas est exprimé en jours.
 *  - Texte         -> recopié tel quel (motif répété cycliquement).
 *
 * Le "motif" source est répété : si on tire 6 cellules à partir de 2
 * cellules texte A/B, on obtient A B A B A B — comme Excel.
 */

import { cellKey } from './coords';
import { shiftRawValue } from './refs';
import type { CellMap, CellRange, FillDirection } from '../types';

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

const DATE_RE = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/;

interface ParsedDate {
  date: Date;
  hasYear: boolean;
  yearDigits: number;
}

export function parseDate(raw: string): ParsedDate | null {
  const m = DATE_RE.exec(raw.trim());
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  // Annotation explicite : le groupe 3 est optionnel dans la regex, mais
  // RegExpExecArray le type `string`. Sans ce `string | undefined`, la
  // comparaison ci-dessous déclencherait TS2367.
  const yearPart: string | undefined = m[3];
  const hasYear = yearPart !== undefined;
  const yearDigits = hasYear ? yearPart.length : 4;
  let year = hasYear ? parseInt(yearPart, 10) : new Date().getFullYear();
  if (hasYear && yearDigits === 2) year += year < 70 ? 2000 : 1900;

  const date = new Date(year, month - 1, day);
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return { date, hasYear, yearDigits };
}

function formatDate(date: Date, template: ParsedDate): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  if (!template.hasYear) return `${dd}/${mm}`;
  const y = template.yearDigits === 2
    ? String(date.getFullYear() % 100).padStart(2, '0')
    : String(date.getFullYear());
  return `${dd}/${mm}/${y}`;
}

const DAY_MS = 86_400_000;

/* ------------------------------------------------------------------ */
/* Détection de série                                                  */
/* ------------------------------------------------------------------ */

export type SeriesKind = 'number' | 'date' | 'text';

export interface Series {
  kind: SeriesKind;
  /** Valeur de départ (nombre, ou timestamp pour une date). */
  base: number;
  /** Incrément par pas. */
  step: number;
  /** Gabarit de formatage pour les dates. */
  dateTemplate?: ParsedDate;
}

/**
 * Analyse les valeurs sources et déduit la série à prolonger.
 * Renvoie null si les valeurs ne forment pas une série (texte, formules,
 * types mélangés) : dans ce cas on recopie le motif tel quel.
 */
export function detectSeries(values: string[]): Series | null {
  if (values.length === 0) return null;
  // Une formule n'est jamais une série : elle sera décalée, pas extrapolée.
  if (values.some((v) => v.startsWith('='))) return null;

  // --- Série de dates ---
  const dates = values.map(parseDate);
  if (dates.every((d): d is ParsedDate => d !== null)) {
    const times = dates.map((d) => d.date.getTime());
    let step = DAY_MS; // une seule date : +1 jour
    if (times.length > 1) {
      const first = times[1] - times[0];
      const regular = times.every((t, i) => i === 0 || t - times[i - 1] === first);
      step = regular ? first : (times[times.length - 1] - times[0]) / (times.length - 1);
    }
    return { kind: 'date', base: times[0], step, dateTemplate: dates[0] };
  }

  // --- Série numérique ---
  const nums = values.map((v) => {
    const n = parseFloat(v.replace(/\s/g, '').replace(',', '.'));
    return v.trim() !== '' && !isNaN(n) ? n : null;
  });
  if (nums.every((n): n is number => n !== null)) {
    let step = 1; // une seule valeur : incrément de 1 (demandé au cahier des charges)
    if (nums.length > 1) {
      const first = nums[1] - nums[0];
      const regular = nums.every((n, i) => i === 0 || Math.abs(n - nums[i - 1] - first) < 1e-9);
      step = regular ? first : (nums[nums.length - 1] - nums[0]) / (nums.length - 1);
    }
    return { kind: 'number', base: nums[0], step };
  }

  return null; // texte ou types mélangés
}

/** Valeur de la série à la position `index` (0 = première cellule source). */
export function seriesValueAt(series: Series, index: number): string {
  if (series.kind === 'date') {
    const t = series.base + series.step * index;
    return formatDate(new Date(t), series.dateTemplate!);
  }
  const v = series.base + series.step * index;
  // On évite les artefacts de virgule flottante (0.1+0.2...)
  return String(Math.round(v * 1e10) / 1e10);
}

/* ------------------------------------------------------------------ */
/* Application de la recopie                                           */
/* ------------------------------------------------------------------ */

export interface FillResult {
  cells: CellMap;
  /** Sélection résultante (source + zone remplie), comme dans Excel. */
  range: CellRange;
}

/**
 * Calcule la zone cible d'une recopie à partir de la sélection source et
 * de la cellule survolée. La direction dominante (horizontale ou verticale)
 * est choisie selon le plus grand débordement, comme Excel.
 */
export function computeFillTarget(
  source: CellRange,
  hover: { row: number; col: number },
): { target: CellRange; direction: FillDirection } | null {
  const dRight = hover.col - source.c2;
  const dLeft = source.c1 - hover.col;
  const dDown = hover.row - source.r2;
  const dUp = source.r1 - hover.row;

  const horizontal = Math.max(dRight, dLeft);
  const vertical = Math.max(dDown, dUp);

  if (horizontal <= 0 && vertical <= 0) return null;

  if (horizontal >= vertical) {
    if (dRight > 0) {
      return { target: { r1: source.r1, r2: source.r2, c1: source.c2 + 1, c2: hover.col }, direction: 'right' };
    }
    return { target: { r1: source.r1, r2: source.r2, c1: hover.col, c2: source.c1 - 1 }, direction: 'left' };
  }
  if (dDown > 0) {
    return { target: { c1: source.c1, c2: source.c2, r1: source.r2 + 1, r2: hover.row }, direction: 'down' };
  }
  return { target: { c1: source.c1, c2: source.c2, r1: hover.row, r2: source.r1 - 1 }, direction: 'up' };
}

/**
 * Remplit `target` à partir de `source`.
 *
 * Pour chaque cellule cible on calcule sa position `p` dans la séquence
 * étendue : la source occupe les positions 0..n-1, la cible continue
 * (p >= n vers la droite/le bas, p < 0 vers la gauche/le haut). La valeur
 * vaut alors base + step*p pour une série, ou le motif source à l'index
 * `p mod n` sinon.
 */
export function applyFill(
  cells: CellMap,
  source: CellRange,
  target: CellRange,
  direction: FillDirection,
  maxRow: number,
  maxCol: number,
): FillResult {
  const next: CellMap = { ...cells };
  const horizontal = direction === 'right' || direction === 'left';
  const sourceLen = horizontal ? source.c2 - source.c1 + 1 : source.r2 - source.r1 + 1;

  // Chaque ligne (si horizontal) ou colonne (si vertical) a sa propre série.
  const lineStart = horizontal ? source.r1 : source.c1;
  const lineEnd = horizontal ? source.r2 : source.c2;

  for (let line = lineStart; line <= lineEnd; line++) {
    // Valeurs sources de cette ligne/colonne
    const sourceRaws: string[] = [];
    const sourceCoords: { row: number; col: number }[] = [];
    for (let i = 0; i < sourceLen; i++) {
      const row = horizontal ? line : source.r1 + i;
      const col = horizontal ? source.c1 + i : line;
      sourceCoords.push({ row, col });
      sourceRaws.push(cells[cellKey(row, col)]?.rawValue ?? '');
    }

    const series = detectSeries(sourceRaws);

    for (let row = target.r1; row <= target.r2; row++) {
      for (let col = target.c1; col <= target.c2; col++) {
        if (horizontal ? row !== line : col !== line) continue;
        if (row < 0 || col < 0 || row >= maxRow || col >= maxCol) continue;

        // Position dans la séquence étendue
        const p = horizontal ? col - source.c1 : row - source.r1;
        // Index du motif source correspondant (modulo, gère aussi p négatif)
        const patternIndex = ((p % sourceLen) + sourceLen) % sourceLen;
        const key = cellKey(row, col);

        if (series) {
          next[key] = { rawValue: seriesValueAt(series, p) };
        } else {
          const srcRaw = sourceRaws[patternIndex];
          const srcCoord = sourceCoords[patternIndex];
          if (srcRaw === '') {
            delete next[key];
          } else {
            next[key] = {
              rawValue: shiftRawValue(srcRaw, row - srcCoord.row, col - srcCoord.col, maxRow, maxCol),
            };
          }
        }
      }
    }
  }

  return {
    cells: next,
    range: {
      r1: Math.min(source.r1, target.r1),
      c1: Math.min(source.c1, target.c1),
      r2: Math.max(source.r2, target.r2),
      c2: Math.max(source.c2, target.c2),
    },
  };
}
