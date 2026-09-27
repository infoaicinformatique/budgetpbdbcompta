/**
 * Lecteur .xlsx minimal, sans aucune dépendance.
 *
 * Un .xlsx est une archive ZIP de fichiers XML. On lit donc l'archive
 * (annuaire central + `zlib.inflateRawSync`), puis on parse les quelques
 * balises dont on a besoin. Suffisant pour une feuille de valeurs — pas
 * un moteur Excel : ni formules, ni styles, ni dates sérialisées.
 *
 * Pourquoi ne pas prendre une librairie ? Pour que l'import du plan
 * comptable reste exécutable partout, y compris sans `npm install`.
 */
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

/* ------------------------------------------------------------------ */
/* ZIP                                                                 */
/* ------------------------------------------------------------------ */

function readZip(path) {
  const buf = readFileSync(path);

  // Fin de l'annuaire central (EOCD) : signature 0x06054b50, cherchée
  // depuis la fin car un commentaire peut la suivre.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Archive illisible : fin d’annuaire ZIP introuvable.');

  const count = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  const files = new Map();

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) throw new Error('Entrée ZIP corrompue.');
    const method = buf.readUInt16LE(pos + 10);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localOffset = buf.readUInt32LE(pos + 42);
    const name = buf.toString('utf8', pos + 46, pos + 46 + nameLen);

    // L'en-tête local redit les longueurs : elles peuvent différer.
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compressedSize);

    files.set(name, method === 0 ? raw : inflateRawSync(raw));
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/* ------------------------------------------------------------------ */
/* XML                                                                 */
/* ------------------------------------------------------------------ */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function unescapeXml(text) {
  return text.replace(/&(amp|lt|gt|quot|apos|#x?[0-9A-Fa-f]+);/g, (whole, code) => {
    if (code in ENTITIES) return ENTITIES[code];
    const num = /^#[xX]/.test(code)
      ? parseInt(code.slice(2), 16)
      : parseInt(code.slice(1), 10);
    return Number.isNaN(num) ? whole : String.fromCodePoint(num);
  });
}

/** Table des chaînes partagées : les cellules texte y renvoient par index. */
function readSharedStrings(files) {
  const xml = files.get('xl/sharedStrings.xml');
  if (!xml) return [];
  const out = [];
  for (const item of xml.toString('utf8').split('<si>').slice(1)) {
    // Une chaîne peut être découpée en plusieurs <t> (formatage riche).
    const parts = [...item.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1]));
    out.push(parts.join(''));
  }
  return out;
}

/** "B12" -> 1 (index de colonne, 0 = A). */
function columnIndex(ref) {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * Feuille -> tableau de lignes, chaque ligne étant un tableau de chaînes.
 *
 * Les lignes vides n'existent pas dans le XML : on respecte donc l'attribut
 * `r` pour que `rows[11]` soit bien la ligne 12 du tableur. Sans cela, toute
 * lecture par numéro de ligne serait décalée dès la première ligne vide.
 */
/**
 * Une cellule sans contenu (juste une mise en forme) s'écrit en balise
 * auto-fermante : `<c r="C15" s="112"/>`. Un motif `<c([^>]*)>([\s\S]*?)<\/c>`
 * naïf l'ignore superbement : il matche quand même l'ouverture (le `/`
 * final fait partie de `[^>]*`), puis part chercher le PROCHAIN `</c>` du
 * XML — qui appartient à une cellule plus loin sur la ligne. Toutes les
 * cellules entre les deux se retrouvent alors avalées dans le « contenu »
 * de la cellule vide, et les colonnes qui suivent se décalent en silence.
 * D'où l'alternative explicite ci-dessous : auto-fermante (pas de corps),
 * ou ouverture + corps + fermeture — jamais un mélange des deux.
 */
const CELL_RE = /<c\b([^>]*?)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g;
/** Même piège possible pour une ligne entièrement vide. */
const ROW_RE = /<row\b([^>]*?)\/>|<row\b([^>]*)>([\s\S]*?)<\/row>/g;

function readSheet(xml, shared) {
  const rows = [];
  for (const rowMatch of xml.toString('utf8').matchAll(ROW_RE)) {
    const rowAttrs = rowMatch[1] ?? rowMatch[2] ?? '';
    const rowBody = rowMatch[3] ?? '';
    const rowNumber = Number(rowAttrs.match(/\br="(\d+)"/)?.[1] ?? 0);
    const cells = [];
    for (const cell of rowBody.matchAll(CELL_RE)) {
      const selfClosing = cell[1] !== undefined;
      const attrs = selfClosing ? cell[1] : cell[2];
      const body = selfClosing ? '' : cell[3];
      const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1];
      const type = attrs.match(/t="([^"]+)"/)?.[1];

      let value = '';
      if (type === 'inlineStr') {
        value = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1])).join('');
      } else {
        const raw = body.match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? '';
        value = type === 's' ? (shared[Number(raw)] ?? '') : unescapeXml(raw);
      }
      cells[ref ? columnIndex(ref) : cells.length] = value;
    }
    const line = [...cells].map((c) => c ?? '');
    if (rowNumber > 0) rows[rowNumber - 1] = line;
    else rows.push(line);
  }
  // Comble les trous laissés par les lignes absentes du XML.
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  return rows;
}

/**
 * Lit un classeur entier.
 * @returns {Map<string, string[][]>} nom de feuille -> lignes -> cellules
 */
export function readWorkbook(path) {
  const files = readZip(path);
  const shared = readSharedStrings(files);

  // workbook.xml donne les noms de feuilles et leur rId ; le fichier .rels
  // traduit chaque rId en chemin de feuille. L'ordre seul ne suffit pas.
  const workbook = files.get('xl/workbook.xml')?.toString('utf8') ?? '';
  const rels = files.get('xl/_rels/workbook.xml.rels')?.toString('utf8') ?? '';

  const targetByRid = new Map();
  for (const m of rels.matchAll(/<Relationship([^>]*)\/>/g)) {
    const id = m[1].match(/Id="([^"]+)"/)?.[1];
    const target = m[1].match(/Target="([^"]+)"/)?.[1];
    if (id && target) targetByRid.set(id, target.replace(/^\/?xl\//, '').replace(/^\//, ''));
  }

  const sheets = new Map();
  for (const m of workbook.matchAll(/<sheet([^>]*)\/>/g)) {
    const name = unescapeXml(m[1].match(/name="([^"]*)"/)?.[1] ?? '');
    const rid = m[1].match(/r:id="([^"]+)"/)?.[1];
    const target = rid ? targetByRid.get(rid) : null;
    const xml = target ? files.get(`xl/${target}`) : null;
    if (xml) sheets.set(name, readSheet(xml, shared));
  }
  return sheets;
}
