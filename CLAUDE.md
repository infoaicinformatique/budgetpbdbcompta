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
| `server.mjs` | Serveur Node ≥ 22 : sert seulement `/` (brotli/gzip), `/healthz`, auth Basic (compte local et/ou LDAP) ; tout le reste → 404. Dépose le cookie `bm-auth` (identité + config LDAP publique) lu par Paramètres › LDAP. `/api/droits` : droits par personne de l'annuaire |
| `rights.mjs` | Fichier des droits (`RIGHTS_FILE`, volume Docker `droits`), contrôle de forme, dernier administrateur protégé, `RIGHTS_ADMINS` |
| `data.mjs` | Données budgétaires tenues par le serveur (`DATA_FILE`, même volume, `historique/`) : périmètre par droits (`scopeOf`), lecture filtrée, fusion des seules sociétés déclarées modifiées, conflits par société (409). `/api/donnees` dans `server.mjs` |
| `auth-ldap.mjs`, `test/` | Vérification LDAP (seule dépendance : `ldapts`) et tests serveur (`npm test` : LDAP, droits, données) |
| `excel-grid/` | Prototype tableur React/Vite **et** outillage : moteur de référence `src/engine/chart.ts`, imports, validation |
| `scripts-doc/rebuild-doc.mjs` | Régénère la section 7 de `REPRISE-PROJET.md` |
| `scripts-fx/taux-du-jour.mjs` | Utilitaire manuel : taux BCE (Frankfurter) à recopier dans Sociétés > Taux de change |
| `pcg.json` | Plan comptable en JSON, généré par `import-pcg.mjs` |
| `Dockerfile`, `docker-compose.yml`, `deploy/`, `.github/workflows/` | Production |

Fichiers jetables suivis par git (ne pas s'en servir comme référence) :
`tmp-diag-v2.mjs`, `excel-grid/probe*.mjs`, `excel-grid/gen_test_xlsx*.mjs`,
`excel-grid/scripts/tmp-diag*.mjs`.
`build-recap.js` est cassé en l'état (CommonJS + `docx` absent).

Trois diagnostics morts ont été supprimés le 04/10/2026, tous cassés depuis
des retraits de fonctions antérieurs : `excel-grid/scripts/diag.mjs` (607
lignes recopiant le harnais, 27 symboles disparus) et `diag-bonus*.mjs` (qui
importaient `check-budget-app.mjs` — lequel exécute ses 526 contrôles puis
`process.exit`, donc ils n'avaient jamais rien pu afficher). Pour inspecter un
classeur produit ou une fonction de l'application, repartir de
`check-budget-app.mjs`, qui est tenu à jour.

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
  Seule exception : `serverRequest` (CSP `connect-src 'self'`), limité aux
  chemins `/api/droits` (droits) et `/api/donnees` (données de la personne).
- **Données tenues par le serveur** (depuis le 02/10/2026) : en mode serveur
  (`serverData` non nul), `boot()` lit `/api/donnees` et `persist()` y renvoie
  l'état (`persistToServer`) en déclarant les sociétés modifiées
  (`serverChangesBetween`) — **rien n'est écrit dans le navigateur**, ni
  sauvegarde automatique, ni code d'accès. Les clés `SERVER_PRIVATE_KEYS`
  (comptes locaux, journal de sécurité, choix d'affichage) ne partent jamais.
  Toute nouvelle donnée rattachée à une société doit être ajoutée à la fois à
  `COMPANY_KEYED_STATE`/`SERVER_COMPANY_ARRAYS` (application) et à
  `COMPANY_DICTS`/`COMPANY_ARRAYS` (data.mjs), sinon elle serait traitée comme
  un élément commun.
- **Droits tenus par le serveur** : page servie avec une identité (cookie
  `bm-auth`, voie ldap/local) → `serverSession` ; `currentUser()` rend un compte
  bâti sur la fiche du serveur (`serverUserFromRights`) et `usersOf()` la liste
  des personnes de l'annuaire. Autorisations est fermé, les droits se règlent
  dans Paramètres › Droits d'accès. Sans fiche : Paramètres seulement.
- Aucune librairie : lecture et écriture .xlsx faites main (ZIP stocké, CRC32).
- Hors mode serveur (fichier local, http simple) : stockage dans le navigateur,
  IndexedDB `budget-manager-db` (store `kv`, clé `budget-hemasphere-v2`) avec
  repli localStorage. En mode serveur : `/data/budget.json`. Toute évolution du
  format d'état exige une migration (elle s'applique aussi à l'état reçu du
  serveur, via `adoptState`).
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
- **Où tourne cette session ?** Vérifier avant de proposer des commandes à
  l'utilisateur : `hostname` (`AIServer` = le serveur de production lui-même,
  192.168.100.236) et `docker ps`. Sur AIServer, le dépôt de travail EST
  `/opt/docker/budgetpbdbcompta`, le conteneur de production tourne là, et les
  opérations serveur se font directement (constaté le 04/10/2026 ; la note
  précédente affirmait le contraire). Depuis un autre poste, le serveur n'est
  pas joignable en SSH : les opérations sont alors à faire faire par
  l'utilisateur (commandes du README).
- Fichiers de production **hors git**, à ne jamais committer : `.env` (mots de
  passe LDAP, voir `.gitignore`) et le volume `/data` (droits et budgets).
- Vérifier la production : `curl https://budgetpbdbcompta.aic-informatique.net/healthz`
  → `ok` ; `/` → 401 sans identifiants, 200 avec. La page servie doit être
  identique à `main` aux fins de ligne près (copie Windows en CRLF via
  `core.autocrlf=true`, serveur en LF).
