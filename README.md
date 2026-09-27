# Budget Manager — Palm Beach Cannes

Application de construction budgétaire (fichier unique `budget-app.html`,
sans dépendance). Historique et décisions : `REPRISE-PROJET.md`.
Prototype tableur React/Vite et scripts de contrôle : `excel-grid/`.

URL de production : **https://budgetpbdbcompta.aic-informatique.net**
(enregistrement DNS A → `77.159.204.155`).

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

## Déploiement Docker (recommandé)

```bash
sudo git clone https://github.com/infoaicinformatique/budgetpbdbcompta.git /opt/docker/budgetpbdbcompta
cd /opt/docker/budgetpbdbcompta
sudo cp .env.example .env            # renseigner BASIC_AUTH_USER / BASIC_AUTH_PASSWORD
sudo docker compose up -d --build
```

L'image ne contient que `server.mjs` et `budget-app.html`. Dans Nginx Proxy
Manager (http://192.168.100.236:81), créer un Proxy Host
`budgetpbdbcompta.aic-informatique.net` → `http://<IP de l'hôte Docker>:3000`
avec un certificat Let's Encrypt (Force SSL).

Mise à jour : `sudo git pull && sudo docker compose up -d --build`.

## Déploiement sans Docker sur 77.159.204.155

```bash
# 1. Code
sudo git clone https://github.com/infoaicinformatique/budgetpbdbcompta.git /opt/budgetpbdbcompta

# 2. Service Node (npm start au boot)
sudo cp /opt/budgetpbdbcompta/.env.example /etc/budgetpbdbcompta.env   # puis adapter
sudo cp /opt/budgetpbdbcompta/deploy/budgetpbdbcompta.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now budgetpbdbcompta

# 3. HTTPS — au choix :
#   Caddy (certificat Let's Encrypt automatique)
sudo cp /opt/budgetpbdbcompta/deploy/Caddyfile /etc/caddy/Caddyfile && sudo systemctl reload caddy
#   ou Apache déjà en place + certbot : voir deploy/apache.conf
#   ou nginx + certbot : voir deploy/nginx.conf
```

Ports 80 et 443 ouverts vers le serveur (80 sert à la validation Let's Encrypt).
Mise à jour : `cd /opt/budgetpbdbcompta && sudo git pull` — le serveur recharge
`budget-app.html` automatiquement dès que le fichier change.

## Développement du prototype `excel-grid`

```bash
npm --prefix excel-grid install
npm run dev               # Vite, accepte aussi l'hôte budgetpbdbcompta.aic-informatique.net
npm run verify            # contrôles et tests
```
