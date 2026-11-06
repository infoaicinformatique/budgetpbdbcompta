#!/usr/bin/env bash
# Restaure le volume de données d'une ExApp à partir d'une archive créée par backup-exapp.sh.
# ATTENTION : remplace tout le contenu actuel de nc_app_<appid>_data.
# Usage : ./scripts/restore-exapp.sh <appid> <archive.tar.gz> [--yes]
set -euo pipefail

APPID="${1:?usage: $0 <appid> <archive.tar.gz> [--yes]}"
ARCHIVE="${2:?usage: $0 <appid> <archive.tar.gz> [--yes]}"
APP_CT="nc_app_${APPID}"
APP_VOL="nc_app_${APPID}_data"

[ -f "$ARCHIVE" ] || { echo "Archive introuvable : $ARCHIVE" >&2; exit 1; }
tar tzf "$ARCHIVE" >/dev/null || { echo "Archive illisible : $ARCHIVE" >&2; exit 1; }
DIR="$(cd "$(dirname "$ARCHIVE")" && pwd)"
FILE="$(basename "$ARCHIVE")"

if [ "${3:-}" != "--yes" ]; then
  printf 'Le contenu actuel de %s sera REMPLACÉ par %s. Continuer ? [oui/N] ' "$APP_VOL" "$FILE"
  read -r answer
  [ "$answer" = "oui" ] || { echo "Annulé."; exit 1; }
fi

docker volume inspect "$APP_VOL" >/dev/null 2>&1 || docker volume create "$APP_VOL" >/dev/null

RESTART=0
if [ "$(docker inspect -f '{{.State.Running}}' "$APP_CT" 2>/dev/null || echo false)" = "true" ]; then
  docker stop "$APP_CT" >/dev/null
  RESTART=1
fi
restart() { if [ "$RESTART" = "1" ]; then docker start "$APP_CT" >/dev/null && echo "$APP_CT redémarré"; fi; }
trap restart EXIT

docker run --rm -v "${APP_VOL}:/data" -v "${DIR}:/backup:ro" alpine \
  sh -c "find /data -mindepth 1 -delete && tar xzf '/backup/${FILE}' -C /data"

echo "Restauration terminée dans $APP_VOL."
if ! docker inspect "$APP_CT" >/dev/null 2>&1; then
  echo "Le conteneur $APP_CT n'existe pas : réenregistrer l'app (même tag d'image) :"
  echo "  docker exec --user www-data nextcloud-aio-nextcloud php occ app_api:app:register $APPID harp_aio --info-xml /tmp/${APPID}-info.xml --wait-finish"
fi
