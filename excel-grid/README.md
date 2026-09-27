# Excel Grid

Grille type tableur en React + TypeScript : sélection, poignée de recopie
intelligente, copier-coller avec références relatives, et moteur de formules.

## Démarrer

```bash
npm install
npm run dev        # http://localhost:5173
```

Autres scripts :

```bash
npm run test        # 72 tests (moteur, plan comptable, reducer), sans dépendance
npm run check       # graphe d'imports
npm run check:app   # budget-app.html conforme au moteur (voir plus bas)
npm run import:pcg  # réimporte le plan comptable depuis le classeur Excel
npm run import:budget -- "../budget.xlsx"   # réimporte un budget annuel
npm run typecheck   # vérification TypeScript
npm run verify      # check + test + check:app + typecheck, avant de livrer
npm run build       # build de production
```

`test`, `check`, `check:app` et `import:pcg` ne nécessitent **ni `npm install`
ni réseau** : ils tournent sur une machine nue avec Node ≥ 22.6. Seuls
`typecheck`, `dev` et `build` demandent les dépendances installées.

## Plan comptable et centres de coûts

Le plan comptable réel (`PCG HEMASPHERE FINAL 8.xlsx`) est importé, jamais
recopié à la main :

```bash
npm run import:pcg -- "../PCG HEMASPHERE FINAL 8.xlsx"
```

Le script lit le classeur (lecteur .xlsx maison, sans librairie) et régénère
d'un coup `src/data/pcg.generated.ts`, `../pcg.json` et le bloc de données
embarqué dans `../budget-app.html`. Il signale au passage tout compte dont le
centre de coût manque ou contredit son code.

**1 032 comptes** à 8 chiffres : 52 produits, 320 charges, 660 comptes de
bilan (classes 1 à 5, présents pour référence mais non budgétables).

| Code | Centre | Catégorie de présentation | Dans le GOP |
| --- | --- | --- | --- |
| 1 | F&B | Operating charge | oui |
| 2 | AG | Administration | oui |
| 3 | HR | Human resources | oui |
| 4 | MAT | Material | oui |
| 5 | IT | Informatic et technologie | oui |
| 6 | MARK | Marketing | oui |
| 7 | POMEC | POMEC | oui |
| 8 | SECU | Sécurité | oui |
| 9 | RPOI | Other Taxes | **non** |

D'où, dans `src/engine/chart.ts` :

```
GOP    = Produits − (Total des charges − Other Taxes)
EBITDA = Produits − Total des charges
```

`budget-app.html` embarque une copie de ce noyau de règles pour rester
autonome (ouverture au double-clic, sans build ni réseau). `npm run check:app`
compare les deux implémentations sur une série de scénarios et échoue si
elles divergent.

### Reclassements

`CENTER_OVERRIDES`, dans `chart.ts`, reclasse un compte par-dessus le PCG
importé, sans jamais modifier le fichier généré. Un seul aujourd'hui :
**65123100 Redevances de marque**, que le PCG range en F&B et que le P&L du
groupe présente en frais fixes, sous le GOP. Sans ce reclassement, le GOP de
l'application dépasse celui du classeur de 271 807,90 €.

## Import d'un budget

```bash
npm run import:budget -- "../5- PL PATIO 2026 -EMA.xlsx"
```

Le script lit la feuille « BUDGET EMA » (un compte par ligne, douze mois),
recalcule le P&L avec le moteur, le compare aux totaux de la feuille
« P&L SYNTHESE » — et **refuse d'écrire quoi que ce soit si le GOP ou
l'EBITDA s'écartent de plus d'un euro**. Il génère
`src/data/budget-patio-2026.generated.ts` et le budget embarqué dans
`budget-app.html`, chargé d'office dans la société concernée.

## Architecture

```
scripts/
├── run-tests.js              Lance les suites (type-stripping natif de Node)
├── check-imports.js          Vérifie le graphe d'imports, sans node_modules
├── check-budget-app.mjs      Compare budget-app.html au moteur TypeScript
├── import-pcg.mjs            Importe le plan comptable depuis le .xlsx
├── import-budget.mjs         Importe un budget annuel et le rapproche du P&L
└── lib/
    ├── xlsx-read.mjs         Lecteur .xlsx minimal (ZIP + XML), sans librairie
    └── prepare-ts.mjs        Prépare les sources TS pour Node

src/
├── main.tsx                  Point d'entrée React
├── App.tsx                   Monte <Grid />
├── types.ts                  Types partagés (CellData, CellRange, Selection…)
├── vite-env.d.ts             Types Vite (indispensable aux imports .css)
│
├── engine/                   Logique pure, sans React — testable isolément
│   ├── coords.ts             A1 ⇄ (row, col), colonnes A..Z..AA
│   ├── lexer.ts              Tokenizer de formules (positions conservées)
│   ├── evaluate.ts           Parser descente récursive + évaluateur + cycles
│   ├── refs.ts               Décalage des références relatives ($ = figé)
│   ├── fill.ts               Détection de séries + application de la recopie
│   ├── chart.ts              Plan comptable, centres de coûts, GOP/EBITDA
│   ├── engine.test.ts        30 tests du moteur
│   └── chart.test.ts         21 tests du plan comptable et du budget
│
├── state/
│   ├── gridReducer.ts        useReducer : saisie, sélection, presse-papier,
│   │                         recopie, historique undo/redo
│   └── gridReducer.test.ts   21 tests des transitions
│
├── components/
│   ├── Grid.tsx              Orchestration : clavier, souris, copier-coller
│   ├── Cell.tsx              Cellule (affichage / édition), mémoïsée
│   ├── FormulaBar.tsx        Zone Nom + champ de formule
│   ├── layout.ts             Dimensions partagées CSS ⇄ JS (calques)
│   └── grid.css              Habillage Excel
│
└── data/
    ├── sample.ts                       Grille de démonstration
    ├── pcg.generated.ts                Plan comptable (1 032 comptes)
    └── budget-patio-2026.generated.ts  Budget 2026 (83 lignes)
```

## Ce que l'on peut faire

**Sélection** — clic simple, `Maj`+clic ou clic-glissé pour une plage
contiguë, `Ctrl`+`A` pour tout sélectionner. Les en-têtes de la ligne et de
la colonne concernées se surlignent.

**Poignée de recopie** — le petit carré vert en bas à droite de la
sélection. On le tire vers la droite ou vers le bas (la gauche et le haut
fonctionnent aussi) :

| Contenu source | Résultat |
| --- | --- |
| `1` | 2, 3, 4… |
| `10`, `20` | 30, 40… (pas déduit de l'écart) |
| `01/01/2027` | 02/01/2027, 03/01/2027… |
| `Loyer` | Loyer, Loyer… (recopié tel quel) |
| `X`, `Y` | X, Y, X, Y… (motif répété) |
| `=C4*D4` | `=C5*D5`, `=C6*D6`… (références décalées) |

Pendant le glissement, la zone qui sera remplie s'affiche en surbrillance
verte encadrée (l'« ghost »).

**Copier-coller** — `Ctrl`+`C` entoure la sélection de pointillés animés,
`Ctrl`+`V` colle en conservant la forme rectangulaire. Les formules sont
recollées avec leurs références décalées, comme dans Excel. `Ctrl`+`X`
coupe. Le collage depuis une application externe (Excel, Sheets) est
reconnu au format TSV.

**Formules** — commencer par `=`.

- Opérateurs : `+` `-` `*` `/` `^`, parenthèses, unaire `-`
- Fonctions : `SUM`/`SOMME`, `MOYENNE`/`AVERAGE`, `MIN`, `MAX`, `COUNT`/`NB`, `ABS`, `ROUND`/`ARRONDI`
- Références simples (`A1`), plages (`A1:A5`), `$` pour figer (`$A$1`)
- Erreurs Excel : `#DIV/0!`, `#REF!`, `#NOM?`, `#CYCLE!`
- Séparateur d'arguments : `;` ou `,` — la virgule décimale (`1,05`) est acceptée

**Clavier** — flèches (+`Maj` pour étendre, +`Ctrl` pour aller au bord),
`Tab`, `Entrée`, `F2` ou double-clic pour éditer, `Suppr` pour effacer,
`Ctrl`+`Z` / `Ctrl`+`Y` pour annuler-rétablir. Taper un caractère
directement remplace le contenu de la cellule.

## Choix techniques

**`useReducer` plutôt que Zustand.** Toute la logique métier vit dans
`src/engine` sous forme de fonctions pures ; le reducer ne fait
qu'orchestrer des transitions. L'historique devient alors trivial : on
empile la `CellMap` précédente avant chaque mutation (`pushHistory`).

**Grille creuse.** `CellMap` est un `Record<"row:col", CellData>` : seules
les cellules non vides existent. Une grille 40×12 n'alloue donc que les
quelques cellules réellement remplies.

**`rawValue` / `computedValue` séparés.** La cellule stocke uniquement la
saisie brute. `computeGrid` produit la couche calculée à la demande via un
`useMemo`, avec mémoïsation et détection de cycles (`Set` des cellules en
cours de visite).

**Décalage des références par tokens, pas par regex.** `refs.ts` relit la
formule via le lexer et ne réécrit que les tokens `REF`, en s'appuyant sur
leurs positions. Une chaîne comme `="A1 est un texte"` n'est donc jamais
altérée — ce qu'une substitution regex globale casserait.

**Recopie : position dans la séquence étendue.** Pour chaque cellule cible
on calcule `p`, sa position relative au début de la source (la source
occupe `0..n-1`). Une série vaut `base + step × p` ; un motif non-série
reprend la source à l'index `p mod n`. La même formule gère la recopie
vers la droite/le bas et vers la gauche/le haut (`p` devient négatif).

## Limites connues

- Pas de fusion de cellules, de mise en forme, ni de redimensionnement de colonnes.
- Pas de références entre feuilles (une seule feuille).
- Les comparaisons (`=`, `<`, `>`) sont parsées mais aucune fonction logique
  (`IF`, `SI`) n'est fournie.
