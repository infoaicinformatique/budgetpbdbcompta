#!/bin/sh
# Démarrage de Budget Manager en ExApp Nextcloud (lancé en root, puis le
# serveur tourne sous l'utilisateur node, comme l'image de production).
#
# Tout ce qui doit durer vit dans le volume de l'ExApp (nc_app_budgetpbdbcompta_data),
# vu ici comme /data — exactement les chemins de la production :
#   /data/droits.json, /data/budget.json, /data/historique/, /data/preferences.json
#   /data/.env          réglages LDAP (compte de service, RIGHTS_ADMINS…), repris de la production
#   /data/ldap-ca.pem   autorité de certification de l'annuaire
# Rien de tout cela n'est dans l'image ni dans Nextcloud.
set -e

DATA="${APP_PERSISTENT_STORAGE:-/data}"
mkdir -p "$DATA"
if [ "$DATA" != "/data" ] && [ ! -L /data ]; then
  rm -rf /data
  ln -s "$DATA" /data
fi
chown -R node:node "$DATA"

# Réglages repris de la production (.env), sans écraser ceux d'AppAPI.
if [ -f /data/.env ]; then
  set -a
  # shellcheck disable=SC1091
  . /data/.env
  set +a
fi

# Chemins imposés par l'ExApp, quoi que dise le .env de la production.
export HOST="${APP_HOST:-0.0.0.0}" PORT="${APP_PORT:-3000}"
export RIGHTS_FILE=/data/droits.json DATA_FILE=/data/budget.json PREFERENCES_FILE=/data/preferences.json
case "${LDAP_CA_FILE:-}" in
  ""|/certs/*) [ -f /data/ldap-ca.pem ] && export LDAP_CA_FILE=/data/ldap-ca.pem || unset LDAP_CA_FILE ;;
esac
# Le compte local de secours n'a pas de sens ici : on ne se connecte qu'à Nextcloud.
unset BASIC_AUTH_USER BASIC_AUTH_PASSWORD

exec su-exec node node /app/server.mjs
