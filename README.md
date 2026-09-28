# Budget Manager — Palm Beach Cannes

Application de construction budgétaire (fichier unique `budget-app.html`,
sans dépendance). Historique et décisions : `REPRISE-PROJET.md`.
Prototype tableur React/Vite et scripts de contrôle : `excel-grid/`.

URL de production : **https://budgetpbdbcompta.aic-informatique.net**
(enregistrement DNS A → `77.159.204.155`, publié par Nginx Proxy Manager).

## Lancer en local

```bash
npm ci                    # une fois : ldapts, seule dépendance
npm start                 # http://127.0.0.1:3000
npm test                  # tests de l'authentification LDAP
```

`server.mjs` (Node ≥ 22) ne sert que l'application :
`/` renvoie `budget-app.html` compressé (brotli/gzip), `/healthz` répond `ok`,
tout le reste (document de reprise, Excel, scripts) renvoie 404.

Variables (voir `.env.example`) : `HOST`, `PORT`, `PUBLIC_HOST`,
`BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD` (compte local),
`LDAP_*` (annuaire, voir « Authentification LDAP »), `TRUST_PROXY`.
Une protection est recommandée : l'application embarque le plan comptable et
les budgets.

## Authentification LDAP

Le serveur peut vérifier les identifiants dans un annuaire (Active Directory,
OpenLDAP…) au lieu d'un mot de passe unique. La fenêtre de connexion reste
celle du navigateur ; l'identifiant et le mot de passe saisis sont vérifiés
par une connexion (« bind ») à l'annuaire au nom de l'utilisateur
(`auth-ldap.mjs`). Rien n'est stocké côté serveur.

Configuration dans `.env` (modèles commentés dans `.env.example`) :

| Cas | Variables |
| --- | --- |
| Active Directory, tous les comptes du domaine | `LDAP_URL=ldaps://dc1.exemple.local:636` et `LDAP_USER_DN={username}@exemple.local` |
| OpenLDAP, DN prévisible | `LDAP_USER_DN=uid={username},ou=people,dc=exemple,dc=fr` |
| Réservé à un groupe | `LDAP_SEARCH_BASE`, `LDAP_SEARCH_FILTER`, `LDAP_BIND_DN` / `LDAP_BIND_PASSWORD` (compte de service en lecture) et `LDAP_GROUP_DN` |

Comportement :

- le compte local `BASIC_AUTH_*`, s'il est renseigné, reste accepté : c'est
  l'accès de secours quand l'annuaire est en panne (le garder long et secret) ;
- une connexion réussie est mémorisée `LDAP_CACHE_SECONDS` (300 s par défaut) :
  un compte désactivé dans l'annuaire perd l'accès au plus tard après ce délai ;
- 5 échecs en 15 minutes depuis une même adresse → 429 pendant le reste de la
  fenêtre (protège aussi les comptes AD du verrouillage). Derrière NPM,
  `TRUST_PROXY=true` (imposé par `docker-compose.yml`) lit l'adresse dans
  `X-Real-IP` : le port 3000 ne doit être joignable que par NPM (voir ufw) ;
- annuaire injoignable → 503 ; configuration LDAP incomplète → le conteneur
  refuse de démarrer (`sudo docker logs budgetpbdbcompta`) ;
- mot de passe vide et identifiants hors `[A-Za-z0-9._@-]` refusés sans
  interroger l'annuaire.
- l'état de la connexion s'affiche dans l'application, **Paramètres › LDAP**
  (lecture seule) : voie de connexion (annuaire ou compte local), identifiant,
  entrée de l'annuaire, serveurs, chiffrement, OU de recherche, groupe. Le
  serveur le dépose dans le cookie `bm-auth` en servant la page (l'application
  n'a pas le droit d'appeler le réseau) ; jamais le compte de service ni un
  mot de passe.

Préférer `ldaps://` ou `LDAP_STARTTLS=true` : en `ldap://` simple, les mots de
passe traversent le réseau en clair. Pour une autorité de certification
interne, voir le bloc `volumes` commenté de `docker-compose.yml` et
`LDAP_CA_FILE`.

Vérification sur le serveur après `sudo docker compose up -d` :

```bash
sudo docker logs budgetpbdbcompta 2>&1 | grep -A2 Authentification   # « annuaire LDAP : ldaps://… »
curl -I -u 'prenom.nom' http://127.0.0.1:3000                         # 200 avec un compte de l'annuaire
sudo docker logs budgetpbdbcompta 2>&1 | grep 'Connexion LDAP'        # connexions acceptées / refusées
```

## Droits d'accès (Paramètres › Droits d'accès)

Avec LDAP, l'application ne se sert plus de ses comptes locaux (onglet
Autorisations, propres à chaque navigateur) : la personne est celle que
l'annuaire a reconnue, et ses droits — rôle, onglets, rubriques, sociétés,
centres de coûts — sont tenus par le serveur, les mêmes sur tous les postes.

- **Qui entre** : les membres (directs) du groupe `LDAP_GROUP_DN`, par
  exemple `CN=budgetpbdbcompta,OU=…,DC=pbcannes,DC=org`. Les autres sont
  refusés à la connexion (401).
- **Ce que chacun voit** : réglé par un administrateur dans **Paramètres ›
  Droits d'accès**, qui liste les membres du groupe. Un membre sans droits
  n'a accès qu'à Paramètres (fermé par défaut, y compris si le serveur ne
  répond pas).
- **Administrateurs** : ceux que l'écran désigne (case « Administrateur »),
  plus ceux de `RIGHTS_ADMINS` dans `.env`, toujours administrateurs — il en
  faut au moins un pour le premier réglage. Le compte local de secours
  (`BASIC_AUTH_*`) est lui aussi administrateur.
- **Stockage** : `RIGHTS_FILE` (Docker : `/data/droits.json`, volume nommé
  `droits`, conservé quand le conteneur est recréé). Chaque changement y est
  journalisé (qui, quand, pour qui) et dans `docker logs`.
- La page appelle le serveur pour ces droits, et pour eux seulement : la
  politique de sécurité passe à `connect-src 'self'`, et l'application
  refuse tout autre chemin que `/api/droits` (voir `serverRequest`).

Mise en place (une fois, `docker-compose.yml` ayant changé) :

```bash
cd /opt/docker/budgetpbdbcompta && sudo git pull
sudo nano .env        # LDAP_GROUP_DN=CN=budgetpbdbcompta,…  et  RIGHTS_ADMINS=prenom.nom
sudo docker compose up -d
sudo docker logs budgetpbdbcompta 2>&1 | grep -E 'groupe|Droits'   # groupe et administrateurs pris en compte
```

DN du groupe, sur un contrôleur de domaine (PowerShell) :
`Get-ADGroup budgetpbdbcompta | Select-Object DistinguishedName`.

Sauvegarde : `sudo docker exec budgetpbdbcompta cat /data/droits.json > droits-$(date +%F).json`.

**Déconnexion** : menu du compte › « Déconnexion ». L'authentification Basic
n'en a pas : le bouton mène à `/deconnexion`, qui répond 401 une fois — le
navigateur oublie alors ses identifiants — puis accepte ceux saisis dans la
fenêtre qui suit (cookie `bm-deco`, deux minutes).

## Architecture de production

```
Internet ──▶ 77.159.204.155 (ports 80 / 443)
          ──▶ Nginx Proxy Manager — 192.168.100.236 (admin : http://192.168.100.236:81)
               · certificat Let's Encrypt, HTTPS forcé
          ──▶ conteneur Docker budgetpbdbcompta — 192.168.100.236:3000
               · /opt/docker/budgetpbdbcompta, authentification Basic
```

NPM (conteneur `npm`, compose dans `/opt/docker/npm`) et l'application tournent
sur la même machine, AIServer (192.168.100.236). La box redirige les ports 80
et 443 vers cette machine.

Nginx Proxy Manager (NPM) est le seul point d'entrée public : il porte le
certificat HTTPS et transmet les requêtes à l'application en HTTP sur le réseau
local. Apache, Caddy et certbot ne sont pas utilisés.

## 1. Déploiement Docker

Sur le serveur Docker :

```bash
sudo git clone https://github.com/infoaicinformatique/budgetpbdbcompta.git /opt/docker/budgetpbdbcompta
cd /opt/docker/budgetpbdbcompta
sudo cp .env.example .env
sudo nano .env                       # décommenter et renseigner BASIC_AUTH_USER / BASIC_AUTH_PASSWORD
sudo chmod 600 .env
sudo docker login ghcr.io -u <utilisateur-github>   # une fois, jeton read:packages (voir 3.)
sudo docker compose pull && sudo docker compose up -d
```

(`sudo docker compose up -d --build` construit l'image sur place, sans passer
par GHCR.)

Les lignes `BASIC_AUTH_USER` et `BASIC_AUTH_PASSWORD` de `.env` ne doivent pas
commencer par `#` : sinon l'application est publique, sans mot de passe.

Vérification — **attendre quelques secondes** après le démarrage : le serveur
compresse `budget-app.html` avant d'accepter les connexions (un `curl` lancé
immédiatement répond « Could not connect », ce n'est pas une panne).

```bash
sudo docker ps --filter name=budgetpbdbcompta                   # (healthy) après ~20 s
sudo docker logs budgetpbdbcompta 2>&1 | grep Authentification  # « activée »
curl -I http://127.0.0.1:3000                                  # 401 : mot de passe demandé
```

L'image ne contient que `server.mjs` et `budget-app.html` ; le conteneur tourne
en lecture seule, sans privilèges, et redémarre avec la machine.
`HOST=0.0.0.0` est imposé par `docker-compose.yml`.

Pour que seul NPM puisse joindre le port 3000 (si ufw est actif) :

```bash
sudo ufw allow from 192.168.100.236 to any port 3000 proto tcp
```

## 2. Nginx Proxy Manager

### Prérequis : NPM doit pouvoir résoudre les noms de domaine

Le conteneur NPM doit joindre `acme-v02.api.letsencrypt.org` pour obtenir et
renouveler les certificats. Son compose (`/opt/docker/npm/docker-compose.yml`)
fixe donc ses serveurs DNS :

```yaml
    volumes:
      - ./data:/data
      - ./letsencrypt:/etc/letsencrypt
    dns:
      - 192.168.100.226
      - 1.1.1.1
```

Sans ce bloc, Docker fige les DNS de la machine **au moment de la création** du
conteneur : si le réseau n'était pas prêt (démarrage de la machine), le
conteneur garde `NO EXTERNAL NAMESERVERS DEFINED` et certbot échoue avec
`Temporary failure in name resolution`. Contrôle :

```bash
sudo docker exec npm getent hosts acme-v02.api.letsencrypt.org   # doit afficher une IP
```

Après modification : `cd /opt/docker/npm && sudo docker compose up -d --force-recreate`
(les hôtes et certificats sont conservés dans `./data` et `./letsencrypt`).

### Proxy Host

Dans http://192.168.100.236:81 → **Hosts → Proxy Hosts → Add Proxy Host** :

| Onglet | Champ | Valeur |
| --- | --- | --- |
| Details | Domain Names | `budgetpbdbcompta.aic-informatique.net` |
| Details | Scheme | `http` |
| Details | Forward Hostname / IP | `192.168.100.236` |
| Details | Forward Port | `3000` |
| Details | Block Common Exploits | ✔ |
| Details | Websockets Support | inutile |
| SSL | SSL Certificate | Request a new SSL Certificate |
| SSL | Force SSL · HTTP/2 Support · HSTS Enabled | ✔ |
| SSL | Email / I Agree | votre e-mail, accepter |

Ne pas indiquer `127.0.0.1` : dans le conteneur NPM, `127.0.0.1` désigne le
conteneur NPM lui-même, pas la machine.

Laisser l'onglet **Advanced** vide. Si la validation Let's Encrypt échoue
parce que `/.well-known/acme-challenge/` arrive jusqu'à l'application (réponse
« Introuvable »), on peut y ajouter **temporairement**
`include conf.d/include/letsencrypt-acme-challenge.conf;` pour obtenir le
certificat, puis **la retirer aussitôt** : une fois le certificat en place, NPM
ajoute lui-même cette ligne ; en double, nginx refuse la configuration, NPM
retire l'hôte (`4.conf` disparaît de `/data/nginx/proxy_host/`) et le domaine
affiche la page « Default Site » de NPM.

L'authentification est assurée par l'application (`BASIC_AUTH_*`) : ne pas
ajouter en plus une *Access List* NPM, sinon deux mots de passe sont demandés.

Vérification depuis l'extérieur :

```bash
curl -I http://budgetpbdbcompta.aic-informatique.net    # 301 vers https://
curl -I https://budgetpbdbcompta.aic-informatique.net   # 401 attendu
```

## 3. Mise à jour

Automatique avec Watchtower (ci-dessous). À la main :

```bash
cd /opt/docker/budgetpbdbcompta && sudo git pull && sudo docker compose pull && sudo docker compose up -d
```

La copie du serveur doit suivre la branche `main` (`sudo git checkout main`).
Rien à changer dans NPM.

### Mise à jour automatique (Watchtower)

1. À chaque changement de `main`, GitHub Actions (`.github/workflows/docker-image.yml`)
   construit l'image et la publie sur `ghcr.io/infoaicinformatique/budgetpbdbcompta:latest`.
2. Sur le serveur, **Watchtower** vérifie ce registre toutes les 5 minutes ; si
   l'image a changé, il la télécharge et recrée le conteneur `budgetpbdbcompta`
   avec les mêmes réglages (`.env`, port, réseau).

Mettre à jour la production = fusionner une pull request dans `main`.

Watchtower ne touche qu'aux conteneurs portant le label
`com.centurylinklabs.watchtower.enable=true` (déclaré dans `docker-compose.yml`) :
NPM, anemo, etc. ne sont pas mis à jour tant qu'on ne leur ajoute pas ce label.

**Installation (une fois).** Le dépôt étant privé, l'image l'est aussi : le
serveur doit s'identifier sur GHCR avec un jeton GitHub *classic* limité au
droit `read:packages` (GitHub → Settings → Developer settings → Personal access
tokens → Tokens (classic)).

```bash
# 1. Identification GHCR (crée /root/.docker/config.json, lu par Watchtower)
sudo docker login ghcr.io -u <utilisateur-github>        # mot de passe = le jeton

# 2. Application : passer sur l'image publiée
cd /opt/docker/budgetpbdbcompta && sudo git checkout main && sudo git pull
sudo docker compose pull && sudo docker compose up -d

# 3. Watchtower
sudo mkdir -p /opt/docker/watchtower
sudo cp deploy/watchtower/docker-compose.yml /opt/docker/watchtower/
cd /opt/docker/watchtower && sudo docker compose up -d
sudo docker logs watchtower --tail 20
```

Suivi : `sudo docker logs -f watchtower`. Construction de l'image : onglet
**Actions** du dépôt GitHub. Suspendre : `sudo docker stop watchtower`.

Le `docker-compose.yml` et le `.env` du serveur ne sont **pas** mis à jour par
Watchtower (il ne remplace que l'image) : après un changement de
`docker-compose.yml`, faire `sudo git pull && sudo docker compose up -d`.

## 4. Dépannage

| Symptôme | Vérification |
| --- | --- |
| NPM : « Internal Error » à la demande de certificat | cause exacte : `sudo docker logs npm --tail 60 2>&1 \| grep -iA3 -E "error\|certbot"` |
| certbot : `Temporary failure in name resolution` | DNS du conteneur NPM : voir « Prérequis » ci-dessus (`dns:` puis `--force-recreate`) |
| certbot : `Timeout during connect` / `Connection refused` | ports 80 et 443 de la box redirigés vers 192.168.100.236 ; pas d'enregistrement DNS `AAAA` pour le domaine |
| `/.well-known/acme-challenge/…` répond « Introuvable » | la validation arrive à l'application : ligne `include` temporaire dans Advanced (voir ci-dessus) |
| Page « Default Site / Congratulations » de NPM | l'hôte est hors ligne : vider l'onglet Advanced, vérifier le certificat dans l'onglet SSL, Save (ou ⋮ → Enable) ; `sudo docker exec npm ls /data/nginx/proxy_host/` doit lister `4.conf` |
| HTTPS : `unrecognized name` | aucun certificat pour ce domaine dans NPM |
| `docker compose build` : `open Dockerfile` ou `"/server.mjs": not found` | copie incomplète : recloner le dépôt et recopier `.env` |
| `docker compose pull` / Watchtower : `unauthorized` ou `denied` | `sudo docker login ghcr.io` avec un jeton `read:packages` valide ; puis `sudo docker restart watchtower` |
| Watchtower ne met rien à jour | l'action GitHub a-t-elle réussi (onglet Actions) ? le conteneur porte-t-il le label ? `sudo docker logs watchtower` |
| Application ouverte sans mot de passe (200 au lieu de 401) | `grep '^BASIC_AUTH_' .env` doit afficher 2 lignes, puis `sudo docker compose up -d --force-recreate` |
| 502 Bad Gateway | conteneur démarré (`sudo docker ps`) ; IP / port du Proxy Host ; depuis la machine NPM : `curl -I http://<IP hôte Docker>:3000` → 401 |
| Page d'un autre site | nom de domaine exact dans le Proxy Host |
| Mot de passe refusé | valeurs de `.env`, puis `sudo docker compose up -d` pour les recharger |
| LDAP : 503 « Annuaire indisponible » | `sudo docker logs budgetpbdbcompta` : `ECONNREFUSED`/`ETIMEDOUT` → réseau ou port ; `certificate` → `LDAP_CA_FILE` ; « compte de service LDAP refusé » → `LDAP_BIND_DN` / `LDAP_BIND_PASSWORD` |
| LDAP : identifiants corrects mais refusés | journal « Connexion LDAP refusée » : vérifier `LDAP_USER_DN` / `LDAP_SEARCH_FILTER`, puis l'appartenance à `LDAP_GROUP_DN` (membre direct, pas via un sous-groupe) |
| LDAP : 429 « Trop d'essais » | 5 échecs en 15 min depuis la même adresse ; attendre, ou `sudo docker restart budgetpbdbcompta` |
| Droits : « Droits illisibles » ou 500 sur `/api/droits` | `sudo docker logs budgetpbdbcompta` : `EACCES` → volume `droits` absent (`docker compose up -d` après `git pull`) ; « Fichier des droits illisible » → JSON abîmé, restaurer une sauvegarde |
| Droits : un membre du groupe n'apparaît pas | membre direct du groupe (pas via un sous-groupe) ; « Membres du groupe illisibles » → compte de service (`LDAP_BIND_DN`) sans droit de lecture sur le groupe |
| Droits : plus aucun administrateur | ajouter `RIGHTS_ADMINS=prenom.nom` dans `.env`, puis `sudo docker compose up -d` |
| Le conteneur redémarre en boucle après l'ajout de LDAP | « Démarrage refusé » dans `sudo docker logs budgetpbdbcompta` : variable LDAP manquante ou contradictoire |

Journaux : `sudo docker logs budgetpbdbcompta --tail 50`, `sudo docker logs npm`,
et le journal certbot de NPM dans `/opt/docker/npm/data/logs/letsencrypt.log`.

## Annexe — sans Docker

Service systemd (`deploy/budgetpbdbcompta.service`, variables dans
`/etc/budgetpbdbcompta.env`) :

```bash
sudo git clone https://github.com/infoaicinformatique/budgetpbdbcompta.git /opt/budgetpbdbcompta
cd /opt/budgetpbdbcompta && sudo npm ci --omit=dev                      # ldapts ; à refaire après un git pull qui change package-lock.json
sudo cp /opt/budgetpbdbcompta/.env.example /etc/budgetpbdbcompta.env   # HOST=0.0.0.0 si NPM est sur une autre machine
sudo cp /opt/budgetpbdbcompta/deploy/budgetpbdbcompta.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now budgetpbdbcompta
```

Le Proxy Host NPM est identique (port 3000). Le serveur recharge
`budget-app.html` dès que le fichier change après un `git pull`.
`deploy/Caddyfile`, `deploy/apache.conf` et `deploy/nginx.conf` restent
disponibles pour un hébergement sans NPM.

## Développement du prototype `excel-grid`

```bash
npm --prefix excel-grid install
npm run dev               # Vite, accepte aussi l'hôte budgetpbdbcompta.aic-informatique.net
npm run verify            # contrôles et tests
```
