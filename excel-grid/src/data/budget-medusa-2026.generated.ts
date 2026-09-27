/**
 * BUDGET 2026 — FICHIER GÉNÉRÉ, NE PAS MODIFIER À LA MAIN.
 *
 * Source  : 2- PL MEDUSA 2026  EMA.xlsx, feuille « BUDGET EMA »
 * Société : Medusa test
 * Généré  : 2026-07-28 par scripts/import-medusa.mjs
 *
 * Contrôlé contre la feuille « P&L SYNTHESE », corrigée de l'écart assumé
 * (61351400 : le détail fait foi contre le sous-total « Material » figé) :
 *   GOP 12 165 934 · EBITDA 6 830 643
 *   (P&L Excel brut : GOP 12 167 462 · EBITDA 6 832 171)
 *
 * Pour réimporter : node --experimental-strip-types scripts/import-medusa.mjs "chemin.xlsx"
 */
import type { BudgetLine } from '../engine/chart';

export const BUDGET_COMPANY = "Medusa test";
export const BUDGET_YEAR = 2026;
export const BUDGET_SOURCE = "2- PL MEDUSA 2026  EMA.xlsx";

/** Totaux du P&L Excel, servant de contrôle aux tests. */
export const BUDGET_CONTROLS = {
  "revenue": 21992000,
  "charges": 15161356.639361614,
  "otherTaxes": 5335290.235194946,
  "gop": 12165933.595833331,
  "ebitda": 6830643.360638388
};

export const BUDGET_LINES: BudgetLine[] = [
  { id: 'med001', account: '60101100', name: "Achats Boissons", amounts: [0, 0, 130480, 0, 490000, 428400, 840000, 840000, 350000, 0, 0, 0] },
  { id: 'med002', account: '60103100', name: "Achats Foods", amounts: [0, 0, 27960, 0, 105000, 91800, 180000, 180000, 75000, 0, 0, 0] },
  { id: 'med003', account: '60610100', name: "Cleaning supplies", amounts: [0, 0, 0, 0, 1000, 3000, 3000, 3000, 3000, 0, 0, 0] },
  { id: 'med004', account: '60630100', name: "China expense", amounts: [0, 0, 0, 0, 6000, 6000, 6000, 6000, 6000, 0, 0, 0] },
  { id: 'med005', account: '60631100', name: "Flatware expense", amounts: [0, 0, 0, 0, 1919.17, 1919.17, 1919.17, 1919.17, 2000, 0, 0, 0] },
  { id: 'med006', account: '60632100', name: "Operating supplies", amounts: [0, 0, 0, 0, 700, 700, 700, 700, 700, 0, 0, 0] },
  { id: 'med007', account: '60633100', name: "Glassware expense", amounts: [0, 0, 0, 0, 0, 2000, 3000, 3000, 2000, 0, 0, 0] },
  { id: 'med008', account: '60634100', name: "Fournitures décorations", amounts: [0, 0, 0, 0, 10000, 10000, 1000, 1000, 1000, 0, 0, 0] },
  { id: 'med009', account: '60635100', name: "Ustensils", amounts: [0, 0, 0, 750.5, 750.5, 750.5, 0, 750.5, 750.5, 750.5, 0, 0] },
  { id: 'med010', account: '60636100', name: "Uniform cost", amounts: [0, 0, 0, 0, 5489, 5489, 5489, 5489, 5489, 0, 0, 0] },
  { id: 'med011', account: '60637100', name: "Menus & beverage", amounts: [0, 0, 0, 0, 15500, 15500, 15500, 15500, 15500, 0, 0, 0] },
  { id: 'med012', account: '61111100', name: "ST DJ Résident", amounts: [0, 0, 40000, 0, 224000, 180000, 256000, 256000, 180000, 0, 0, 0] },
  { id: 'med013', account: '61113100', name: "ST Technique", amounts: [0, 0, 0, 0, 28275, 30825, 31250, 32100, 23775, 0, 0, 0] },
  { id: 'med014', account: '61114100', name: "ST Programmation", amounts: [0, 0, 0, 0, 30000, 0, 35000, 35000, 0, 0, 0, 0] },
  { id: 'med015', account: '61351100', name: "Contracts services", amounts: [0, 0, 0, 0, 3000, 3000, 3000, 3000, 3000, 0, 0, 0] },
  { id: 'med016', account: '61530100', name: "Laundry and dry cleaning", amounts: [0, 0, 0, 0, 9450, 11550, 18900, 21000, 8400, 0, 0, 0] },
  { id: 'med017', account: '61531100', name: "Uniform laundry", amounts: [0, 0, 0, 0, 500, 500, 500, 500, 500, 0, 0, 0] },
  { id: 'med018', account: '62342100', name: "Offerts Nourriture (10%)", amounts: [0, 0, 2796, 0, 21682.08, 23004, 32760.96, 32760.96, 19941.6, 0, 0, 0] },
  { id: 'med019', account: '64110100', name: "Rémunération du personnel", amounts: [4812.5, 4812.5, 38828.75, 4812.5, 262368.75, 259893.75, 267318.75, 267318.75, 236312.5, 4812.5, 4812.5, 4812.5] },
  { id: 'med020', account: '64510100', name: "Charges sociales URSSAF", amounts: [1925, 1925, 15531.5, 1925, 104947.5, 103957.5, 106927.5, 106927.5, 94525, 1925, 1925, 1925] },
  { id: 'med021', account: '65120100', name: "Redevances SACEM", amounts: [0, 0, 23463.1, 0, 88112.5, 77035.5, 151050, 151050, 62937.5, 0, 0, 0] },
  { id: 'med022', account: '60632200', name: "Operating supplies", amounts: [0, 0, 200, 0, 0, 200, 200, 200, 200, 0, 0, 0] },
  { id: 'med023', account: '61351200', name: "Contract services", amounts: [2902.78, 2902.78, 2902.78, 2902.78, 2902.78, 2902.78, 2902.78, 2902.78, 2902.78, 2902.78, 2902.78, 2899.08] },
  { id: 'med024', account: '62261200', name: "Honoraires CAC", amounts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 12600] },
  { id: 'med025', account: '62262200', name: "Honoraires EC", amounts: [1700, 1600, 1600, 1600, 1600, 1600, 1600, 1600, 1600, 1600, 1600, 1600] },
  { id: 'med026', account: '62264200', name: "Honoraires DIVERS", amounts: [0, 0, 0, 0, 15800, 15800, 19800, 19800, 15800, 0, 0, 10000] },
  { id: 'med027', account: '62610200', name: "Frais de poste", amounts: [0, 0, 100, 0, 0, 100, 100, 100, 100, 0, 0, 0] },
  { id: 'med028', account: '62780200', name: "Prestations de services bancaires", amounts: [200, 200, 745.6, 200, 2800, 2448, 4800, 4800, 2000, 200, 200, 200] },
  { id: 'med029', account: '62781200', name: "Frais bancaires CB", amounts: [0, 0, 15844, 0, 59500, 52020, 102000, 102000, 42500, 0, 0, 0] },
  { id: 'med030', account: '62811200', name: "Cotisations professionnelles", amounts: [0, 307, 0, 2000, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: 'med031', account: '62261300', name: "Frais de recrutement", amounts: [0, 0, 0, 0, 1100, 1500, 600, 600, 600, 0, 0, 0] },
  { id: 'med032', account: '62262300', name: "RH externalisée", amounts: [21.16, 21.16, 368.75, 21.16, 2750.48, 2720.25, 2810.93, 2810.93, 2448.23, 21.16, 21.16, 21.16] },
  { id: 'med033', account: '62510300', name: "Déplacements, missions, réceptions", amounts: [0, 0, 5000, 0, 0, 2000, 0, 0, 2000, 5000, 0, 0] },
  { id: 'med034', account: '62811300', name: "Dues & souscription expenses", amounts: [300, 300, 300, 300, 300, 300, 300, 300, 300, 300, 300, 300] },
  { id: 'med035', account: '64811300', name: "Pharmacie - medecine du travail", amounts: [0, 0, 0, 0, 500, 2200, 0, 0, 0, 0, 0, 0] },
  { id: 'med036', account: '61351400', name: "Contract services", amounts: [127.33, 127.33, 127.33, 127.33, 427.33, 427.33, 427.33, 427.33, 427.33, 127.33, 127.33, 127.33] },
  { id: 'med037', account: '60632500', name: "Operating Supplies", amounts: [0, 0, 0, 0, 0, 500, 0, 0, 0, 0, 0, 0] },
  { id: 'med038', account: '61352500', name: "TPE", amounts: [388, 388, 388, 508, 1300, 1300, 1300, 1300, 1300, 508, 388, 388] },
  { id: 'med039', account: '61353500', name: "Until", amounts: [1167.41, 1167.41, 1167.41, 1167.41, 1167.41, 1167.41, 1167.41, 1167.41, 1167.41, 1167.41, 1167.41, 1167.41] },
  { id: 'med040', account: '61355500', name: "Serveur", amounts: [283, 283, 283, 283, 283, 283, 283, 283, 283, 283, 283, 283] },
  { id: 'med041', account: '61561500', name: "Aic", amounts: [948, 1211, 3243, 1211, 3243, 3243, 3243, 3243, 3243, 1211, 1211, 1211] },
  { id: 'med042', account: '62611500', name: "Frais télécommunications", amounts: [65, 65, 65, 65, 65, 65, 65, 65, 65, 65, 65, 65] },
  { id: 'med043', account: '60632600', name: "Operating supplies", amounts: [0, 0, 0, -10000, -10000, -10000, -10000, -10000, 0, 0, 0, 0] },
  { id: 'med044', account: '60640600', name: "Printing & stationery", amounts: [0, 0, 0, 0, 1375, 1375, 1375, 375, 0, 0, 0, 0] },
  { id: 'med045', account: '62220600', name: "Agency fees", amounts: [1000, 1000, 1932, 1000, 4500, 4060, 7000, 7000, 3500, 1000, 1000, 1000] },
  { id: 'med046', account: '62265600', name: "Photography - Video", amounts: [0, 0, 0, 0, 8500, 10500, 8500, 3000, 0, 0, 0, 0] },
  { id: 'med047', account: '62266600', name: "Outside sales representation", amounts: [0, 0, 6600, 0, 6600, 6600, 6600, 6600, 0, 0, 0, 0] },
  { id: 'med048', account: '62313600', name: "Promotions", amounts: [0, 0, 1500, 12066.67, 2316.67, 17316.67, 17316.67, 2316.67, 2066.67, 0, 0, 0] },
  { id: 'med049', account: '62340600', name: "Cadeaux divers", amounts: [0, 0, 0, 0, 8125, 8125, 8125, 8125, 8125, 0, 0, 0] },
  { id: 'med050', account: '62620600', name: "Site-Internet", amounts: [0, 0, 0, 1000, 1000, 1400, 1000, 1000, 1000, 0, 0, 0] },
  { id: 'med051', account: '60610700', name: "Electricité", amounts: [0, 0, 5000, 2000, 5000, 7000, 9000, 9000, 7000, 0, 0, 0] },
  { id: 'med052', account: '60611700', name: "Gaz", amounts: [0, 0, 500, 200, 500, 700, 700, 700, 500, 0, 0, 0] },
  { id: 'med053', account: '60612700', name: "Eau", amounts: [0, 0, 2000, 0, 2000, 2000, 2000, 2000, 2000, 0, 0, 0] },
  { id: 'med054', account: '60613700', name: "Other fuels", amounts: [0, 0, 1200, 0, 1200, 1800, 3600, 1800, 1800, 0, 0, 0] },
  { id: 'med055', account: '60632700', name: "Operating supplies", amounts: [10000, 10000, 598, 599, 600, 600, 600, 600, 600, 0, 0, 0] },
  { id: 'med056', account: '60633700', name: "Light bulbs", amounts: [0, 100, 100, 100, 100, 100, 100, 100, 100, 0, 0, 0] },
  { id: 'med057', account: '60634700', name: "Painting and wallcovering", amounts: [0, 0, 500, 0, 500, 0, 500, 0, 500, 0, 0, 0] },
  { id: 'med058', account: '61121700', name: "Sous Traitance Multitech", amounts: [0, 0, 0, 0, 15500, 15500, 15500, 15500, 15500, 0, 0, 0] },
  { id: 'med059', account: '61520700', name: "Entretien immobilier", amounts: [416.67, 416.67, 416.67, 416.67, 416.67, 416.67, 416.67, 416.67, 416.67, 416.67, 416.67, 416.67] },
  { id: 'med060', account: '61523700', name: "Floor covering", amounts: [20000, 20000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: 'med061', account: '61524700', name: "Grounds maintenance & landscaping", amounts: [0, 0, 2000, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: 'med062', account: '61525700', name: "Waste removal", amounts: [0, 0, 588, 588, 588, 588, 1588, 1588, 588, 588, 0, 0] },
  { id: 'med063', account: '61550700', name: "HVAC equipment", amounts: [0, 0, 400, 400, 400, 400, 400, 400, 400, 0, 0, 0] },
  { id: 'med064', account: '61552700', name: "Electrical & mechanical equipment", amounts: [0, 0, 500, 500, 500, 500, 500, 500, 500, 0, 0, 0] },
  { id: 'med065', account: '61555700', name: "Furniture & equipment", amounts: [0, 0, 0, 125, 125, 125, 125, 125, 125, 125, 0, 0] },
  { id: 'med066', account: '61556700', name: "Maintenance cuisine", amounts: [0, 0, 0, 0, 685.5, 685.5, 685.5, 685.5, 685.5, 0, 0, 0] },
  { id: 'med067', account: '61558700', name: "Life safety", amounts: [0, 0, 0, 0, 1000, 0, 0, 0, 0, 0, 0, 0] },
  { id: 'med068', account: '61559700', name: "Plumbing", amounts: [0, 0, 250, 0, 250, 0, 250, 0, 0, 0, 0, 0] },
  { id: 'med069', account: '61560700', name: "Contrats oblig. - verif.", amounts: [0, 0, 0, 500, 4291.6, 3691.6, 3691.6, 3691.6, 3691.6, 0, 0, 0] },
  { id: 'med070', account: '61561700', name: "Contrats de maintenance", amounts: [0, 0, 0, 750.5, 5194.91, 5594.91, 5489.41, 5194.91, 5194.91, 750.5, 0, 0] },
  { id: 'med071', account: '61566700', name: "Contrat d'entretien", amounts: [0, 0, 0, 0, 2500, 2500, 2500, 2500, 2500, 0, 0, 0] },
  { id: 'med072', account: '62261700', name: "Professional fees", amounts: [0, 0, 0, 10000, 0, 0, 0, 0, 0, 10000, 0, 0] },
  { id: 'med073', account: '61180800', name: "Sous traitance Sécurite (groupe)", amounts: [0, 0, 0, 0, 7748.13, 7748.13, 7748.13, 7748.13, 7748.13, 0, 0, 0] },
  { id: 'med074', account: '62140800', name: "Personnel extérieur", amounts: [0, 0, 16500, 0, 118800, 99000, 153450, 153450, 115500, 0, 0, 0] },
  { id: 'med075', account: '61180900', name: "ST Admnistrative PBEX", amounts: [0, 0, 0, 0, 380404.77, 380404.77, 380404.77, 380404.77, 380404.77, 0, 0, -100000] },
  { id: 'med076', account: '61181900', name: "ST Adminitrative CBSA", amounts: [37255.46, 37255.46, 37255.46, 37255.46, 37255.46, 37255.46, 37255.46, 37255.46, 37255.46, 37255.46, 37255.46, 37255.46] },
  { id: 'med077', account: '61320900', name: "Loc. Immob. Principal", amounts: [66666.67, 66666.67, 66666.67, 66666.67, 346506.67, 346506.67, 346506.67, 346506.67, 346506.67, 66666.67, 66666.67, 66666.67] },
  { id: 'med078', account: '61321900', name: "Loc. Immob. Appartements", amounts: [2905, 2905, 2905, 2905, 87405, 87405, 67405, 67405, 67405, 2905, 2905, 2905] },
  { id: 'med079', account: '61480900', name: "Charges locative CBSA", amounts: [35263.24, 35263.24, 35263.24, 35263.24, 35263.24, 35263.24, 35263.24, 35263.24, 35263.24, 35263.24, 35263.24, 35263.24] },
  { id: 'med080', account: '63511900', name: "CFE", amounts: [0, 0, 0, 0, 3400, 3400, 3400, 3400, 3400, 0, 0, 0] },
  { id: 'med081', account: '63513900', name: "CVAE", amounts: [0, 0, 0, 0, 9896.4, 9896.4, 9896.4, 9896.4, 9896.4, 0, 0, 0] },
  { id: 'med082', account: '70103200', name: "Beverage Dinner Revenue (20%)", amounts: [0, 0, 745600, 0, 2800000, 2448000, 4800000, 4800000, 2000000, 0, 0, 0] },
  { id: 'med083', account: '70106100', name: "Food Dinner Revenue (10%)", amounts: [0, 0, 139800, 0, 525000, 459000, 900000, 900000, 375000, 0, 0, 0] },
  { id: 'med084', account: '70880200', name: "Revenus Divers Groupe(20%)", amounts: [0, 0, 46600, 0, 175000, 153000, 300000, 300000, 125000, 0, 0, 0] },
];
