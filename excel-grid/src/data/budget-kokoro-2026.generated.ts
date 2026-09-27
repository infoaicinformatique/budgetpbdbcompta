/**
 * BUDGET 2026 — FICHIER GÉNÉRÉ, NE PAS MODIFIER À LA MAIN.
 *
 * Source  : 13 - FORECAST - PL KOKORO 2026 - DB_22072026.xlsx
 * Société : Kokoro
 * Généré  : 2026-08-17 par scripts/import-kokoro.mjs
 *
 * Contrôlé contre la feuille « P&L SYNTHESE » ET, feuille par feuille,
 * contre chaque « Total Departmental Expenses » (voir le script pour le
 * détail des neuf centres) :
 *   Revenue 2 778 950 · GOP 948 970 · EBITDA 349 722
 *
 * RPOI (feuille « Rent Property and Other Taxes ») n'a pas de colonne de
 * code : ses quatre lignes sont affectées à des comptes RPOI génériques,
 * décision documentée en tête de scripts/import-kokoro.mjs.
 *
 * Pour réimporter : node --experimental-strip-types scripts/import-kokoro.mjs "chemin.xlsx"
 */
import type { BudgetLine } from '../engine/chart';

export const BUDGET_COMPANY = "Kokoro";
export const BUDGET_YEAR = 2026;
export const BUDGET_SOURCE = "13 - FORECAST - PL KOKORO 2026 - DB_22072026.xlsx";

/** Totaux du P&L Excel, servant de contrôle aux tests. */
export const BUDGET_CONTROLS = {
  "revenue": 2778950,
  "charges": 2429227.5694507523,
  "otherTaxes": 599247.7708333335,
  "gop": 948970.2013825808,
  "ebitda": 349722.4305492476
};

export const BUDGET_LINES: BudgetLine[] = [
  { id: 'kok001', account: '70105200', name: "Food Lunch Revenue (OP)", amounts: [0, 0, 0, 0, 0, 0, 110400, 243840, 288000, 102600, 100800, 140400] },
  { id: 'kok002', account: '70106100', name: "Food Dinner Revenue (OP)", amounts: [0, 0, 0, 0, 0, 0, 148800, 265920, 317200, 157200, 162000, 186000] },
  { id: 'kok003', account: '70102100', name: "Beverage Lunch (OP)", amounts: [0, 0, 0, 0, 0, 0, 27600, 60960, 72000, 25650, 25200, 35100] },
  { id: 'kok004', account: '70103100', name: "Beverage Dinner (OP)", amounts: [0, 0, 0, 0, 0, 0, 37200, 66480, 79300, 39300, 40500, 46500] },
  { id: 'kok005', account: '60103100', name: "Cost of Food Sales (OP)", amounts: [0, 0, 0, 0, 0, 1317.14, 77760, 127440, 151300, 64950, 65700, 81600] },
  { id: 'kok006', account: '60101100', name: "Cost of Beverage Sales (OP)", amounts: [0, 0, 0, 0, 0, 0, 9072, 17841.6, 21182, 9093, 9198, 11424] },
  { id: 'kok007', account: '64110100', name: "Total Salaries (OP)", amounts: [0, 0, 0, 343.75, 343.75, 14540.35, 101715.35, 101715.35, 101715.35, 88240.35, 88240.35, 88240.35] },
  { id: 'kok008', account: '64510100', name: "Payroll-Related Expenses & Wages (OP)", amounts: [0, 0, 0, 137.5, 137.5, 5816.14, 40686.14, 40686.14, 40686.14, 35296.14, 35296.14, 35296.14] },
  { id: 'kok009', account: '60632100', name: "Operating Supplies 606 300 (OP)", amounts: [0, 0, 0, 0, 0, 9854.23, 4400, 1500, 4400, 1500, 4400, 4400] },
  { id: 'kok010', account: '60610100', name: "Cleaning Supplies (OP)", amounts: [0, 0, 0, 0, 0, 3036, 1000, 1000, 1000, 1000, 1000, 1000] },
  { id: 'kok011', account: '60634100', name: "Decorations (OP)", amounts: [0, 0, 0, 0, 0, 1000, 1000, 1000, 1000, 1000, 1000, 1000] },
  { id: 'kok012', account: '62342100', name: "Complimentary Food and Beverage (OP)", amounts: [0, 0, 0, 0, 0, 475.2, 4158, 4158, 4158, 3564, 3564, 3564] },
  { id: 'kok013', account: '61351100', name: "Contract Services (OP)", amounts: [0, 0, 0, 0, 0, 300, 300, 300, 300, 300, 300, 300] },
  { id: 'kok014', account: '60630100', name: "China Expense (OP)", amounts: [0, 0, 0, 0, 0, 8000, 100, 100, 100, 100, 100, 100] },
  { id: 'kok015', account: '61531100', name: "Uniform Laundry (OP)", amounts: [0, 0, 0, 0, 0, 1100, 500, 500, 500, 500, 500, 500] },
  { id: 'kok016', account: '60631100', name: "Flatware Expense (OP)", amounts: [0, 0, 0, 0, 0, 3500, 100, 100, 100, 100, 100, 100] },
  { id: 'kok017', account: '60633100', name: "Glassware Expense (OP)", amounts: [0, 0, 0, 0, 0, 5000, 100, 100, 100, 100, 100, 100] },
  { id: 'kok018', account: '60636100', name: "Uniform Costs (OP)", amounts: [0, 0, 0, 0, 0, 14660, 0, 0, 0, 0, 0, 0] },
  { id: 'kok019', account: '61111100', name: "Music & Entertainment (OP)", amounts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1500] },
  { id: 'kok020', account: '60635100', name: "Ustensils (OP)", amounts: [0, 0, 0, 0, 0, 8896.28, 0, 0, 0, 0, 0, 0] },
  { id: 'kok021', account: '64801200', name: "Training and Education Expense (A&G)", amounts: [0, 0, 0, 0, 0, 750, 0, 0, 0, 0, 0, 0] },
  { id: 'kok022', account: '62261200', name: "Audit Charges (A&G)", amounts: [0, 0, 0, 0, 1083.33, 1083.33, 1083.33, 1083.33, 1083.33, 1083.33, 1083.33, 1083.33] },
  { id: 'kok023', account: '62263200', name: "Legal Services (A&G)", amounts: [0, 0, 0, 0, 800, 800, 800, 800, 800, 800, 800, 800] },
  { id: 'kok024', account: '62265200', name: "Professional Fees - consulting - conseils (A&G)", amounts: [0, 0, 0, 0, 1000, 1000, 6000, 1000, 1000, 1000, 1000, 1000] },
  { id: 'kok025', account: '62811200', name: "Dues & Subscriptions Expense (A&G)", amounts: [0, 0, 0, 0, 0, 0, 51.17, 51.17, 51.17, 51.17, 51.17, 51.17] },
  { id: 'kok026', account: '62340200', name: "Complimentary Gifts & Services (A&G)", amounts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2500] },
  { id: 'kok027', account: '61351200', name: "Contract Services (A&G)", amounts: [0, 0, 0, 0, 0, 35000, 6197.61, 1197.61, 1197.61, 1197.61, 1197.61, 1440.16] },
  { id: 'kok028', account: '62780200', name: "Bank Charges (A&G)", amounts: [0, 0, 0, 0, 0, 0, 1620, 3186, 3782.5, 1623.75, 1642.5, 2040] },
  { id: 'kok029', account: '62781200', name: "Credit Card Commissions (A&G)", amounts: [0, 0, 0, 0, 0, 0, 3888, 7646.4, 9078, 3897, 3942, 4896] },
  { id: 'kok030', account: '62510300', name: "Travel Expense (H&R)", amounts: [0, 0, 0, 0, 0, 6750.5, 500, 500, 3000, 0, 0, 0] },
  { id: 'kok031', account: '61351400', name: "Contract Services (Material)", amounts: [0, 0, 0, 0, 0, 0, 741.54, 741.54, 741.54, 741.54, 741.54, 741.54] },
  { id: 'kok032', account: '61355500', name: "Information Systems Expense (IT Systems)", amounts: [0, 0, 0, 0, 0, 425, 425, 425, 425, 425, 425, 425] },
  { id: 'kok033', account: '61352500', name: "Computer Maintenance Software (IT Systems)", amounts: [0, 0, 0, 0, 0, 85, 85, 85, 85, 85, 85, 85] },
  { id: 'kok034', account: '61561500', name: "Computer Software License (IT Systems)", amounts: [0, 0, 0, 0, 0, 903.67, 903.67, 903.67, 903.67, 903.67, 903.67, 903.67] },
  { id: 'kok035', account: '61562500', name: "Dues & Subscriptions Expense (IT Systems)", amounts: [0, 0, 0, 0, 0, 308.3, 308.3, 308.3, 308.3, 308.3, 308.3, 308.3] },
  { id: 'kok036', account: '62611500', name: "Telecommunications Expense (IT Systems)", amounts: [0, 0, 0, 0, 0, 141.67, 141.67, 141.67, 141.67, 141.67, 141.67, 141.67] },
  { id: 'kok037', account: '60640600', name: "Printing & Stationery (S&M)", amounts: [0, 0, 0, 0, 0, 400, 0, 0, 0, 0, 0, 1000] },
  { id: 'kok038', account: '62264600', name: "Contract Service - Commissions 622 200 - 611 500 (S&M)", amounts: [0, 0, 0, 0, 0, 0, 1268.02, 1268.02, 1272.26, 1273.11, 1239.18, 1239.18] },
  { id: 'kok039', account: '62265600', name: "Photography (S&M)", amounts: [0, 0, 0, 0, 0, 5000, 0, 0, 0, 0, 0, 0] },
  { id: 'kok040', account: '62361600', name: "Media (S&M)", amounts: [0, 0, 0, 0, 0, 517, 517, 517, 267, 267, 267, 317] },
  { id: 'kok041', account: '62261700', name: "Professional Fees (POMEC)", amounts: [0, 0, 0, 0, 0, 412.5, 412.5, 412.5, 412.5, 412.5, 412.5, 412.5] },
  { id: 'kok042', account: '60632700', name: "Operating Supplies (POMEC)", amounts: [0, 0, 0, 0, 0, 25, 25, 25, 25, 25, 25, 25] },
  { id: 'kok043', account: '61550700', name: "HVAC Equipment (POMEC)", amounts: [0, 0, 0, 0, 0, 100, 100, 100, 100, 100, 100, 100] },
  { id: 'kok044', account: '61520700', name: "Building Expense (POMEC)", amounts: [0, 0, 0, 0, 0, 150, 150, 150, 150, 150, 150, 150] },
  { id: 'kok045', account: '61552700', name: "Electrical & Mechanical Equipment (POMEC)", amounts: [0, 0, 0, 0, 0, 150, 150, 150, 150, 150, 150, 150] },
  { id: 'kok046', account: '61556700', name: "Kitchen Equipment -606 300 (POMEC)", amounts: [0, 0, 0, 0, 0, 1200, 1200, 1200, 1200, 1200, 1200, 1200] },
  { id: 'kok047', account: '61558700', name: "Life Safety (POMEC)", amounts: [0, 0, 0, 0, 0, 12, 12, 12, 12, 12, 12, 12] },
  { id: 'kok048', account: '61559700', name: "Plumbing (POMEC)", amounts: [0, 0, 0, 0, 0, 80, 80, 80, 80, 80, 80, 80] },
  { id: 'kok049', account: '61220700', name: "Other R&M (POMEC)", amounts: [0, 0, 0, 0, 0, 100, 100, 100, 100, 100, 100, 100] },
  { id: 'kok050', account: '61525700', name: "Waste Removal (POMEC)", amounts: [0, 0, 0, 0, 0, 200, 200, 200, 200, 200, 200, 200] },
  { id: 'kok051', account: '61551700', name: "Vehicle Repairs and Maintenance (POMEC)", amounts: [0, 0, 0, 0, 0, 5000, 0, 0, 0, 0, 0, 0] },
  { id: 'kok052', account: '61560700', name: "Contract Services (POMEC)", amounts: [0, 0, 0, 0, 0, 0, 1088.53, 698.53, 698.53, 1088.53, 698.53, 698.53] },
  { id: 'kok053', account: '60610700', name: "Electricity (POMEC)", amounts: [0, 0, 0, 0, 0, 1600, 4100, 4100, 2800, 2500, 2500, 2500] },
  { id: 'kok054', account: '60611700', name: "Gas (POMEC)", amounts: [0, 0, 0, 0, 0, 120, 250, 250, 250, 250, 250, 250] },
  { id: 'kok055', account: '60612700', name: "Water (POMEC)", amounts: [0, 0, 0, 0, 0, 150, 300, 300, 300, 300, 300, 300] },
  { id: 'kok056', account: '61320900', name: "Rent Expense Hotels (Rent Property and Other Taxes)", amounts: [0, 0, 0, 0, 0, 32433.33, 35933.33, 32433.33, 32433.33, 28503.33, 28103.33, 28103.33] },
  { id: 'kok057', account: '63512900', name: "Property & Other Taxes (Rent Property and Other Taxes)", amounts: [0, 0, 0, 0, 0, 53396.58, 53396.58, 53396.58, 53396.58, 53396.58, 53396.58, 53396.58] },
  { id: 'kok058', account: '61630900', name: "Insurance (Rent Property and Other Taxes)", amounts: [0, 0, 0, 0, 0, 908.81, 908.81, 908.81, 908.81, 908.81, 908.81, 908.81] },
  { id: 'kok059', account: '63583900', name: "Non Operating Cost Recovery Expense (Rent Property and Other Taxes)", amounts: [0, 0, 0, 0, 0, 166.67, 166.67, 166.67, 166.67, 166.67, 166.67, 166.67] },
  { id: 'kok060', account: '62262300', name: "RH externalisée (SILAE, Veillerot, DRH, Gestion sociale PBEX) (H&R)", amounts: [0, 0, 0, 0, 0, 683.32, 1489.32, 1489.32, 1514.73, 1359.32, 1359.32, 1518.13] },
  { id: 'kok061', account: '64811300', name: "Pharmacie - médecine du travail (Ametra) (H&R)", amounts: [0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50] },
  { id: 'kok062', account: '62261300', name: "Frais de recrutement (H&R)", amounts: [0, 0, 0, 0, 0, 0, 0, 11702.33, 0, 0, 0, 0] },
];
