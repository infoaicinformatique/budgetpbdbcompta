# Image de production de Budget Manager : seul le serveur et l'application
# y sont copiés (pas le document de reprise, ni le plan comptable Excel).
FROM node:22-alpine

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

WORKDIR /app
# Dépendances de production seulement (ldapts, pour l'authentification LDAP).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.mjs auth-ldap.mjs rights.mjs etat.mjs budget-app.html ./

# Droits d'accès et budget partagé : /data est le seul dossier inscriptible
# d'un conteneur en lecture seule, monté en volume par docker-compose.yml.
# `etat.json` contient les budgets de tout le groupe — c'est LE fichier à
# sauvegarder (voir README, « Sauvegarde »).
ENV RIGHTS_FILE=/data/droits.json \
    ETAT_FILE=/data/etat.json
RUN mkdir -p /data && chown node:node /data

USER node
EXPOSE 3000

# La compression de budget-app.html au démarrage prend quelques secondes.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

CMD ["node", "server.mjs"]
