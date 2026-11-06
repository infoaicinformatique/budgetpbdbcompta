#!/usr/bin/env bash
# Vérifie l'état d'une ExApp sur Nextcloud AIO, avant et après chaque mise à jour.
# Usage : ./scripts/check-exapp.sh <appid> [chemin/vers/appinfo/info.xml]
# Code de sortie 0 = tout est OK, 1 = au moins un problème bloquant.
set -u

APPID="${1:?usage: $0 <appid> [info.xml]}"
INFO_XML="${2:-$(dirname "$0")/../appinfo/info.xml}"
NC_CT="${NC_CONTAINER:-nextcloud-aio-nextcloud}"
APP_CT="nc_app_${APPID}"
APP_VOL="nc_app_${APPID}_data"

FAIL=0
ok()   { printf '[OK]  %s\n' "$*"; }
ko()   { printf '[KO]  %s\n' "$*"; FAIL=1; }
warn() { printf '[!!]  %s\n' "$*"; }
occ()  { docker exec --user www-data "$NC_CT" php occ "$@"; }

# 1. Version de Nextcloud et compatibilité avec info.xml
NC_VER="$(occ status --output=json 2>/dev/null | sed -n 's/.*"versionstring":"\([0-9.]*\)".*/\1/p')"
if [ -z "$NC_VER" ]; then
  ko "Impossible de lire la version de Nextcloud (conteneur $NC_CT démarré ?)"
else
  NC_MAJOR="${NC_VER%%.*}"
  ok "Nextcloud $NC_VER"
  if [ -f "$INFO_XML" ]; then
    MIN="$(sed -n 's/.*<nextcloud[^>]*min-version="\([0-9]*\)".*/\1/p' "$INFO_XML" | head -n1)"
    MAX="$(sed -n 's/.*<nextcloud[^>]*max-version="\([0-9]*\)".*/\1/p' "$INFO_XML" | head -n1)"
    if [ -n "$MIN" ] && [ "$NC_MAJOR" -lt "$MIN" ]; then
      ko "Nextcloud $NC_MAJOR < min-version $MIN"
    elif [ -n "$MAX" ] && [ "$NC_MAJOR" -gt "$MAX" ]; then
      ko "Nextcloud $NC_MAJOR > max-version $MAX : relever max-version, publier une nouvelle image, puis app_api:app:update"
    elif [ -n "$MAX" ] && [ "$NC_MAJOR" -eq "$MAX" ]; then
      warn "max-version = $MAX = version actuelle : la prochaine montée majeure bloquera l'app. Tester puis relever max-version."
    else
      ok "info.xml compatible (min ${MIN:-?}, max ${MAX:-?})"
    fi
  else
    warn "info.xml introuvable ($INFO_XML) : compatibilité de version non vérifiée"
  fi
fi

# 2. Démon de déploiement
DAEMONS="$(occ app_api:daemon:list 2>/dev/null)"
if printf '%s' "$DAEMONS" | grep -q 'harp_aio'; then
  ok "Démon HaRP AIO (harp_aio) présent"
elif printf '%s' "$DAEMONS" | grep -q 'docker_aio'; then
  warn "Seul le Docker Socket Proxy (docker_aio, déprécié) est présent : activer HaRP dans l'interface AIO et migrer"
else
  ko "Aucun démon AppAPI AIO trouvé (activer HaRP dans l'interface AIO)"
fi

# 3. Enregistrement de l'ExApp
APP_LINE="$(occ app_api:app:list 2>/dev/null | grep -w -- "$APPID" | head -n1)"
if [ -z "$APP_LINE" ]; then
  ko "ExApp $APPID non enregistrée (occ app_api:app:register ...)"
elif printf '%s' "$APP_LINE" | grep -qi 'disabled'; then
  ko "ExApp enregistrée mais désactivée : $APP_LINE  ->  occ app_api:app:enable $APPID"
else
  ok "ExApp enregistrée : $APP_LINE"
fi

# 4. Conteneur de l'app
STATE="$(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$APP_CT" 2>/dev/null)"
case "$STATE" in
  "running healthy"|"running ") ok "Conteneur $APP_CT : $STATE" ;;
  "") ko "Conteneur $APP_CT absent (unregister SANS --rm-data puis register, même tag)" ;;
  *) ko "Conteneur $APP_CT : $STATE (docker logs $APP_CT)" ;;
esac

if [ -n "$STATE" ]; then
  IMAGE="$(docker inspect -f '{{.Config.Image}}' "$APP_CT")"
  REF="${IMAGE##*/}"   # nom:tag (sans le registre, qui peut contenir un port)
  if [ "${REF#*:}" = "$REF" ] || [ "${REF##*:}" = "latest" ]; then
    warn "Image sans tag figé : $IMAGE (règle R5)"
  else
    ok "Image $IMAGE"
  fi

  if docker exec "$APP_CT" sh -c 'curl -fsS "http://127.0.0.1:${APP_PORT}/heartbeat"' >/dev/null 2>&1; then
    ok "Heartbeat OK"
  else
    ko "Heartbeat KO (docker logs $APP_CT)"
  fi

  BINDS="$(docker inspect -f '{{range .Mounts}}{{if eq .Type "bind"}}{{.Source}} {{end}}{{end}}' "$APP_CT")"
  [ -z "$BINDS" ] && ok "Aucun bind mount (isolation R4)" || warn "Bind mounts présents : $BINDS (règle R4)"
fi

# 5. Volume de données
if docker volume inspect "$APP_VOL" >/dev/null 2>&1; then
  ok "Volume de données $APP_VOL présent (non couvert par la sauvegarde AIO : utiliser backup-exapp.sh)"
else
  ko "Volume $APP_VOL absent"
fi

echo
[ "$FAIL" -eq 0 ] && echo "Résultat : OK" || echo "Résultat : PROBLÈME(S) DÉTECTÉ(S)"
exit "$FAIL"
