/**
 * Import du plan comptable depuis le classeur Excel de référence.
 *
 *   node scripts/import-pcg.mjs "../PCG HEMASPHERE FINAL 8.xlsx"
 *
 * Produit trois sorties depuis une source unique :
 *   1. src/data/pcg.generated.ts   — module typé, consommé par le projet React
 *   2. ../pcg.json                 — même contenu, lisible par n'importe quoi
 *   3. ../budget-app.html          — bloc de données réécrit entre marqueurs,
 *                                    pour que le fichier reste autonome
 *                                    (ouverture au double-clic, sans serveur)
 *
 * Le classeur attendu :
 *   - une feuille `6&7` : comptes de résultat, colonnes
 *     N° Compte | N° Compte 2026 | Libellé | Catégorie | Code
 *   - une feuille `complet (2)` : plan complet à 8 chiffres, Compte | Intitulé
 *
 * Relancer ce script à chaque nouvelle version du PCG : rien n'est saisi
 * à la main, donc rien ne peut diverger.
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readWorkbook } from './lib/xlsx-read.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = join(root, '..');

const source = process.argv[2] ?? join(projectRoot, 'PCG HEMASPHERE FINAL 8.xlsx');
if (!existsSync(source)) {
  console.error(`Fichier introuvable : ${source}`);
  console.error('Usage : node scripts/import-pcg.mjs "chemin/vers/PCG.xlsx"');
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* Centres de coûts                                                    */
/* ------------------------------------------------------------------ */

/**
 * Le tag entre parenthèses de la colonne « Catégorie » et le chiffre de la
 * colonne « Code » désignent le même centre de coût. On garde le tag comme
 * identifiant (lisible) et on vérifie que le code numérique concorde.
 */
const CENTERS = {
  'F&B': 1,
  AG: 2,
  HR: 3,
  MAT: 4,
  IT: 5,
  MARK: 6,
  POMEC: 7,
  SECU: 8,
  RPOI: 9,
};

/** Retire les suffixes « (F&B) », « (RPOI) »… d'un libellé, sans toucher au reste. */
function cleanLabel(label) {
  let out = String(label).replace(/\s+/g, ' ').trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const tag of Object.keys(CENTERS)) {
      const suffix = `(${tag})`;
      if (out.toUpperCase().endsWith(suffix.toUpperCase())) {
        out = out.slice(0, -suffix.length).trim();
        changed = true;
      }
    }
  }
  return out.replace(/[\s-]+$/, '').trim();
}

/* ------------------------------------------------------------------ */
/* Lecture                                                             */
/* ------------------------------------------------------------------ */

const sheets = readWorkbook(source);
const pl = sheets.get('6&7');
const full = sheets.get('complet (2)');
if (!pl) throw new Error("Feuille « 6&7 » absente du classeur.");

/** Trouve la ligne d'en-tête (le classeur peut avoir des lignes vides en tête). */
function findHeader(rows, needle) {
  const index = rows.findIndex((r) => r.some((c) => String(c).toLowerCase().includes(needle)));
  if (index < 0) throw new Error(`En-tête « ${needle} » introuvable.`);
  return index;
}

const warnings = [];
const byAccount = new Map();

/** Ajoute un compte, en fusionnant si le numéro 2026 est déjà pris. */
function add(account, label, { legacy = null, center = null } = {}) {
  const kind = account.startsWith('6') ? 'charge' : account.startsWith('7') ? 'produit' : 'bilan';
  const clean = cleanLabel(label);
  const existing = byAccount.get(account);

  if (!existing) {
    byAccount.set(account, {
      account,
      label: clean,
      kind,
      center,
      legacy: legacy ? [legacy] : [],
      // Libellés d'origine : quand deux comptes historiques se rejoignent sur
      // un même compte 2026, ils deviennent les lignes nommées suggérées.
      variants: [clean],
    });
    return;
  }

  if (legacy && !existing.legacy.includes(legacy)) existing.legacy.push(legacy);
  if (!existing.variants.includes(clean)) existing.variants.push(clean);
  if (center && existing.center && center !== existing.center) {
    warnings.push(`${account} : centres de coûts contradictoires (${existing.center} / ${center})`);
  }
  existing.center ??= center;
  // Libellé commun aux variantes fusionnées, sinon le premier.
  existing.label = commonLabel(existing.variants);
}

/** Plus long préfixe commun exploitable, sinon le premier libellé. */
function commonLabel(labels) {
  if (labels.length === 1) return labels[0];
  let prefix = labels[0];
  for (const label of labels.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < label.length && prefix[i] === label[i]) i++;
    prefix = prefix.slice(0, i);
  }
  prefix = prefix.replace(/[\s(,-]+$/, '').trim();
  return prefix.length >= 6 ? prefix : labels[0];
}

/* --- feuille 6&7 : comptes de résultat, avec centre de coût --- */

const plHeader = findHeader(pl, 'compte');
const headers = pl[plHeader].map((c) => String(c).toLowerCase().trim());
const col = {
  legacy: headers.findIndex((h) => h.startsWith('n° compte') && !h.includes('2026')),
  account: headers.findIndex((h) => h.includes('2026')),
  label: headers.findIndex((h) => h.startsWith('libellé')),
  category: headers.findIndex((h) => h.startsWith('catégorie')),
  code: headers.findIndex((h) => h === 'code'),
};
for (const [key, index] of Object.entries(col)) {
  if (index < 0) throw new Error(`Colonne « ${key} » introuvable dans la feuille 6&7.`);
}

let plRows = 0;
for (const row of pl.slice(plHeader + 1)) {
  const account = String(row[col.account] ?? '').trim();
  if (!/^\d{8}$/.test(account)) continue;
  plRows++;

  const tag = String(row[col.category] ?? '').trim().replace(/^\(|\)$/g, '');
  const code = String(row[col.code] ?? '').trim();
  let center = null;

  if (tag in CENTERS) {
    center = tag;
    if (code && code !== String(CENTERS[tag])) {
      warnings.push(`${account} : code ${code} ≠ centre ${tag} (attendu ${CENTERS[tag]})`);
    }
  } else if (tag && tag !== 'NA' && tag !== 'Produits' && tag !== 'None') {
    warnings.push(`${account} : catégorie « ${tag} » inconnue`);
  }

  add(account, row[col.label], { legacy: String(row[col.legacy] ?? '').trim(), center });
}

/* --- feuille complet (2) : reste du plan (bilan), sans centre de coût --- */

let fullRows = 0;
if (full) {
  const fullHeader = findHeader(full, 'compte');
  const fh = full[fullHeader].map((c) => String(c).toLowerCase().trim());
  const accountCol = fh.findIndex((h) => h.includes('compte'));
  const labelCol = fh.findIndex((h) => h.includes('intitulé') || h.includes('libell'));
  for (const row of full.slice(fullHeader + 1)) {
    const account = String(row[accountCol] ?? '').trim();
    if (!/^\d{8}$/.test(account)) continue;
    fullRows++;
    add(account, row[labelCol]);
  }
}

/* ------------------------------------------------------------------ */
/* Contrôles                                                           */
/* ------------------------------------------------------------------ */

const accounts = [...byAccount.values()].sort((a, b) => a.account.localeCompare(b.account));

const unclassified = accounts.filter((a) => a.kind === 'charge' && !a.center);
for (const account of unclassified) {
  warnings.push(`${account.account} « ${account.label} » : charge sans centre de coût`);
}

const counts = accounts.reduce((acc, a) => {
  acc[a.kind] = (acc[a.kind] ?? 0) + 1;
  if (a.center) acc[`centre ${a.center}`] = (acc[`centre ${a.center}`] ?? 0) + 1;
  return acc;
}, {});

/* ------------------------------------------------------------------ */
/* Écriture                                                            */
/* ------------------------------------------------------------------ */

const generatedAt = new Date().toISOString().slice(0, 10);
const header = `/**
 * PLAN COMPTABLE — FICHIER GÉNÉRÉ, NE PAS MODIFIER À LA MAIN.
 *
 * Source   : ${basename(source)}
 * Généré   : ${generatedAt} par scripts/import-pcg.mjs
 * Contenu  : ${accounts.length} comptes à 8 chiffres
 *            ${counts.produit ?? 0} produits · ${counts.charge ?? 0} charges · ${counts.bilan ?? 0} comptes de bilan
 *
 * Pour mettre à jour : remplacer le classeur et relancer
 *   node scripts/import-pcg.mjs "chemin/vers/PCG.xlsx"
 */
import type { PcgAccount } from '../engine/chart';

export const PCG_SOURCE = ${JSON.stringify(basename(source))};
export const PCG_GENERATED_AT = ${JSON.stringify(generatedAt)};

export const PCG_ACCOUNTS: PcgAccount[] = [
`;

const body = accounts
  .map((a) => {
    const parts = [
      `account: '${a.account}'`,
      `label: ${JSON.stringify(a.label)}`,
      `kind: '${a.kind}'`,
      `center: ${a.center ? `'${a.center}'` : 'null'}`,
    ];
    if (a.legacy.length) parts.push(`legacy: ${JSON.stringify(a.legacy)}`);
    if (a.variants.length > 1) parts.push(`variants: ${JSON.stringify(a.variants)}`);
    return `  { ${parts.join(', ')} },`;
  })
  .join('\n');

writeFileSync(join(root, 'src', 'data', 'pcg.generated.ts'), `${header}${body}\n];\n`, 'utf8');

const json = {
  source: basename(source),
  generatedAt,
  accounts: accounts.map((a) => ({
    account: a.account,
    label: a.label,
    kind: a.kind,
    center: a.center,
    ...(a.legacy.length ? { legacy: a.legacy } : {}),
    ...(a.variants.length > 1 ? { variants: a.variants } : {}),
  })),
};
writeFileSync(join(projectRoot, 'pcg.json'), `${JSON.stringify(json, null, 1)}\n`, 'utf8');

// Bloc de données de l'application autonome, réécrit entre marqueurs.
const htmlPath = join(projectRoot, 'budget-app.html');
if (existsSync(htmlPath)) {
  const html = readFileSync(htmlPath, 'utf8');
  const start = '/* PCG-DATA-START */';
  const end = '/* PCG-DATA-END */';
  if (html.includes(start) && html.includes(end)) {
    const before = html.slice(0, html.indexOf(start) + start.length);
    const after = html.slice(html.indexOf(end));
    const block = `\n    const PCG_SOURCE = ${JSON.stringify(basename(source))};\n`
      + `    const PCG_GENERATED_AT = ${JSON.stringify(generatedAt)};\n`
      + `    const PCG_ACCOUNTS = ${JSON.stringify(json.accounts)};\n    `;
    writeFileSync(htmlPath, before + block + after, 'utf8');
    console.log('budget-app.html : bloc PCG mis à jour');
  } else {
    console.warn('budget-app.html : marqueurs PCG-DATA absents, fichier laissé tel quel');
  }
}

/* ------------------------------------------------------------------ */
/* Rapport                                                             */
/* ------------------------------------------------------------------ */

console.log(`PCG importé depuis ${basename(source)}`);
console.log(`  feuille 6&7        : ${plRows} lignes`);
console.log(`  feuille complet(2) : ${fullRows} lignes`);
console.log(`  comptes retenus    : ${accounts.length}`);
console.log(`  produits ${counts.produit ?? 0} · charges ${counts.charge ?? 0} · bilan ${counts.bilan ?? 0}`);
for (const center of Object.keys(CENTERS)) {
  console.log(`    centre ${String(CENTERS[center]).padEnd(2)} ${center.padEnd(6)} ${counts[`centre ${center}`] ?? 0} comptes`);
}
if (warnings.length) {
  console.log(`\n${warnings.length} point(s) à vérifier :`);
  for (const warning of warnings) console.log(`  - ${warning}`);
}
