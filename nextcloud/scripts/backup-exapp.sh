#!/usr/bin/env bash
# Sauvegarde le volume de données d'une ExApp (nc_app_<appid>_data), NON couvert par la sauvegarde Borg d'AIO.
# Usage : ./scripts/backup-exapp.sh <appid> <dossier_destination>
# Variables : KEEP=14 (nombre d'archives conservées), NO_STOP=1 (ne pas arrêter le conteneur ; moins cohérent).
# Exemple cron (tous les jours à 3h, avant la sauvegarde AIO) :
#   0 3 * * * /opt/<appid>/scripts/backup-exapp.sh <appid> /srv/backups/<appid> >> /var/log/<appid>-backup.log 2>&1
set -euo pipefail

APPID="${1:?usage: $0 <appid> <dossier_destination>}"
DEST="${2:?usage: $0 <appid> <dossier_destination>}"
KEEP="${KEEP:-14}"
APP_CT="nc_app_${APPID}"
APP_VOL="nc_app_${APPID}_data"

docker volume inspect "$APP_VOL" >/dev/null 2>&1 || { echo "Volume $APP_VOL introuvable" >&2; exit 1; }
mkdir -p "$DEST"
DEST="$(cd "$DEST" && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE="${APPID}-${STAMP}.tar.gz"

RESTART=0
if [ "${NO_STOP:-0}" != "1" ] && [ "$(docker inspect -f '{{.State.Running}}' "$APP_CT" 2>/dev/null || echo false)" = "true" ]; then
  echo "Arrêt de $APP_CT pour une sauvegarde cohérente…"
  docker stop "$APP_CT" >/dev/null
  RESTART=1
fi
restart() { if [ "$RESTART" = "1" ]; then docker start "$APP_CT" >/dev/null && echo "$APP_CT redémarré"; fi; }
trap restart EXIT

docker run --rm -v "${APP_VOL}:/data:ro" -v "${DEST}:/backup" alpine \
  tar czf "/backup/${ARCHIVE}" -C /data .

# Image exacte utilisée : permet de réinstaller la même version
docker inspect -f '{{.Config.Image}}' "$APP_CT" > "${DEST}/${APPID}-${STAMP}.image" 2>/dev/null || true

echo "Sauvegarde : ${DEST}/${ARCHIVE} ($(du -h "${DEST}/${ARCHIVE}" | cut -f1))"

# Rotation
ls -1t "${DEST}/${APPID}"-*.tar.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
  rm -f -- "$old" "${old%.tar.gz}.image"
  echo "Supprimé (rotation) : $old"
done
