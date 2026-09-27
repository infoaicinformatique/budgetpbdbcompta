/**
 * Parser + évaluateur de formules.
 *
 * Grammaire (descente récursive, priorités classiques) :
 *
 *   expression := comparison
 *   comparison := additive (("="|"<"|">"|"<="|">="|"<>") additive)?
 *   additive   := multiplicative (("+"|"-") multiplicative)*
 *   multiplicative := unary (("*"|"/") unary)*
 *   unary      := ("-"|"+")? power
 *   power      := primary ("^" primary)*
 *   primary    := NUMBER | STRING | funcCall | range | REF | "(" expression ")"
 *   funcCall   := IDENT "(" (expression (SEP expression)*)? ")"
 *   range      := REF ":" REF
 *
 * L'évaluation est paresseuse : `computeGrid` ne calcule une cellule que
 * lorsqu'on la lit, mémoïse le résultat, et détecte les cycles (#CYCLE!).
 */

import { cellKey, parseRef } from './coords';
import { FormulaError, tokenize, type Token } from './lexer';
import type { CellMap, CellValue, ComputedCell, ComputedMap } from '../types';

/* ------------------------------------------------------------------ */
/* AST                                                                 */
/* ------------------------------------------------------------------ */

type Node =
  | { kind: 'num'; value: number }
  | { kind: 'str'; value: string }
  | { kind: 'ref'; row: number; col: number }
  | { kind: 'range'; r1: number; c1: number; r2: number; c2: number }
  | { kind: 'unary'; op: string; operand: Node }
  | { kind: 'binary'; op: string; left: Node; right: Node }
  | { kind: 'call'; name: string; args: Node[] };

/* ------------------------------------------------------------------ */
/* Parser                                                              */
/* ------------------------------------------------------------------ */

class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(src: string) {
    this.tokens = tokenize(src);
  }

  private peek(): Token { return this.tokens[this.pos]; }
  private next(): Token { return this.tokens[this.pos++]; }
  private expect(type: Token['type']): Token {
    const t = this.next();
    if (t.type !== type) throw new FormulaError('#ERREUR!');
    return t;
  }

  parse(): Node {
    const node = this.parseComparison();
    if (this.peek().type !== 'EOF') throw new FormulaError('#ERREUR!');
    return node;
  }

  private parseComparison(): Node {
    const left = this.parseAdditive();
    const t = this.peek();
    if (t.type === 'OP' && (t.value === '=' || t.value === '<' || t.value === '>')) {
      // (comparaisons gardées minimalistes : non utilisées par les fonctions livrées)
      this.next();
      const right = this.parseAdditive();
      return { kind: 'binary', op: t.value, left, right };
    }
    return left;
  }

  private parseAdditive(): Node {
    let left = this.parseMultiplicative();
    while (this.peek().type === 'OP' && (this.peek().value === '+' || this.peek().value === '-')) {
      const op = this.next().value;
      const right = this.parseMultiplicative();
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  private parseMultiplicative(): Node {
    let left = this.parseUnary();
    while (this.peek().type === 'OP' && (this.peek().value === '*' || this.peek().value === '/')) {
      const op = this.next().value;
      const right = this.parseUnary();
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  private parseUnary(): Node {
    const t = this.peek();
    if (t.type === 'OP' && (t.value === '-' || t.value === '+')) {
      this.next();
      return { kind: 'unary', op: t.value, operand: this.parseUnary() };
    }
    return this.parsePower();
  }

  private parsePower(): Node {
    let base = this.parsePrimary();
    while (this.peek().type === 'OP' && this.peek().value === '^') {
      this.next();
      const exp = this.parseUnary();
      base = { kind: 'binary', op: '^', left: base, right: exp };
    }
    return base;
  }

  private parsePrimary(): Node {
    const t = this.next();

    if (t.type === 'NUMBER') {
      return { kind: 'num', value: parseFloat(t.value.replace(',', '.')) };
    }
    if (t.type === 'STRING') {
      return { kind: 'str', value: t.value };
    }
    if (t.type === 'LPAREN') {
      const inner = this.parseComparison();
      this.expect('RPAREN');
      return inner;
    }
    if (t.type === 'REF') {
      const a = parseRef(t.value);
      if (!a) throw new FormulaError('#REF!');
      // Plage "A1:B5" ?
      if (this.peek().type === 'COLON') {
        this.next();
        const endTok = this.expect('REF');
        const b = parseRef(endTok.value);
        if (!b) throw new FormulaError('#REF!');
        return {
          kind: 'range',
          r1: Math.min(a.row, b.row), c1: Math.min(a.col, b.col),
          r2: Math.max(a.row, b.row), c2: Math.max(a.col, b.col),
        };
      }
      return { kind: 'ref', row: a.row, col: a.col };
    }
    if (t.type === 'IDENT') {
      // Appel de fonction : IDENT "(" args ")"
      if (this.peek().type === 'LPAREN') {
        this.next();
        const args: Node[] = [];
        if (this.peek().type !== 'RPAREN') {
          args.push(this.parseComparison());
          while (this.peek().type === 'SEP') {
            this.next();
            args.push(this.parseComparison());
          }
        }
        this.expect('RPAREN');
        return { kind: 'call', name: t.value.toUpperCase(), args };
      }
      // Constantes booléennes tolérées
      const up = t.value.toUpperCase();
      if (up === 'TRUE' || up === 'VRAI') return { kind: 'num', value: 1 };
      if (up === 'FALSE' || up === 'FAUX') return { kind: 'num', value: 0 };
      throw new FormulaError('#NOM?');
    }

    throw new FormulaError('#ERREUR!');
  }
}

/* ------------------------------------------------------------------ */
/* Évaluation                                                          */
/* ------------------------------------------------------------------ */

/** Résout la valeur d'une cellule référencée par une formule. */
export type Resolver = (row: number, col: number) => CellValue;

// Le paramètre est volontairement élargi à null/undefined : le resolver
// peut rendre une cellule vide, et comparer un `CellValue` strict à null
// ferait échouer `tsc` (TS2367, types sans recouvrement).
function toNumber(v: CellValue | null | undefined): number {
  if (typeof v === 'number') return v;
  if (v === null || v === undefined || v === '') return 0;
  const n = parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

/** Aplatit les arguments d'une fonction : une plage devient une liste. */
function flatten(node: Node, resolve: Resolver, evalNode: (n: Node) => CellValue): CellValue[] {
  if (node.kind === 'range') {
    const out: CellValue[] = [];
    for (let r = node.r1; r <= node.r2; r++) {
      for (let c = node.c1; c <= node.c2; c++) out.push(resolve(r, c));
    }
    return out;
  }
  return [evalNode(node)];
}

/** Ne garde que les valeurs réellement numériques (comme Excel). */
function numericOnly(values: CellValue[]): number[] {
  const out: number[] = [];
  for (const v of values) {
    if (typeof v === 'number') { out.push(v); continue; }
    if (typeof v === 'string' && v.trim() !== '') {
      const n = parseFloat(v.replace(',', '.'));
      if (!isNaN(n)) out.push(n);
    }
  }
  return out;
}

function evaluateNode(node: Node, resolve: Resolver): CellValue {
  const ev = (n: Node): CellValue => evaluateNode(n, resolve);

  switch (node.kind) {
    case 'num': return node.value;
    case 'str': return node.value;
    case 'ref': return resolve(node.row, node.col);
    case 'range': {
      // Une plage utilisée hors fonction n'a pas de sens ici
      throw new FormulaError('#VALEUR!');
    }
    case 'unary': {
      const v = toNumber(ev(node.operand));
      return node.op === '-' ? -v : v;
    }
    case 'binary': {
      const a = toNumber(ev(node.left));
      const b = toNumber(ev(node.right));
      switch (node.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/':
          if (b === 0) throw new FormulaError('#DIV/0!');
          return a / b;
        case '^': return Math.pow(a, b);
        case '=': return a === b ? 1 : 0;
        case '<': return a < b ? 1 : 0;
        case '>': return a > b ? 1 : 0;
        default: throw new FormulaError('#ERREUR!');
      }
    }
    case 'call': {
      const values = node.args.flatMap((a) => flatten(a, resolve, ev));
      const nums = numericOnly(values);
      switch (node.name) {
        case 'SUM':
        case 'SOMME':
          return nums.reduce((s, n) => s + n, 0);
        case 'MOYENNE':
        case 'AVERAGE':
          if (nums.length === 0) throw new FormulaError('#DIV/0!');
          return nums.reduce((s, n) => s + n, 0) / nums.length;
        case 'MIN': return nums.length ? Math.min(...nums) : 0;
        case 'MAX': return nums.length ? Math.max(...nums) : 0;
        case 'COUNT':
        case 'NB': return nums.length;
        case 'ABS': return Math.abs(nums[0] ?? 0);
        case 'ROUND':
        case 'ARRONDI': {
          const d = nums[1] ?? 0;
          const f = Math.pow(10, d);
          return Math.round((nums[0] ?? 0) * f) / f;
        }
        default:
          throw new FormulaError('#NOM?');
      }
    }
  }
  // Garde-fou d'exhaustivité : si un type de nœud est ajouté à l'union
  // `Node` sans `case` correspondant, `node` cesse d'être `never` ici et
  // la compilation échoue — l'oubli est signalé au lieu de passer.
  const impossible: never = node;
  throw new FormulaError(`#ERREUR! ${String(impossible)}`);
}

/** Compile + évalue une formule isolée (sans le "="). */
export function evaluateFormula(source: string, resolve: Resolver): CellValue {
  const ast = new Parser(source).parse();
  return evaluateNode(ast, resolve);
}

/* ------------------------------------------------------------------ */
/* Évaluation de toute la grille                                       */
/* ------------------------------------------------------------------ */

/** Convertit une saisie brute non-formule en nombre si possible. */
export function parseLiteral(raw: string): CellValue {
  const trimmed = raw.trim();
  if (trimmed === '') return '';
  // Nombre éventuellement écrit à la française (virgule décimale,
  // espaces comme séparateurs de milliers).
  const normalized = trimmed.replace(/\s/g, '').replace(',', '.');
  if (/^-?\d+(\.\d+)?$/.test(normalized)) return parseFloat(normalized);
  return trimmed;
}

/**
 * Évalue toutes les cellules de la grille.
 * Mémoïsation + détection de cycles : une cellule "en cours de visite"
 * qui serait redemandée signale une référence circulaire.
 */
export function computeGrid(cells: CellMap): ComputedMap {
  const computed: ComputedMap = {};
  const visiting = new Set<string>();

  const resolve: Resolver = (row, col) => {
    const key = cellKey(row, col);
    const cached = computed[key];
    if (cached) {
      if (cached.error) throw new FormulaError(cached.error);
      return cached.value;
    }
    if (visiting.has(key)) throw new FormulaError('#CYCLE!');

    const cell = cells[key];
    if (!cell || cell.rawValue === '') {
      computed[key] = { value: '', error: null };
      return '';
    }

    visiting.add(key);
    let result: ComputedCell;
    try {
      result = { value: evaluateRaw(cell.rawValue, resolve), error: null };
    } catch (e) {
      const code = e instanceof FormulaError ? e.code : '#ERREUR!';
      result = { value: code, error: code };
    } finally {
      visiting.delete(key);
    }
    computed[key] = result;
    if (result.error) throw new FormulaError(result.error);
    return result.value;
  };

  for (const key of Object.keys(cells)) {
    if (computed[key]) continue;
    const [row, col] = key.split(':').map(Number);
    try {
      resolve(row, col);
    } catch {
      // L'erreur est déjà stockée dans `computed` par le resolver.
    }
  }

  return computed;
}

/** Évalue une saisie brute : formule (`=`) ou littéral. */
export function evaluateRaw(raw: string, resolve: Resolver): CellValue {
  if (raw.startsWith('=')) return evaluateFormula(raw.slice(1), resolve);
  return parseLiteral(raw);
}

export { FormulaError };
