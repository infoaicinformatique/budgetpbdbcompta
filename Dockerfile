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
COPY server.mjs auth-ldap.mjs budget-app.html ./

USER node
EXPOSE 3000

# La compression de budget-app.html au démarrage prend quelques secondes.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

CMD ["node", "server.mjs"]
