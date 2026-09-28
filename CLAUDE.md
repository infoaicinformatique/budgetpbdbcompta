# CLAUDE.md — Budget Manager (Palm Beach Cannes)

Application de construction budgétaire pour Alexis (contrôleur de gestion),
échéance 1/1/2027. Tout est en français : interface, commentaires, commits,
documentation. Les identifiants JS restent en anglais, en camelCase.

- Production : https://budgetpbdbcompta.aic-informatique.net (auth Basic ;
  identifiants de test dans `CLAUDE.local.md`, jamais dans un fichier suivi).
- Historique, décisions, règles métier : `REPRISE-PROJET.md` (1,8 Mo — ne pas
  le lire en entier, chercher par `grep -n '^##'` ou par date `### `).
- Déploiement et dépannage : `README.md`.

## Carte du dépôt

| Chemin | Rôle |
| --- | --- |
| `budget-app.html` | **L'application entière** (~30 000 lignes, 1,7 Mo), zéro dépendance, zéro réseau |
| `server.mjs` | Serveur Node ≥ 22 : sert seulement `/` (brotli/gzip), `/healthz`, auth Basic (compte local et/ou LDAP) ; tout le reste → 404 |
| `auth-ldap.mjs`, `test/` | Vérification LDAP (seule dépendance : `ldapts`) et ses tests (`npm test`) |
| `excel-grid/` | Prototype tableur React/Vite **et** outillage : moteur de référence `src/engine/chart.ts`, imports, validation |
| `scripts-doc/rebuild-doc.mjs` | Régénère la section 7 de `REPRISE-PROJET.md` |
| `scripts-fx/taux-du-jour.mjs` | Utilitaire manuel : taux BCE (Frankfurter) à recopier dans Sociétés > Taux de change |
| `pcg.json` | Plan comptable en JSON, généré par `import-pcg.mjs` |
| `Dockerfile`, `docker-compose.yml`, `deploy/`, `.github/workflows/` | Production |

Fichiers jetables suivis par git (ne pas s'en servir comme référence) :
`tmp-diag-v2.mjs`, `diag-bonus*.mjs`, `excel-grid/probe*.mjs`,
`excel-grid/gen_test_xlsx*.mjs`, `excel-grid/scripts/tmp-diag*.mjs`,
`excel-grid/scripts/diag.mjs` (diagnostic, pas une validation).
`build-recap.js` est cassé en l'état (CommonJS + `docx` absent).

## Structure de `budget-app.html`

Le fichier est trop gros pour être lu d'un bloc : repérer les zones par grep.

- `<head>` avec CSP stricte (`connect-src 'none'`), puis un seul `<style>`,
  le balisage (`<nav id="tabs">`, boutons `data-tab`), puis deux `<script>`.
- 1er script : **données embarquées générées**, entre marqueurs
  `/* PCG-DATA-START */`, `/* BUDGET-DATA-START */`, `/* EMASPHERE-DATA-START */`
  (lignes uniques de ~100 Ko : ne jamais les éditer à la main, ni les afficher).
- 2e script (`'use strict'`) : l'application. Sections repérées par des
  bannières `/* ====` (SAS RÉSEAU, ÉTAT/persistance, Scénarios, Autorisations,
  Multi-devises, Vues, Onglet CA, Payroll, Exports Excel, Démarrage…).
- `/* CORE-START */` … `/* CORE-END */` : noyau métier pur, extrait et exécuté
  par `check-budget-app.mjs`. **Garder les marqueurs.** Ce noyau existe en
  double dans `excel-grid/src/engine/chart.ts` : toute modification se fait
  des deux côtés (`check:app` détecte la divergence).
- `APP_BUILD = 'AAAA-MM-JJ.N'` : **incrémenter à chaque livraison**.
- Onglets déclarés dans `TAB_GROUPS`.

Invariants techniques :
- **SAS réseau** : `fetch`, XHR, WebSocket… sont neutralisés au démarrage.
  Aucune fonctionnalité ne doit appeler le réseau ni charger de ressource externe.
- Aucune librairie : lecture et écriture .xlsx faites main (ZIP stocké, CRC32).
- Stockage dans le navigateur uniquement : IndexedDB `budget-manager-db`
  (store `kv`, clé `budget-hemasphere-v2`) avec repli localStorage ; le serveur
  ne stocke rien. Toute évolution du format d'état exige une migration.
- Style JS : `function () {}`, `const`/`let`, pas de modules ni de build.

## Règles métier (dictées par Alexis — ne pas les changer sans demande)

- Traçabilité : aucun montant global sur un compte ; chaque euro passe par une
  **ligne nommée**. Aucune ligne n'est écartée en silence.
- `GOP = Produits − charges hors centre 9 (RPOI/Other Taxes)`,
  `EBITDA = Produits − total des charges`.
- Clé : numéro de compte 2026 à 8 chiffres ; 9 centres de coût.
  Comptes de bilan et 61110100 (« à classer ») refusés.
  `CENTER_OVERRIDES` : 65123100 → RPOI.
- Les imports sont toujours automatisés (scripts), jamais recopiés à la main.
  Les scripts d'import de budget refusent d'écrire si GOP/EBITDA s'écartent de
  plus d'un euro du classeur source.
- Pièges connus : 62811300 compté deux fois à l'import ; écart assumé de
  1 531,50 € (`ASSUMED_GAPS`) ; le payroll est exclu de `byCenter` mais doit
  figurer dans les exports ; scénarios appliqués aux lignes liées au CA ;
  conversion des devises dans la consolidation.

## Commandes

```bash
npm ci && npm test                     # serveur : dépendances et tests LDAP
npm start                              # http://127.0.0.1:3000 (server.mjs)
npm --prefix excel-grid install        # une fois (node_modules absent par défaut)
npm run verify                         # check + test + check:app + check:markup + typecheck
npm --prefix excel-grid run check:app  # contrôles de budget-app.html seuls
npm --prefix excel-grid run import:pcg # régénère PCG-DATA, pcg.json, pcg.generated.ts
node scripts-doc/rebuild-doc.mjs       # réécrit la section 7 de REPRISE-PROJET.md
```

`npm run verify` doit passer avant toute livraison. Chaque correctif ajoute un
contrôle dans `check-budget-app.mjs` qui échoue si on retire la correction.
Les scripts Node qui chargent l'application doivent finir par `process.exit`
(le minuteur de verrouillage garde le processus vivant) ; Node n'a pas
`indexedDB`, les tests passent par le repli.

## Documentation à tenir à jour

À chaque changement de `budget-app.html` : nouvelle entrée datée `###` **en
tête** du journal de la section 2.1 de `REPRISE-PROJET.md` (ce qui a changé,
pourquoi, contrôles ajoutés), puis `node scripts-doc/rebuild-doc.mjs` si des
fichiers de `excel-grid/` ont bougé. Les sections 1 à 6 s'éditent à la main.

## Livraison et production

- Mettre en production = fusionner une PR dans `main`. GitHub Actions publie
  `ghcr.io/infoaicinformatique/budgetpbdbcompta:latest`, Watchtower recrée le
  conteneur sur AIServer (192.168.100.236) en moins de 5 minutes. Pas de
  commit direct sur `main` ; ne fusionner qu'à la demande explicite.
- Architecture : box (80/443) → Nginx Proxy Manager (192.168.100.236:81, porte
  le certificat) → conteneur `budgetpbdbcompta` :3000, dans
  `/opt/docker/budgetpbdbcompta`, en lecture seule. Pas d'Access List NPM
  (l'auth est dans l'application).
- Authentification serveur (README, « Authentification LDAP ») : compte local
  `BASIC_AUTH_*` (secours) puis annuaire `LDAP_*`. Tout changement de
  `auth-ldap.mjs` passe par `npm test`. Piège : ldapts passe en TLS dès qu'il
  reçoit des `tlsOptions`, même sur `ldap://` — ne les donner qu'en `ldaps://`.
  Un nouveau fichier servi doit aussi être ajouté au `Dockerfile` et au
  `.dockerignore` (liste blanche).
- Le serveur n'est pas joignable en SSH depuis le poste de développement :
  les opérations serveur sont à faire faire par l'utilisateur (commandes du README).
- Vérifier la production : `curl https://budgetpbdbcompta.aic-informatique.net/healthz`
  → `ok` ; `/` → 401 sans identifiants, 200 avec. La page servie doit être
  identique à `main` aux fins de ligne près (copie Windows en CRLF via
  `core.autocrlf=true`, serveur en LF).
