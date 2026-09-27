const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
} = require('docx');

const OLIVE = '3F4A24';
const OLIVE_DARK = '2C3419';
const GOLD = 'B08D45';
const MUTED = '5F5E5A';

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 320, after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: OLIVE } },
    children: [new TextRun({ text, bold: true, color: OLIVE_DARK, size: 26 })],
  });
}

function item(title, desc) {
  return new Paragraph({
    spacing: { after: 140 },
    indent: { left: 260 },
    children: [
      new TextRun({ text: '•  ', bold: true, color: GOLD }),
      new TextRun({ text: title + ' — ', bold: true, size: 21 }),
      new TextRun({ text: desc, size: 21 }),
    ],
  });
}

const doc = new Document({
  styles: {
    default: { document: { run: { font: 'Calibri', size: 21 } } },
  },
  sections: [{
    properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } } },
    children: [
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { after: 40 },
        children: [new TextRun({ text: 'Palm Beach Cannes — Budget Manager', bold: true, size: 32, color: OLIVE_DARK })],
      }),
      new Paragraph({
        spacing: { after: 300 },
        children: [new TextRun({ text: 'Avancement du projet — semaine du 30 juillet au 4 août 2026', italics: true, size: 21, color: MUTED })],
      }),

      h1('Pilotage budgétaire'),
      item('Indicateurs d’activité, masse salariale détaillée, scénarios', 'Trois scénarios (prudent / réaliste / optimiste) appliqués au budget, une masse salariale calculée collaborateur par collaborateur (charges, primes, congés payés).'),
      item('Seuil de rentabilité (point mort)', 'Calculé automatiquement, avec le détail jour par jour du calcul accessible en un clic.'),
      item('Modèles de budget réutilisables', 'Un budget type peut être dupliqué vers une nouvelle société ou un nouvel exercice.'),
      item('Nouvel onglet Ajustements', 'Regroupe les leviers de pilotage (scénarios, points morts, ratios) séparément de la saisie brute.'),

      h1('Nouveaux onglets de saisie'),
      item('Forecast Day by Day', 'Suivi du chiffre d’affaires réalisé jour par jour face à l’objectif, avec projection de fin de mois.'),
      item('Onglet CA dédié', 'Le chiffre d’affaires se budgète et se suit jour par jour ou mois par mois, dans un tableau à part, avec recherche et navigation clavier.'),
      item('Onglet Payroll détaillé', 'Masse salariale complète par collaborateur : provision de congés payés correcte (provisionnée puis extournée chaque mois), impact automatique sur le budget, calendrier des dates.'),

      h1('Fiabilité et corrections'),
      item('Consolidation simplifiée', 'Une synthèse KPI et ratios remplace l’ancien compte de résultat complet, plus lisible pour une vue multi-sociétés.'),
      item('Corrections de fond', 'Masse salariale qui apparaissait deux fois dans le compte de résultat, point mort qui ignorait la masse salariale, collaborateurs saisis absents de la vue budget — tous corrigés.'),
      item('Revue générale', 'Passage sur la mémoire et la fiabilité de l’application pour un usage prolongé sans ralentissement.'),

      h1('Ergonomie'),
      item('Mise en page uniforme', 'Tous les onglets suivent désormais la même structure, colonnes redimensionnables, navigation clavier étendue.'),
      item('Recherche et alertes', 'La recherche globale couvre maintenant aussi les comptes de chiffre d’affaires ; une alerte prévient avant d’atteindre la limite de stockage du navigateur.'),
      item('Export PDF du budget CA', 'Impression propre et présentable du budget de chiffre d’affaires.'),

      h1('Identité visuelle'),
      item('Thème sombre', 'Un mode sombre complet a été ajouté, avec correction des quelques textes restés peu lisibles.'),
      item('Passage au vert olive', 'La couleur bleue d’origine a été remplacée par un vert olive dans toute l’application (écran et fichiers Excel exportés), à la demande d’Alexis.'),

      h1('Export et consolidation'),
      item('Nouveau tableau Consolidation', 'Le fichier Excel de consolidation compare maintenant, société par société, le réalisé de l’an dernier (saisi à la main, avec collage en masse depuis Excel) au budget en cours, écarts et ratio inclus — plus une page de cumul global.'),
      item('Export enrichi', 'Choix des colonnes à exporter, comparatif entre deux périodes, noms de fichiers explicites (société/groupe + date), aperçu avant export avec sous-totaux.'),
      item('Cohérence visuelle des exports', 'Tous les fichiers Excel générés reprennent désormais la même charte que l’application.'),
    ],
  }],
});

Packer.toBuffer(doc).then((buf) => {
  require('fs').writeFileSync('recap-avancement.docx', buf);
  console.log('written');
});
