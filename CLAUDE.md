# CLAUDE.md — Budget Manager (Palm Beach Cannes)

Application de construction budgétaire pour Alexis (contrôleur de gestion),
échéance 1/1/2027. Tout est en français : interface, commentaires, commits,
documentation. Les identifiants JS restent en anglais, en camelCase.

- Production : https://budgetpbdbcompta.aic-informatique.net — accès par
  l'**annuaire LDAP uniquement** depuis le 04/10/2026 : le compte local de
  secours (`BASIC_AUTH_*`) a été retiré à la demande d'Alexis, il n'existe
  donc **aucun identifiant de test** et aucun passe-partout (README, « Désigner
  les administrateurs »). Une session n'a pas de quoi ouvrir la page : les
  vérifications se font sur `/healthz` et sur le code 401.
- Administrateurs **désignés** (`RIGHTS_ADMINS`, toujours la main même sans
  fiche) : `a.porrati` (Alexis Porrati), `n.hovnanian` (Nicolas Hovnanian) et,
  depuis le 18/10/2026, `m.borel` (Mateo Borel). D'autres fiches portent la
  case « Administrateur » sans être désignées (`m.borel`, `f.leguillanton`,
  `a.vogelweid`, `t.righetti` au 18/10/2026) : la liste vivante est dans
  `/data/droits.json`, pas ici. Il n'existe pas de statut intermédiaire
  (« administrateur délégué ») : administrateur ou non.
- Historique, décisions, règles métier : `REPRISE-PROJET.md` (1,9 Mo — ne pas
  le lire en entier, chercher par `grep -n '^##'` ou par date `### `).
- Déploiement et dépannage : `README.md`.

## Carte du dépôt

| Chemin | Rôle |
| --- | --- |
| `budget-app.html` | **L'application entière** (~31 000 lignes, 1,7 Mo), zéro dépendance, zéro réseau |
| `server.mjs` | Serveur Node ≥ 22 : sert seulement `/` (brotli/gzip), `/healthz`, auth Basic (compte local et/ou LDAP) ; tout le reste → 404. Dépose le cookie `bm-auth` (identité + config LDAP publique) lu par Paramètres › LDAP. `/api/droits` : droits par personne de l'annuaire |
| `rights.mjs` | Fichier des droits (`RIGHTS_FILE`, volume Docker `droits`), contrôle de forme, dernier administrateur protégé, `RIGHTS_ADMINS`, rôles personnalisés (`roles`, Paramètres › Rôles : nom, vue de base, droits par défaut ; la fiche garde `role` = vue de base + `roleId`) |
| `data.mjs` | Données budgétaires tenues par le serveur (`DATA_FILE`, même volume, `historique/`) : périmètre par droits (`scopeOf` : environnements ∪ groupes de sociétés, puis sélection de sociétés), lecture filtrée, fusion des seules sociétés déclarées modifiées, conflits par société (409). Soumission du budget (`budgetSubmissions`, `SERVER_OWNED_DICTS` : jamais repris d'un envoi ; `setSubmission`, écriture refusée en 409 sur un budget soumis). `/api/donnees` et `POST /api/donnees/soumission` dans `server.mjs` |
| `presence.mjs` | Qui a la main sur une société (saisies simultanées) : en mémoire, pris par battement de cœur, rendu après 70 s sans nouvelle. `POST /api/donnees/main` dans `server.mjs`, qui refuse aussi (409) l'écriture d'une société tenue par quelqu'un d'autre |
| `preferences.mjs` | Préférences de chaque personne (`PREFERENCES_FILE`, même volume) : ordre des sociétés de l'accueil et réglages visuels (taille du texte, densité, animations, palette — `DISPLAY_OPTIONS`, identique dans l'application). `GET`/`PUT /api/preferences` dans `server.mjs`, chacun ne lit et n'écrit que les siennes, un `PUT` partiel ne touche qu'à ce qu'il envoie |
| `auth-ldap.mjs`, `test/` | Vérification LDAP (seule dépendance : `ldapts`) et tests serveur (`npm test` : LDAP, droits, données, main, préférences, et `server.test.mjs` qui lance le serveur pour de vrai) |
| `excel-grid/` | Prototype tableur React/Vite **et** outillage : moteur de référence `src/engine/chart.ts`, imports, validation |
| `scripts-doc/rebuild-doc.mjs` | Régénère la section 7 de `REPRISE-PROJET.md` |
| `scripts-fx/taux-du-jour.mjs` | Utilitaire manuel : taux BCE (Frankfurter) à recopier dans Sociétés > Taux de change |
| `pcg.json` | Plan comptable en JSON, généré par `import-pcg.mjs` |
| `Dockerfile`, `docker-compose.yml`, `deploy/`, `.github/workflows/` | Production |

**Plus aucun fichier jetable dans le dépôt** : les treize diagnostics et
sondes qui y traînaient (`diag.mjs`, `diag-bonus*.mjs`, `tmp-diag*.mjs`,
`probe*.mjs`, `gen_test_xlsx*.mjs`) et `build-recap.js`, cassé depuis
toujours, ont été supprimés le 04/10/2026. Trois ne se chargeaient même plus :
ces scripts recopient des listes d'exports du harnais, qui changent sans eux.

Ne pas en recréer dans le dépôt. Un diagnostic ponctuel se garde hors de git
(`/tmp`), et pour inspecter un classeur produit ou une fonction de
l'application il faut repartir de `check-budget-app.mjs`, qui est tenu à jour
et sait charger l'application dans un faux DOM. Ce qui mérite de rester
devient un contrôle dans `check-budget-app.mjs`, pas un script de plus.

## Structure de `budget-app.html`

Le fichier est trop gros pour être lu d'un bloc : repérer les zones par grep.

- `<head>` avec CSP stricte (`default-src 'none'`, `connect-src 'self'` pour
  les deux adresses d'API), puis un seul `<style>`,
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
- Onglets déclarés dans `TAB_GROUPS`. L'onglet `saisie` s'affiche
  « Charges » (14/10/2026) : son identifiant ne change pas.

Invariants techniques :
- **SAS réseau** : `fetch`, XHR, WebSocket… sont neutralisés au démarrage.
  Aucune fonctionnalité ne doit appeler le réseau ni charger de ressource externe.
  Seule exception : `serverRequest` (CSP `connect-src 'self'`), limité aux
  chemins `/api/droits` (droits, et `/api/droits/roles/<id>` pour les rôles
  personnalisés), `/api/donnees` (données de la personne),
  `/api/donnees/main` (qui a la main sur la société ouverte),
  `/api/donnees/soumission` (soumettre / rouvrir le budget de la société) et
  `/api/preferences` (ordre des sociétés de l'accueil et préférences
  d'affichage, propres à chacun).
- **Données tenues par le serveur** (depuis le 02/10/2026) : en mode serveur
  (`serverData` non nul), `boot()` lit `/api/donnees` et `persist()` y renvoie
  l'état (`persistToServer`) en déclarant les sociétés modifiées
  (`serverChangesBetween`) — **rien n'est écrit dans le navigateur**, ni
  sauvegarde automatique, ni code d'accès. Les clés `SERVER_PRIVATE_KEYS`
  (comptes locaux, journal de sécurité, choix d'affichage) ne partent jamais.
  Toute nouvelle donnée rattachée à une société doit être ajoutée à la fois à
  `COMPANY_KEYED_STATE`/`SERVER_COMPANY_ARRAYS` (application) et à
  `COMPANY_DICTS`/`COMPANY_ARRAYS` (data.mjs), sinon elle serait traitée comme
  un élément commun. `budgetSubmissions` (soumission du budget) est dans
  `COMPANY_KEYED_STATE` côté application mais tenu par le serveur seul
  (`SERVER_OWNED_DICTS`) : il ne s'écrit que par `/api/donnees/soumission`.
- **Budget soumis** (14/10/2026) : `budgetFrozen()` est le seul point de
  décision à l'écran ; tout nouveau geste de modification d'un onglet de
  saisie doit être ajouté à `BUDGET_FROZEN_HIDDEN` (ou refusé à la source).
- **CA ventilé** (18/10/2026) : les comptes suivis Food / Beverage / Event
  ne sont que la ventilation (`syncCaVentilation`, à chaque rendu) ; ne pas
  leur rouvrir de saisie à la main, elle serait écrasée.
- **Multiplicateur** : `rateLink.rate` = nombre (ancien format, fixe en
  coefficient) ou `{ mode, unit, values[12], periods }` ; toujours lire par
  `rateSpecOf` / `rateMonthValues`, jamais `rate` directement.
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

## Mode ExApp Nextcloud (`nextcloud-exapp.mjs`, dossier `nextcloud/`)

Depuis le 07/11/2026, la même base de code peut aussi être servie par Nextcloud
AIO (ExApp AppAPI + HaRP, `https://nc.pbcannes.org/exapps/budgetpbdbcompta/`).
Ce mode ne s'active que si AppAPI injecte `APP_ID` et `APP_SECRET` : la
production autonome sur AIServer est inchangée.

- `nextcloud-exapp.mjs` : cycle de vie AppAPI, secret vérifié sur chaque
  requête, identité et groupes lus auprès de Nextcloud, porte
  `NC_ALLOWED_GROUPS` (groupe `budgetpbdbcompta`). `server.mjs` appelle
  `nextcloud.intercept()` en tête de `handle()`, et `authenticate` rend alors
  l'identité Nextcloud par la voie `ldap` (pas de compte local, pas de mot de
  passe). Clé des droits : identifiant d'annuaire retrouvé par `ldapFindEntry`
  (identifiant puis courrier ; Nextcloud peut identifier un utilisateur LDAP
  par un UUID).
- `budget-app.html` : `NEXTCLOUD_BASE` (préfixe `/exapps/<id>`, vide en accès
  direct) est ajouté devant chaque chemin de `serverRequest`. **Toute nouvelle
  sortie réseau doit passer par `serverRequest`**, sinon elle partirait vers
  la racine de Nextcloud. Contrôle « ExApp Nextcloud » dans `check-budget-app.mjs`.
- Image `Dockerfile.exapp` (fichiers servis à ajouter aussi à sa liste et au
  `.dockerignore`), données et `.env` de production dans le volume de l'ExApp
  (`/data`). Installation, reprise des données, sauvegarde : `nextcloud/README.md`.
- Tests : `test/nextcloud-exapp.test.mjs` (dans `npm test`).
- Mise à jour : `nextcloud/auto-update.sh` (cron toutes les 5 min sur l'hôte AIO) reconstruit et
  réenregistre l'ExApp après chaque fusion dans `main`, comme Watchtower pour AIServer : une fusion met
  donc à jour **les deux versions**.

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
npm ci && npm test                     # serveur : LDAP, droits, données, main, soumission, préférences, serveur HTTP (64 tests)
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
- Authentification serveur (README, « Authentification LDAP ») : le code
  accepte un compte local `BASIC_AUTH_*` puis l'annuaire `LDAP_*`, mais **en
  production le compte local est retiré** (04/10/2026) : l'annuaire est la
  seule porte, et la rétablir demande de renseigner les deux clés dans `.env`
  puis `docker compose up -d` (README, « Désigner les administrateurs »). Tout
  changement de `auth-ldap.mjs` passe par `npm test`. Piège : ldapts passe en
  TLS dès qu'il reçoit des `tlsOptions`, même sur `ldap://` — ne les donner
  qu'en `ldaps://`. **Depuis le 13/10/2026 la liaison est chiffrée** :
  `ldaps://SRV-DC-01.pbcannes.org:636` + `LDAP_CA_FILE=/certs/ldap-ca.pem`
  (autorité interne, fichier `ldap-ca.pem` hors git monté par le compose).
  Par nom d'hôte obligatoirement : le certificat ne porte pas l'adresse IP.
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
  → `ok` ; `/` → **401** sans identifiants (c'est tout ce qu'une session peut
  constater, faute de compte local). Sur AIServer, le reste se lit dans le
  conteneur : `docker logs --tail 20 budgetpbdbcompta` (version, annuaire,
  administrateurs désignés) et `docker exec budgetpbdbcompta cat /data/droits.json`.
  La page servie doit être identique à `main` aux fins de ligne près (copie
  Windows en CRLF via `core.autocrlf=true`, serveur en LF).
- **Données de production** : droits et budgets vivent dans le volume `droits`
  (`/data/droits.json`, `/data/budget.json`, `/data/historique/`). Toute
  opération dessus commence par une sauvegarde **hors du dépôt**
  (`/root/sauvegardes-budgetpbdbcompta/`) : elles sont irréversibles et le
  dépôt n'en garde aucune trace. `/data/preferences.json` (ordre des
  sociétés de l'accueil et préférences d'affichage, par personne) vit dans
  le même volume. L'API `/api/donnees` et `/api/droits` exige une
  identité LDAP, donc une session ne peut pas écrire par là : passer par
  `docker exec` sur le fichier, en écriture atomique (fichier voisin puis
  `mv`), et vérifier en relisant.
