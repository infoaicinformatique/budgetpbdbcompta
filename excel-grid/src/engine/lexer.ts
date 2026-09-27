/**
 * Lexer de formules.
 *
 * Il est partagé par deux consommateurs :
 *  - le parser (evaluate.ts), qui construit un AST ;
 *  - le décaleur de références (refs.ts), qui réécrit une formule en
 *    déplaçant ses références relatives lors d'une copie/recopie.
 *
 * C'est pour cela que chaque token conserve sa position (`start`/`end`)
 * dans la chaîne source : refs.ts peut ainsi reconstruire la formule
 * en ne remplaçant que les tokens de type REF, sans toucher au reste
 * (texte entre guillemets, espaces, opérateurs...).
 */

export type TokenType =
  | 'NUMBER'
  | 'STRING'
  | 'REF'
  | 'IDENT'
  | 'OP'
  | 'LPAREN'
  | 'RPAREN'
  | 'COLON'
  | 'SEP'
  | 'EOF';

export interface Token {
  type: TokenType;
  value: string;
  start: number;
  end: number;
}

export class FormulaError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

// Une référence doit avoir des lettres PUIS des chiffres : "A1", "$B$12".
// Ce test passe avant IDENT, sinon "A1" serait lu comme un nom de fonction.
const RE_REF = /^\$?[A-Za-z]{1,3}\$?\d+/;
const RE_IDENT = /^[A-Za-z_][A-Za-z0-9_.]*/;
// Nombre : le séparateur décimal peut être "." ou "," (usage français),
// mais uniquement entre deux chiffres — "SUM(A1,A2)" reste donc bien
// interprété comme deux arguments et non comme un nombre.
const RE_NUMBER = /^\d+(?:[.,]\d+)?|^[.,]\d+/;

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    // Espaces
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Chaîne entre guillemets, avec échappement "" (convention Excel)
    if (ch === '"') {
      let j = i + 1;
      let out = '';
      while (j < input.length) {
        if (input[j] === '"') {
          if (input[j + 1] === '"') {
            out += '"';
            j += 2;
            continue;
          }
          break;
        }
        out += input[j];
        j++;
      }
      if (j >= input.length) throw new FormulaError('#ERREUR!');
      tokens.push({ type: 'STRING', value: out, start: i, end: j + 1 });
      i = j + 1;
      continue;
    }

    const rest = input.slice(i);

    const mRef = RE_REF.exec(rest);
    if (mRef) {
      tokens.push({ type: 'REF', value: mRef[0], start: i, end: i + mRef[0].length });
      i += mRef[0].length;
      continue;
    }

    const mNum = RE_NUMBER.exec(rest);
    if (mNum) {
      tokens.push({ type: 'NUMBER', value: mNum[0], start: i, end: i + mNum[0].length });
      i += mNum[0].length;
      continue;
    }

    const mIdent = RE_IDENT.exec(rest);
    if (mIdent) {
      tokens.push({ type: 'IDENT', value: mIdent[0], start: i, end: i + mIdent[0].length });
      i += mIdent[0].length;
      continue;
    }

    if ('+-*/^&%'.includes(ch)) {
      tokens.push({ type: 'OP', value: ch, start: i, end: i + 1 });
      i++;
      continue;
    }
    if (ch === '(') { tokens.push({ type: 'LPAREN', value: ch, start: i, end: i + 1 }); i++; continue; }
    if (ch === ')') { tokens.push({ type: 'RPAREN', value: ch, start: i, end: i + 1 }); i++; continue; }
    if (ch === ':') { tokens.push({ type: 'COLON', value: ch, start: i, end: i + 1 }); i++; continue; }
    if (ch === ';' || ch === ',') { tokens.push({ type: 'SEP', value: ch, start: i, end: i + 1 }); i++; continue; }

    throw new FormulaError('#ERREUR!');
  }

  tokens.push({ type: 'EOF', value: '', start: i, end: i });
  return tokens;
}
