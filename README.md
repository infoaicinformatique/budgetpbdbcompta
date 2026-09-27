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
          ──▶ conteneur Docker budgetpbdbcompta — <IP de l'hôte Docker>:3000
               · /opt/docker/budgetpbdbcompta, authentification Basic
```

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

Vérification :

```bash
sudo docker ps --filter name=budgetpbdbcompta   # (healthy) après ~20 s
curl -I http://127.0.0.1:3000                  # 401 : mot de passe demandé
hostname -I                                    # IP locale à indiquer dans NPM
```

L'image ne contient que `server.mjs` et `budget-app.html` ; le conteneur tourne
en lecture seule, sans privilèges, et redémarre avec la machine.
`HOST=0.0.0.0` est imposé par `docker-compose.yml`.

Pour que seul NPM puisse joindre le port 3000 (si ufw est actif) :

```bash
sudo ufw allow from 192.168.100.236 to any port 3000 proto tcp
```

## 2. Nginx Proxy Manager

Dans http://192.168.100.236:81 → **Hosts → Proxy Hosts → Add Proxy Host** :

| Onglet | Champ | Valeur |
| --- | --- | --- |
| Details | Domain Names | `budgetpbdbcompta.aic-informatique.net` |
| Details | Scheme | `http` |
| Details | Forward Hostname / IP | IP locale de l'hôte Docker (`hostname -I`) |
| Details | Forward Port | `3000` |
| Details | Block Common Exploits | ✔ |
| Details | Websockets Support | inutile |
| SSL | SSL Certificate | Request a new SSL Certificate |
| SSL | Force SSL · HTTP/2 Support · HSTS Enabled | ✔ |
| SSL | Email / I Agree | votre e-mail, accepter |

Si l'application tourne **sur la même machine que NPM**, indiquer
`192.168.100.236` et non `127.0.0.1` : dans le conteneur NPM, `127.0.0.1`
désigne le conteneur lui-même.

L'authentification est assurée par l'application (`BASIC_AUTH_*`) : ne pas
ajouter en plus une *Access List* NPM, sinon deux mots de passe sont demandés.

Vérification depuis l'extérieur :

```bash
curl -I https://budgetpbdbcompta.aic-informatique.net   # 401 attendu
```

## 3. Mise à jour

```bash
cd /opt/docker/budgetpbdbcompta && sudo git pull && sudo docker compose up -d --build
```

Rien à changer dans NPM.

## 4. Dépannage

| Symptôme | Vérification |
| --- | --- |
| NPM : « Internal Error » à la demande de certificat | ports 80 et 443 de la box redirigés vers 192.168.100.236 ; pas d'enregistrement DNS `AAAA` pour le domaine (`dig +short budgetpbdbcompta.aic-informatique.net AAAA` doit être vide) |
| 502 Bad Gateway | conteneur démarré (`sudo docker ps`) ; IP / port du Proxy Host ; depuis la machine NPM : `curl -I http://<IP hôte Docker>:3000` → 401 |
| Page d'un autre site | nom de domaine exact dans le Proxy Host |
| Mot de passe refusé | valeurs de `.env`, puis `sudo docker compose up -d` pour les recharger |

Journaux : `sudo docker logs budgetpbdbcompta --tail 50`, et dans NPM le
journal du Proxy Host.

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
