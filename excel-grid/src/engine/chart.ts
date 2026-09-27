/**
 * Plan comptable, centres de coûts et agrégation du P&L.
 *
 * Ce module est la traduction en code des règles de gestion :
 *
 *  - chaque compte de résultat porte un centre de coût (1 à 9) ;
 *  - chaque centre alimente une des catégories de présentation ;
 *  - le centre 9 (RPOI : loyers, assurances, taxes foncières, CFE, CVAE,
 *    redevances DSP, management fees) est le seul exclu du GOP.
 *
 * D'où les deux indicateurs, tels que dictés :
 *      GOP    = Produits − (Total des charges − Other Taxes)
 *      EBITDA = Produits − Total des charges
 *
 * Le fichier ne contient aucune donnée : le plan comptable vit dans
 * `src/data/pcg.generated.ts`, régénéré depuis le classeur Excel.
 */

import { PCG_ACCOUNTS } from '../data/pcg.generated';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type CostCenterId = 'F&B' | 'AG' | 'HR' | 'MAT' | 'IT' | 'MARK' | 'POMEC' | 'SECU' | 'RPOI';

/** `bilan` = classes 1 à 5 : présent pour référence, jamais budgété. */
export type AccountKind = 'produit' | 'charge' | 'bilan';

export interface PcgAccount {
  /** Numéro à 8 chiffres du plan 2026 : c'est la clé. */
  account: string;
  label: string;
  kind: AccountKind;
  /** Centre de coût, `null` pour les comptes de bilan et les produits non affectés. */
  center: CostCenterId | null;
  /** Numéros à 6 chiffres de l'ancien plan ayant abouti à ce compte. */
  legacy?: string[];
  /** Libellés d'origine quand plusieurs comptes ont fusionné : lignes nommées suggérées. */
  variants?: string[];
}

export interface CostCenter {
  id: CostCenterId;
  /** Code numérique du classeur (colonne « Code »). */
  code: number;
  /** Nom affiché. */
  label: string;
  /** Catégorie de présentation. */
  category: Category;
  /** Un centre exclu du GOP entre dans l'EBITDA seulement. */
  inGop: boolean;
}

export type Category =
  | 'Produits'
  | 'Operating charge'
  | 'Administration'
  | 'Human resources'
  | 'Material'
  | 'Informatic et technologie'
  | 'Marketing'
  | 'POMEC'
  | 'Sécurité'
  | 'Other Taxes';

/**
 * Une ligne de budget. Le montant global sur un compte est interdit :
 * chaque euro passe par une ligne **nommée**, pour qu'on sache toujours
 * à quoi il correspond. `amounts` compte douze mois.
 */
export interface BudgetLine {
  id: string;
  account: string;
  name: string;
  amounts: number[];
}

export const MONTHS = 12;

export const MONTH_LABELS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
] as const;

/* ------------------------------------------------------------------ */
/* Centres de coûts                                                    */
/* ------------------------------------------------------------------ */

export const COST_CENTERS: CostCenter[] = [
  { id: 'F&B',   code: 1, label: 'Food & Beverage',          category: 'Operating charge',          inGop: true },
  { id: 'AG',    code: 2, label: 'Administration générale',  category: 'Administration',            inGop: true },
  { id: 'HR',    code: 3, label: 'Ressources humaines',      category: 'Human resources',           inGop: true },
  { id: 'MAT',   code: 4, label: 'Matériel',                 category: 'Material',                  inGop: true },
  { id: 'IT',    code: 5, label: 'Informatique & technologie', category: 'Informatic et technologie', inGop: true },
  { id: 'MARK',  code: 6, label: 'Marketing',                category: 'Marketing',                 inGop: true },
  { id: 'POMEC', code: 7, label: 'POMEC',                    category: 'POMEC',                     inGop: true },
  { id: 'SECU',  code: 8, label: 'Sécurité',                 category: 'Sécurité',                  inGop: true },
  // Seul centre hors GOP : c'est lui qui fait la différence GOP / EBITDA.
  { id: 'RPOI',  code: 9, label: 'Loyers, taxes & assurances', category: 'Other Taxes',             inGop: false },
];

const CENTER_BY_ID = new Map(COST_CENTERS.map((c) => [c.id, c]));

export function costCenter(id: CostCenterId): CostCenter {
  const found = CENTER_BY_ID.get(id);
  if (!found) throw new Error(`Centre de coût inconnu : ${id}`);
  return found;
}

/* ------------------------------------------------------------------ */
/* Plan comptable                                                      */
/* ------------------------------------------------------------------ */

/**
 * Reclassements explicites, appliqués par-dessus le plan comptable importé.
 *
 * Le fichier généré depuis le classeur n'est jamais modifié à la main : quand
 * le P&L du groupe range un compte ailleurs que le PCG, la décision est prise
 * ici, visible et réversible. À supprimer dès que le PCG est corrigé à la
 * source.
 */
export const CENTER_OVERRIDES: Record<string, CostCenterId> = {
  // Redevances de marque : le PCG la classe en F&B, donc dans le GOP, alors
  // que le P&L du groupe la présente en frais fixes, sous le GOP (feuille
  // « Management Fees »). Sans ce reclassement, le GOP de l'application
  // dépasse celui du fichier Excel de 271 807,90 €.
  '65123100': 'RPOI',
};

export const ACCOUNTS: PcgAccount[] = PCG_ACCOUNTS.map((account) => {
  const override = CENTER_OVERRIDES[account.account];
  return override ? { ...account, center: override } : account;
});

export type AccountIndex = Map<string, PcgAccount>;

const ACCOUNT_BY_NUMBER: AccountIndex = new Map(ACCOUNTS.map((a) => [a.account, a]));

/** Index consultable pour un plan comptable donné (import-pcg.mjs en construit un par plan importé). */
export function buildAccountIndex(accounts: PcgAccount[]): AccountIndex {
  return new Map(accounts.map((a) => [a.account, a]));
}

/**
 * `index` : plan comptable à consulter (un import d'Alexis, propre à une
 * société) ; par défaut, le plan comptable de base (PCG HEMASPHERE).
 * Plusieurs sociétés peuvent avoir chacune leur propre plan — voir
 * `resolveAccountForLine` côté application, qui choisit l'index selon la
 * société de la ligne avant d'appeler `findAccount`.
 */
export function findAccount(account: string, index: AccountIndex = ACCOUNT_BY_NUMBER): PcgAccount | null {
  return index.get(String(account).trim()) ?? null;
}

/** Comptes réellement budgétables : produits et charges, jamais le bilan. `accounts` : plan comptable à consulter, par défaut celui de base. */
export function budgetableAccounts(accounts: PcgAccount[] = ACCOUNTS): PcgAccount[] {
  return accounts.filter((a) => a.kind !== 'bilan');
}

/** Catégorie de présentation d'un compte. */
export function categoryOf(account: PcgAccount): Category | null {
  if (account.kind === 'produit') return 'Produits';
  if (account.kind === 'bilan') return null;
  return account.center ? costCenter(account.center).category : null;
}

/**
 * Comptes d'un centre de coût, dans l'ordre du plan.
 *
 * Résultat mémoïsé par plan comptable (`accounts`, par défaut celui de
 * base) : un plan ne change jamais après son import, et cette fonction est
 * appelée à chaque rendu de la Saisie. Sans cache, on reparcourait les
 * 1000+ comptes et on allouerait un tableau neuf à chaque frappe, pour un
 * résultat identique. Le `WeakMap` (plutôt qu'un cache unique) permet à
 * chaque plan comptable importé d'avoir le sien, sans se mélanger avec les
 * autres ni avec celui de base.
 */
const ACCOUNTS_BY_CENTER_CACHE = new WeakMap<PcgAccount[], Map<CostCenterId, PcgAccount[]>>();
export function accountsOfCenter(id: CostCenterId, accounts: PcgAccount[] = ACCOUNTS): PcgAccount[] {
  let byCenter = ACCOUNTS_BY_CENTER_CACHE.get(accounts);
  if (!byCenter) { byCenter = new Map(); ACCOUNTS_BY_CENTER_CACHE.set(accounts, byCenter); }
  let found = byCenter.get(id);
  if (!found) {
    found = accounts.filter((a) => a.center === id && a.kind !== 'bilan');
    byCenter.set(id, found);
  }
  return found;
}

/**
 * Charges sans centre de coût : elles ne peuvent pas être classées, donc
 * pas budgétées, mais on ne les cache pas — les ignorer fausserait les
 * totaux sans prévenir. L'application les affiche « à classer ».
 *
 * Mémoïsé par plan comptable, pour la même raison qu'`accountsOfCenter`.
 */
const UNCLASSIFIED_CACHE = new WeakMap<PcgAccount[], PcgAccount[]>();
export function unclassifiedCharges(accounts: PcgAccount[] = ACCOUNTS): PcgAccount[] {
  let found = UNCLASSIFIED_CACHE.get(accounts);
  if (!found) {
    found = accounts.filter((a) => a.kind === 'charge' && !a.center);
    UNCLASSIFIED_CACHE.set(accounts, found);
  }
  return found;
}

/**
 * Texte de recherche de chaque compte, en minuscules, construit une seule
 * fois par plan comptable. Auparavant ces 1000+ chaînes étaient reconstruites
 * à chaque frappe dans la barre de recherche : autant de chaînes temporaires
 * à ramasser, pour un contenu qui ne bouge jamais.
 */
const SEARCH_HAYSTACKS_CACHE = new WeakMap<PcgAccount[], string[]>();
function haystacksFor(accounts: PcgAccount[]): string[] {
  let found = SEARCH_HAYSTACKS_CACHE.get(accounts);
  if (!found) {
    found = accounts.map((a) =>
      `${a.account} ${a.label} ${(a.legacy ?? []).join(' ')} ${(a.variants ?? []).join(' ')}`.toLowerCase());
    SEARCH_HAYSTACKS_CACHE.set(accounts, found);
  }
  return found;
}

/** Recherche libre : numéro (2026 ou historique) ou fragment de libellé. `accounts` : plan comptable à consulter. */
export function searchAccounts(query: string, limit = 50, accounts: PcgAccount[] = ACCOUNTS): PcgAccount[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const haystacks = haystacksFor(accounts);
  const out: PcgAccount[] = [];
  for (let i = 0; i < accounts.length; i++) {
    if (haystacks[i].includes(needle)) out.push(accounts[i]);
    if (out.length >= limit) break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Groupes de comptes pour les ratios                                  */
/* ------------------------------------------------------------------ */

/**
 * Ratios coût matières : les périmètres sont explicites plutôt que devinés
 * par mot-clé, pour qu'ils soient relisibles et modifiables par le contrôle
 * de gestion. **À valider avec Alexis** — notamment les achats de
 * marchandises génériques (60700000, 60700100, 60701100, 60750100), laissés
 * dehors faute de savoir s'ils relèvent du Food ou du Beverage.
 */
export const RATIO_GROUPS = {
  /** CA restauration. */
  foodRevenue: ['70105100', '70105200', '70106100', '70106200'],
  /** CA bar. */
  bevRevenue: [
    '70101100', '70101200', '70102100', '70102200',
    '70103100', '70103200', '70104100', '70104200',
  ],
  /** Coût matières Food. */
  foodCost: ['60103100'],
  /** Coût matières Beverage, variation de stock comprise. */
  bevCost: [
    '60101100', '60310100',
    '60721100', '60722100', '60723100', '60724100', '60725100', '60726100',
    '60793100', '60794100', '60795100',
  ],
} as const;

/**
 * Libellés anglais des centres de coûts, utilisés uniquement pour les
 * tableaux PnL et Consolidation (écran, CSV, Excel) — le reste de
 * l'application (Saisie, Sociétés…) continue d'afficher `COST_CENTERS` en
 * français, ces deux jeux de libellés sont donc volontairement distincts.
 */
export const CENTER_LABEL_EN: Record<CostCenterId, { label: string; category: string }> = {
  'F&B': { label: 'Food & Beverage', category: 'Operating charge' },
  AG: { label: 'General Administration', category: 'Administration' },
  HR: { label: 'Human Resources', category: 'Human Resources' },
  MAT: { label: 'Material', category: 'Material' },
  IT: { label: 'IT & Technology', category: 'IT' },
  MARK: { label: 'Marketing', category: 'Marketing' },
  POMEC: { label: 'POMEC', category: 'POMEC' },
  SECU: { label: 'Security', category: 'Security' },
  RPOI: { label: 'Rent, Taxes & Insurance', category: 'Other Taxes' },
};

/* ------------------------------------------------------------------ */
/* Agrégation                                                          */
/* ------------------------------------------------------------------ */

export function emptyMonths(): number[] {
  return new Array(MONTHS).fill(0);
}

export function addInto(target: number[], source: number[]): number[] {
  for (let i = 0; i < MONTHS; i++) target[i] += source[i] ?? 0;
  return target;
}

export function total(months: number[]): number {
  return months.reduce((sum, value) => sum + value, 0);
}

export interface PlSummary {
  /** Produits, charges et indicateurs, mois par mois. */
  produits: number[];
  charges: number[];
  /** Charges entrant dans le GOP (tous centres sauf RPOI). */
  chargesGop: number[];
  /** Charges hors GOP (centre RPOI = Other Taxes). */
  otherTaxes: number[];
  gop: number[];
  ebitda: number[];
  /** Détail par centre de coût, puis par catégorie de présentation. */
  byCenter: Record<CostCenterId, number[]>;
  byCategory: Record<string, number[]>;
  /** Total par compte, pour le détail et l'export. */
  byAccount: Record<string, number[]>;
  ratios: {
    /** coût matières Food ÷ CA restauration */
    food: number | null;
    /** coût boissons ÷ CA bar */
    beverage: number | null;
    /** (Produits − coût matières F&B) ÷ Produits */
    grossMargin: number | null;
  };
  /**
   * Une ligne de ratio par poste, mois par mois : Food et Beverage (le
   * centre F&B éclaté en deux, coût matières ÷ son propre chiffre
   * d'affaires), puis un ratio par centre restant (AG, HR, MAT, IT, MARK,
   * POMEC, SECU, RPOI), charges du centre ÷ produits totaux — comme demandé
   * par Alexis pour que chaque tableau porte ses ratios, pas seulement le
   * bandeau d'indicateurs au-dessus.
   */
  ratioRows: { id: string; label: string; months: (number | null)[]; value: number | null }[];
  /**
   * Détail du centre F&B, mois par mois : Food et Beverage isolés des
   * autres charges opérationnelles (les deux seuls postes sur lesquels le
   * contrôle de gestion suit un ratio dédié), et le reliquat du centre
   * (équipement, casse, etc.) à part — pour que « Food & Beverage » ne
   * reste pas un bloc unique dans les tableaux. La somme des trois retombe
   * exactement sur `byCenter['F&B']`, mois par mois.
   */
  foodBeverage: { food: number[]; beverage: number[]; other: number[] };
  /**
   * Ventilation du chiffre d'affaires, mois par mois : Food et Beverage
   * (mêmes comptes que pour les ratios), et le reliquat (hébergement,
   * locations de salles, autres produits accessoires…). La somme des trois
   * retombe exactement sur `produits`, mois par mois.
   */
  revenueSplit: { food: number[]; beverage: number[]; other: number[] };
  /**
   * Masse salariale, mois par mois : comptes 6411 (rémunération) et 645
   * (charges sociales), tous centres de coûts confondus. Transverse — pas
   * propre au F&B — mais affiché juste sous le ratio Beverage à la demande
   * d'Alexis plutôt que relégué en bas du tableau.
   */
  payroll: number[];
  /**
   * Lignes refusées, avec leur motif. Rien n'est écarté en silence :
   * un montant qui disparaît d'un budget est pire qu'une erreur visible.
   */
  rejected: { line: BudgetLine; reason: string }[];
}

function sumOf(byAccount: Record<string, number[]>, accounts: readonly string[]): number {
  let sum = 0;
  for (const account of accounts) sum += total(byAccount[account] ?? []);
  return sum;
}

/** Version mensuelle de `sumOf` : un total par mois plutôt qu'un seul total annuel. */
function sumOfMonths(byAccount: Record<string, number[]>, accounts: readonly string[]): number[] {
  const out = emptyMonths();
  for (const account of accounts) addInto(out, byAccount[account] ?? emptyMonths());
  return out;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

/** `null` mois par mois dès que le dénominateur de ce mois est nul, plutôt qu'une division par zéro. */
function ratioMonths(numerators: number[], denominators: number[]): (number | null)[] {
  return numerators.map((n, i) => ratio(n, denominators[i] ?? 0));
}

/**
 * Somme mensuelle de tous les comptes dont le numéro commence par l'un des
 * préfixes donnés — utilisé pour la masse salariale (6411 : rémunération,
 * 645 : charges sociales), qui existe à l'identique dans chacun des neuf
 * centres de coûts. Une liste explicite comme `RATIO_GROUPS` demanderait
 * d'énumérer chaque variante par centre ; le préfixe s'applique d'un coup,
 * quel que soit le plan comptable de la société.
 */
function sumOfMonthsByPrefix(byAccount: Record<string, number[]>, prefixes: readonly string[]): number[] {
  const out = emptyMonths();
  for (const account of Object.keys(byAccount)) {
    if (prefixes.some((p) => account.startsWith(p))) addInto(out, byAccount[account]);
  }
  return out;
}

/**
 * Agrège des lignes de budget en compte de résultat.
 *
 * Convention de signe : produits et charges sont saisis **en positif**.
 * C'est ce que fait le contrôle de gestion sur ses fichiers Excel, et ça
 * évite les erreurs de saisie sur les signes.
 *
 * `resolveAccount` : comment retrouver le compte d'une ligne — par défaut,
 * une simple consultation du plan comptable de base. L'application peut
 * fournir un résolveur qui choisit le plan comptable selon la société de la
 * ligne (`line.companyId`, un champ que porte l'application mais pas ce
 * type `BudgetLine` minimal), pour qu'un même appel puisse agréger des
 * lignes de sociétés ayant chacune leur propre plan comptable (Consolidation,
 * groupes...).
 */
export function summarize(
  lines: BudgetLine[],
  resolveAccount: (line: BudgetLine) => PcgAccount | null = (line) => findAccount(line.account),
): PlSummary {
  const byCenter = Object.fromEntries(
    COST_CENTERS.map((c) => [c.id, emptyMonths()]),
  ) as Record<CostCenterId, number[]>;
  const byCategory: Record<string, number[]> = {};
  const byAccount: Record<string, number[]> = {};
  const rejected: { line: BudgetLine; reason: string }[] = [];

  const produits = emptyMonths();
  const charges = emptyMonths();
  const chargesGop = emptyMonths();
  const otherTaxes = emptyMonths();

  for (const line of lines) {
    const account = resolveAccount(line);
    if (!account) {
      rejected.push({ line, reason: `compte ${line.account} absent du plan comptable` });
      continue;
    }
    if (account.kind === 'bilan') {
      rejected.push({ line, reason: `compte ${line.account} de bilan : hors budget d’exploitation` });
      continue;
    }
    // Règle de traçabilité : pas de montant global sur un compte.
    if (!line.name.trim()) {
      rejected.push({ line, reason: `compte ${line.account} : ligne sans nom` });
      continue;
    }
    const category = categoryOf(account);
    if (!category) {
      rejected.push({ line, reason: `compte ${line.account} sans centre de coût : à classer` });
      continue;
    }

    const amounts = line.amounts;
    byAccount[account.account] ??= emptyMonths();
    addInto(byAccount[account.account], amounts);
    byCategory[category] ??= emptyMonths();
    addInto(byCategory[category], amounts);

    if (account.kind === 'produit') {
      addInto(produits, amounts);
    } else {
      addInto(charges, amounts);
      const center = costCenter(account.center as CostCenterId);
      // La masse salariale (6411/6412/645*) a bien un centre au plan
      // comptable — c'est ce qui permet de la reporter automatiquement
      // depuis le Payroll — mais elle ne doit apparaître qu'une fois dans
      // le P&L, sur sa propre ligne « Payroll » (voir plus bas), pas aussi
      // noyée dans la rubrique opérationnelle de chaque centre.
      if (!/^(6411|6412|645)/.test(account.account)) addInto(byCenter[center.id], amounts);
      addInto(center.inGop ? chargesGop : otherTaxes, amounts);
    }
  }

  const gop = produits.map((value, i) => value - chargesGop[i]);
  const ebitda = produits.map((value, i) => value - charges[i]);

  const foodCost = sumOf(byAccount, RATIO_GROUPS.foodCost);
  const bevCost = sumOf(byAccount, RATIO_GROUPS.bevCost);
  const foodRevenue = sumOf(byAccount, RATIO_GROUPS.foodRevenue);
  const bevRevenue = sumOf(byAccount, RATIO_GROUPS.bevRevenue);
  const totalRevenue = total(produits);

  const foodCostMonths = sumOfMonths(byAccount, RATIO_GROUPS.foodCost);
  const bevCostMonths = sumOfMonths(byAccount, RATIO_GROUPS.bevCost);
  const foodRevenueMonths = sumOfMonths(byAccount, RATIO_GROUPS.foodRevenue);
  const bevRevenueMonths = sumOfMonths(byAccount, RATIO_GROUPS.bevRevenue);

  // Reliquat du centre F&B (équipement, casse, achats génériques…), une
  // fois Food et Bev isolés — son propre ratio suit juste en dessous,
  // charges ÷ produits totaux (pas de CA dédié comme pour Food/Bev).
  const otherFBMonths = byCenter['F&B'].map((v, i) => v - foodCostMonths[i] - bevCostMonths[i]);
  const otherFB = total(otherFBMonths);

  // Masse salariale : comptes 6411 (rémunération), 645 (charges sociales)
  // et 6412 (provision congés payés), tous centres de coûts confondus —
  // une rubrique transverse, pas propre au F&B, affichée juste sous le
  // ratio Beverage à la demande d'Alexis.
  const payrollMonths = sumOfMonthsByPrefix(byAccount, ['6411', '6412', '645']);
  const payrollTotal = total(payrollMonths);

  const ratioRows: PlSummary['ratioRows'] = [
    { id: 'food', label: 'Food Cost Ratio', months: ratioMonths(foodCostMonths, foodRevenueMonths), value: ratio(foodCost, foodRevenue) },
    { id: 'beverage', label: 'Beverage Cost Ratio', months: ratioMonths(bevCostMonths, bevRevenueMonths), value: ratio(bevCost, bevRevenue) },
    { id: 'payroll', label: 'Payroll Ratio', months: ratioMonths(payrollMonths, produits), value: ratio(payrollTotal, totalRevenue) },
    { id: 'other-fnb', label: 'Operational expenses Ratio', months: ratioMonths(otherFBMonths, produits), value: ratio(otherFB, totalRevenue) },
  ];
  for (const center of COST_CENTERS) {
    if (center.id === 'F&B') continue; // remplacé par Food + Bev + Autres achats F&B ci-dessus
    ratioRows.push({
      id: center.id,
      label: CENTER_LABEL_EN[center.id].label + ' Ratio',
      months: ratioMonths(byCenter[center.id], produits),
      value: ratio(total(byCenter[center.id]), totalRevenue),
    });
  }

  const otherRevenueMonths = produits.map((v, i) => v - foodRevenueMonths[i] - bevRevenueMonths[i]);

  return {
    produits, charges, chargesGop, otherTaxes, gop, ebitda,
    byCenter, byCategory, byAccount,
    ratios: {
      food: ratio(foodCost, foodRevenue),
      beverage: ratio(bevCost, bevRevenue),
      grossMargin: ratio(totalRevenue - foodCost - bevCost, totalRevenue),
    },
    ratioRows,
    foodBeverage: { food: foodCostMonths, beverage: bevCostMonths, other: otherFBMonths },
    revenueSplit: { food: foodRevenueMonths, beverage: bevRevenueMonths, other: otherRevenueMonths },
    payroll: payrollMonths,
    rejected,
  };
}
