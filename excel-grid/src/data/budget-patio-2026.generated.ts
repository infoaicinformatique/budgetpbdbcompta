/**
 * BUDGET 2026 — FICHIER GÉNÉRÉ, NE PAS MODIFIER À LA MAIN.
 *
 * Source  : 5- PL PATIO 2026 -EMA.xlsx, feuille « BUDGET EMA »
 * Société : LPM test
 * Généré  : 2026-07-27 par scripts/import-budget.mjs
 *
 * Contrôlé contre la feuille « P&L SYNTHESE », corrigée des écarts assumés
 * (61351400 : le détail fait foi contre le sous-total figé) :
 *   GOP 5 769 650 · EBITDA 2 641 705
 *   (P&L Excel brut : GOP 5 771 182 · EBITDA 2 643 236)
 *
 * Pour réimporter : node --experimental-strip-types scripts/import-budget.mjs "chemin.xlsx"
 */
import type { BudgetLine } from '../engine/chart';

export const BUDGET_COMPANY = "LPM test";
export const BUDGET_YEAR = 2026;
export const BUDGET_SOURCE = "5- PL PATIO 2026 -EMA.xlsx";

/** Totaux du P&L Excel, servant de contrôle aux tests. */
export const BUDGET_CONTROLS = {
  "revenue": 12684368.150000002,
  "charges": 10042663.228987642,
  "otherTaxes": 3127945.49978544,
  "gop": 5769650.420797797,
  "ebitda": 2641704.9210123564
};

export const BUDGET_LINES: BudgetLine[] = [
  { id: 'pat001', account: '60101100', name: "Achats Boissons", amounts: [6701.2, 18760.11, 53297.69, 42841.59, 126785.22, 159551.16, 210226.53, 199354.35, 89189.91, 47369.84, 11726, 57366.87] },
  { id: 'pat002', account: '60103100', name: "Achats Foods", amounts: [9594.9, 26861.07, 76312.6, 61341.37, 179310.53, 225650.93, 297320.38, 281944.01, 126140.02, 67824.99, 16789.5, 82138.92] },
  { id: 'pat003', account: '60610100', name: "Cleaning supplies", amounts: [0, 500, 0, 500, 0, 500, 500, 500, 0, 500, 0, 500] },
  { id: 'pat004', account: '60630100', name: "China expense", amounts: [0, 1818.18, 1818.18, 1818.18, 1818.18, 1818.18, 1818.18, 1818.18, 1818.18, 1818.18, 1818.18, 1818.18] },
  { id: 'pat005', account: '60631100', name: "Flatware expense", amounts: [0, 909.09, 909.09, 909.09, 909.09, 909.09, 909.09, 909.09, 909.09, 909.09, 909.09, 909.09] },
  { id: 'pat006', account: '60632100', name: "Operating supplies", amounts: [0, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100] },
  { id: 'pat007', account: '60633100', name: "Glassware expense", amounts: [0, 909.09, 909.09, 909.09, 909.09, 909.09, 909.09, 909.09, 909.09, 909.09, 909.09, 909.09] },
  { id: 'pat008', account: '60634100', name: "Fournitures décorations", amounts: [0, 2500, 2500, 2500, 2500, 2500, 2500, 2500, 2500, 2500, 2500, 15000] },
  { id: 'pat009', account: '60635100', name: "Ustensils", amounts: [0, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000] },
  { id: 'pat010', account: '60636100', name: "Uniform cost", amounts: [0, 1500, 1500, 1500, 2000, 2000, 2000, 1500, 1500, 2000, 1500, 1500] },
  { id: 'pat011', account: '60637100', name: "Menus & beverage", amounts: [0, 545.45, 545.45, 545.45, 545.45, 545.45, 545.45, 545.45, 545.45, 545.45, 545.45, 545.45] },
  { id: 'pat012', account: '61111100', name: "ST DJ Résident", amounts: [300, 1200, 2400, 1800, 2550, 1800, 4650, 4650, 2400, 1950, 1950, 2100] },
  { id: 'pat013', account: '61114100', name: "ST Programmation", amounts: [1700, 6800, 13600, 10200, 15300, 10200, 26350, 26350, 15300, 12750, 11050, 11900] },
  { id: 'pat014', account: '61351100', name: "Contracts services", amounts: [0, 0, 5000, 0, 0, 5000, 0, 0, 0, 0, 0, 0] },
  { id: 'pat015', account: '61530100', name: "Laundry and dry cleaning", amounts: [972, 3011.4, 6114.6, 6449.4, 12817.8, 17710.2, 26683.2, 24532.2, 9601.2, 5904, 1665, 7533] },
  { id: 'pat016', account: '61531100', name: "Uniform laundry", amounts: [10.8, 33.46, 67.94, 71.66, 142.42, 196.78, 296.48, 272.58, 106.68, 65.6, 18.5, 83.7] },
  { id: 'pat017', account: '62342100', name: "Offerts Nourriture (10%)", amounts: [76.15, 3996.07, 7615.07, 8329.99, 14421.17, 15916.62, 17679.45, 17550.02, 12801.98, 8296.48, 7373.85, 7550.02] },
  { id: 'pat018', account: '64110100', name: "Rémunération du personnel", amounts: [93815.13, 99675.81, 143069.44, 160403.38, 209567.88, 231086.63, 246349.13, 246349.13, 210819.13, 156697.75, 148447.75, 147196.5] },
  { id: 'pat019', account: '64510100', name: "Charges sociales URSSAF", amounts: [36438.05, 39870.32, 57227.78, 64161.35, 83827.15, 92434.65, 98539.65, 98539.65, 84327.65, 62679.1, 59379.1, 58878.6] },
  { id: 'pat020', account: '65120100', name: "Redevances SACEM", amounts: [2465.43, 1455.82, 4342.05, 3240.85, 10236.81, 14129.54, 16390.24, 15545.97, 7317.37, 4332.43, 934.42, 4317.53] },
  { id: 'pat021', account: '65123100', name: "Redevances Marque", amounts: [1631.79, 4782.49, 14264.05, 10646.49, 33628.88, 46416.86, 53843.5, 51069.99, 24038.24, 14232.46, 3069.64, 14183.49] },
  { id: 'pat022', account: '60640200', name: "Fournitures administratives", amounts: [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100] },
  { id: 'pat023', account: '61351200', name: "Contract services", amounts: [2902.78, 2902.78, 2902.78, 2902.78, 2902.78, 2902.78, 2902.78, 2902.78, 2902.78, 2902.78, 2902.78, 2902.78] },
  { id: 'pat024', account: '62261200', name: "Honoraires CAC", amounts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 13500] },
  { id: 'pat025', account: '62262200', name: "Honoraires EC", amounts: [2110, 2110, 2110, 2660, 2110, 2110, 2110, 2110, 2110, 2110, 2110, 2110] },
  { id: 'pat026', account: '62263200', name: "Honoraires JURIDIQUE", amounts: [0, 0, 0, 0, 0, 0, 3000, 0, 0, 0, 0, 0] },
  { id: 'pat027', account: '62264200', name: "Honoraires DIVERS", amounts: [8250, 8250, 8250, 8250, 8250, 8250, 8250, 8250, 8250, 8250, 8250, 8250] },
  { id: 'pat028', account: '62780200', name: "Prestations de services bancaires", amounts: [30.46, 85.27, 242.26, 194.73, 603.74, 759.77, 1001.08, 949.31, 424.71, 215.32, 53.3, 260.76] },
  { id: 'pat029', account: '62781200', name: "Frais bancaires CB", amounts: [1142.25, 3197.75, 9084.83, 7302.54, 22640.22, 28491.28, 37540.45, 35598.99, 15926.77, 8074.4, 1998.75, 9778.44] },
  { id: 'pat030', account: '62811200', name: "Cotisations professionnelles", amounts: [307, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: 'pat031', account: '62261300', name: "Frais de recrutement", amounts: [500, 0, 0, 0, 3000, 0, 0, 0, 0, 0, 0, 0] },
  { id: 'pat032', account: '62262300', name: "RH externalisée", amounts: [906.75, 1006.49, 1568.68, 1768.16, 2433.11, 2690.02, 2871.37, 2871.37, 2448.23, 1722.82, 1632.15, 1617.04] },
  { id: 'pat033', account: '62510300', name: "Déplacements, missions, réceptions", amounts: [0, 0, 0, 2500, 2500, 0, 0, 0, 2500, 2500, 0, 0] },
  { id: 'pat034', account: '62811300', name: "Dues & souscription expenses", amounts: [635, 649.85, 733.55, 763.25, 862.25, 900.5, 927.5, 927.5, 864.5, 756.5, 743, 740.75] },
  { id: 'pat035', account: '64811300', name: "Pharmacie - medecine du travail", amounts: [700, 0, 0, 800, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: 'pat036', account: '61351400', name: "Contract services", amounts: [130.87, 327.33, 127.33, 327.33, 127.33, 327.33, 127.33, 327.33, 127.33, 327.33, 127.33, 127.33] },
  { id: 'pat037', account: '60632500', name: "Operating Supplies", amounts: [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100] },
  { id: 'pat038', account: '61352500', name: "TPE", amounts: [-320, -334.85, -418.55, -448.25, -547.25, -585.5, -612.5, -612.5, -549.5, -441.5, -428, -425.75] },
  { id: 'pat039', account: '61353500', name: "Until", amounts: [1330.13, 1333.67, 1683.67, 1333.67, 1333.67, 1333.67, 1333.67, 1333.67, 1333.67, 1333.67, 1333.67, 1333.67] },
  { id: 'pat040', account: '61355500', name: "Serveur", amounts: [446.25, 425, 425, 425, 425, 425, 425, 425, 425, 425, 425, 425] },
  { id: 'pat041', account: '61561500', name: "Aic", amounts: [628, 628, 628, 628, 628, 628, 628, 628, 628, 628, 628, 628] },
  { id: 'pat042', account: '62611500', name: "Frais télécommunications", amounts: [351.89, 351.89, 351.89, 351.89, 351.89, 351.89, 351.89, 351.89, 351.89, 351.89, 351.89, 351.89] },
  { id: 'pat043', account: '60632600', name: "Operating supplies", amounts: [0, 1000, 0, 0, -6700, -8200, -8000, -8200, -8200, 1200, 0, 0] },
  { id: 'pat044', account: '62220600', name: "Agency fees", amounts: [228.45, 669.55, 1996.97, 1490.51, 4708.04, 6498.36, 7538.09, 7149.8, 3365.35, 1992.54, 429.75, 1985.69] },
  { id: 'pat045', account: '62264600', name: "Contract service-graphiste", amounts: [0, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100] },
  { id: 'pat046', account: '62265600', name: "Photography - Video", amounts: [0, 0, 0, 0, 4500, 6300, 1500, 2000, 7200, 0, 0, 1200] },
  { id: 'pat047', account: '62266600', name: "Outside sales representation", amounts: [2016.67, 2016.67, 2016.67, 2016.67, 2016.67, 2016.67, 2016.67, 2016.67, 2016.67, 2016.67, 2016.67, 2016.67] },
  { id: 'pat048', account: '62313600', name: "Promotions", amounts: [200, 250, 400, 400, 400, 400, 650, 650, 550, 450, 450, 650] },
  { id: 'pat049', account: '62340600', name: "Cadeaux divers", amounts: [0, 1470.45, 1470.45, 1470.45, 1470.45, 1470.45, 1470.45, 1470.45, 1470.45, 1470.45, 1470.45, 1470.45] },
  { id: 'pat050', account: '60610700', name: "Electricité", amounts: [500, 5000, 5000, 5000, 6000, 6000, 6000, 6000, 6000, 5000, 5000, 5000] },
  { id: 'pat051', account: '60611700', name: "Gaz", amounts: [100, 1000, 1000, 1000, 1500, 1500, 1500, 1500, 1000, 1000, 1000, 1000] },
  { id: 'pat052', account: '60612700', name: "Eau", amounts: [1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500] },
  { id: 'pat053', account: '60613700', name: "Other fuels", amounts: [0, 1200, 0, 1200, 1200, 0, 1200, 1200, 1200, 0, 1200, 1200] },
  { id: 'pat054', account: '60615700', name: "Carburants - Véhicules", amounts: [2052.76, 2052.76, 2052.76, 2052.76, 2052.76, 2052.76, 2052.76, 2052.76, 2052.76, 2052.76, 2052.76, 2052.76] },
  { id: 'pat055', account: '60632700', name: "Operating supplies", amounts: [52.27, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400] },
  { id: 'pat056', account: '60633700', name: "Light bulbs", amounts: [56.6, 150, 150, 150, 150, 150, 150, 150, 150, 150, 150, 150] },
  { id: 'pat057', account: '60634700', name: "Painting and wallcovering", amounts: [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100] },
  { id: 'pat058', account: '61121700', name: "Sous Traitance Multitech", amounts: [8000, 9341.64, 9341.64, 9341.64, 9341.64, 9341.64, 9341.64, 9341.64, 9341.64, 8008, 8008, 8008] },
  { id: 'pat059', account: '61520700', name: "Entretien immobilier", amounts: [27714.79, 1375, 1666.67, 1666.67, 1666.67, 1666.67, 1666.67, 1666.67, 1666.67, 1666.67, 1666.67, 1666.67] },
  { id: 'pat060', account: '61524700', name: "Grounds maintenance & landscaping", amounts: [120, 120, 120, 120, 120, 120, 120, 120, 120, 120, 120, 120] },
  { id: 'pat061', account: '61525700', name: "Waste removal", amounts: [800, 800, 800, 800, 800, 1500, 1500, 1500, 1500, 800, 800, 800] },
  { id: 'pat062', account: '61550700', name: "HVAC equipment", amounts: [200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200] },
  { id: 'pat063', account: '61552700', name: "Electrical & mechanical equipment", amounts: [250, 250, 250, 250, 250, 250, 250, 250, 250, 250, 250, 250] },
  { id: 'pat064', account: '61555700', name: "Furniture & equipment", amounts: [125, 125, 125, 125, 125, 125, 125, 125, 125, 125, 125, 125] },
  { id: 'pat065', account: '61556700', name: "Maintenance cuisine", amounts: [326, 326, 326, 326, 326, 326, 326, 326, 326, 326, 326, 326] },
  { id: 'pat066', account: '61558700', name: "Life safety", amounts: [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100] },
  { id: 'pat067', account: '61559700', name: "Plumbing", amounts: [150, 150, 150, 150, 150, 150, 150, 150, 150, 150, 150, 150] },
  { id: 'pat068', account: '61560700', name: "Contrats oblig. - verif.", amounts: [832.49, 832.49, 832.49, 832.49, 832.49, 832.49, 832.49, 832.49, 832.49, 832.49, 832.49, 832.49] },
  { id: 'pat069', account: '61566700', name: "Contrat d'entretien", amounts: [2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000] },
  { id: 'pat070', account: '61180900', name: "ST Admnistrative PBEX", amounts: [91419.5, 91419.5, 91419.5, 91419.5, 91419.5, 91419.5, 91419.5, 91419.5, 91419.5, 91419.5, 91419.5, 91419.5] },
  { id: 'pat071', account: '61181900', name: "ST Adminitrative CBSA", amounts: [21487.9, 21487.9, 21487.9, 21487.9, 21487.9, 21487.9, 21487.9, 21487.9, 21487.9, 21487.9, 21487.9, 21487.9] },
  { id: 'pat072', account: '61320900', name: "Loc. Immob. Principal", amounts: [105703.07, 105703.07, 105703.07, 105703.07, 105703.07, 105703.07, 105703.07, 105703.07, 105703.07, 105703.07, 105703.07, 105703.07] },
  { id: 'pat073', account: '61480900', name: "Charges locative CBSA", amounts: [17811.84, 17811.84, 17811.84, 17811.84, 17811.84, 17811.84, 17811.84, 17811.84, 17811.84, 17811.84, 17811.84, 17811.84] },
  { id: 'pat074', account: '63511900', name: "CFE", amounts: [400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400] },
  { id: 'pat075', account: '63513900', name: "CVAE", amounts: [1189.16, 1189.16, 1189.16, 1189.16, 1189.16, 1189.16, 1189.16, 1189.16, 1189.16, 1189.16, 1189.16, 1189.16] },
  { id: 'pat076', account: '70102100', name: "Beverage Lunch Revenue (10%)", amounts: [30460, 64089.74, 73622.98, 56824.14, 0, 66083.05, 0, 0, 0, 41791.02, 0, 60990] },
  { id: 'pat077', account: '70103100', name: "Beverage Dinner Revenue (10%)", amounts: [0, 21183.49, 168639.24, 137910.37, 523739.16, 693684.39, 1001078.72, 869306.42, 344713.86, 173526.43, 53300, 199768.48] },
  { id: 'pat078', account: '70104100', name: "Beverage Other Allowance Events (10%)", amounts: [0, 0, 0, 0, 80000, 0, 0, 80000, 80000, 0, 0, 0] },
  { id: 'pat079', account: '70105200', name: "Food Lunch Revenue (10%)", amounts: [45690, 96134.6, 110434.48, 85236.21, 0, 99124.58, 0, 0, 0, 62686.52, 0, 91485] },
  { id: 'pat080', account: '70106100', name: "Food Dinner Revenue (10%)", amounts: [0, 31775.24, 252958.85, 206865.55, 785608.74, 1040526.59, 1501618.08, 1303959.64, 517070.79, 260289.64, 79950, 299652.73] },
  { id: 'pat081', account: '70106200', name: "Food Other Allowance Events (10%)", amounts: [0, 0, 0, 0, 120000, 0, 0, 120000, 120000, 0, 0, 0] },
  { id: 'pat082', account: '70880200', name: "Revenus Divers Groupe(20%)", amounts: [0, 0, 50000, 0, 50000, 256701.66, 0, 0, 50000, 115887.76, 0, 0] },
  { id: 'pat083', account: '70881200', name: "Revenus Divers hors Groupe (20%)", amounts: [0, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000] },
];
