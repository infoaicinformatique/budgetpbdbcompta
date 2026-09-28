# Budget Manager — Palm Beach Cannes

Application de construction budgétaire (fichier unique `budget-app.html`,
sans dépendance). Historique et décisions : `REPRISE-PROJET.md`.
Prototype tableur React/Vite et scripts de contrôle : `excel-grid/`.

URL de production : **https://budgetpbdbcompta.aic-informatique.net**
(enregistrement DNS A → `77.159.204.155`, publié par Nginx Proxy Manager).

## Lancer en local

```bash
npm start                 # http://127.0.0.1:3000
```

`server.mjs` (Node ≥ 22, aucune dépendance) ne sert que l'application :
`/` renvoie `budget-app.html` compressé (brotli/gzip), `/healthz` répond `ok`,
tout le reste (document de reprise, Excel, scripts) renvoie 404.

Variables (voir `.env.example`) : `HOST`, `PORT`, `PUBLIC_HOST`,
`BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD` (protection par mot de passe,
recommandée : l'application embarque le plan comptable et les budgets).

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
sudo docker compose up -d --build
```

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

```bash
cd /opt/docker/budgetpbdbcompta && sudo git pull && sudo docker compose up -d --build
```

La copie du serveur doit suivre la branche `main` (`sudo git checkout main`).
Rien à changer dans NPM.

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
| Application ouverte sans mot de passe (200 au lieu de 401) | `grep '^BASIC_AUTH_' .env` doit afficher 2 lignes, puis `sudo docker compose up -d --force-recreate` |
| 502 Bad Gateway | conteneur démarré (`sudo docker ps`) ; IP / port du Proxy Host ; depuis la machine NPM : `curl -I http://<IP hôte Docker>:3000` → 401 |
| Page d'un autre site | nom de domaine exact dans le Proxy Host |
| Mot de passe refusé | valeurs de `.env`, puis `sudo docker compose up -d` pour les recharger |

Journaux : `sudo docker logs budgetpbdbcompta --tail 50`, `sudo docker logs npm`,
et le journal certbot de NPM dans `/opt/docker/npm/data/logs/letsencrypt.log`.

## Annexe — sans Docker

Service systemd (`deploy/budgetpbdbcompta.service`, variables dans
`/etc/budgetpbdbcompta.env`) :

```bash
sudo git clone https://github.com/infoaicinformatique/budgetpbdbcompta.git /opt/budgetpbdbcompta
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
