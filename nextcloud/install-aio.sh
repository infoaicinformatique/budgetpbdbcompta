#!/usr/bin/env bash
# Installe ou met a jour une ExApp sur l'hote Nextcloud AIO (modele valide en production).
# A placer dans <projet>/nextcloud/install-aio.sh (ou a la racine) ; lit appinfo/info.xml.
#
#   bash nextcloud/install-aio.sh                                  # installation / mise a jour
#   NC_ROLE_MAP="Groupe=admin;Autre=reader" bash nextcloud/install-aio.sh
#   EXTRA_ENV="TZ=Europe/Paris;FOO=bar" bash nextcloud/install-aio.sh
#   bash nextcloud/install-aio.sh --import /chemin/config.tar.gz   # migration des donnees
#
# Etapes : verifications -> registre d'images local (si registry=localhost:5000) -> build + push
# -> enregistrement (ou reenregistrement SANS perte de donnees) -> import eventuel -> controle.
# Ne touche a aucun fichier d'AIO (seul info.xml est copie dans /tmp du conteneur Nextcloud).
set -euo pipefail

NC_CT="${NC_CONTAINER:-nextcloud-aio-nextcloud}"
DAEMON="${DAEMON:-harp_aio}"
REGISTRY_CT="${REGISTRY_CONTAINER:-exapp-registry}"
IMPORT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --import) IMPORT="${2:?--import attend une archive .tar.gz}"; shift 2 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "Option inconnue : $1" >&2; exit 2 ;;
  esac
done

HERE="$(cd "$(dirname "$0")" && pwd)"
# Racine du projet : parent de nextcloud/ si le script y est, sinon son propre dossier.
if [ "$(basename "$HERE")" = "nextcloud" ]; then ROOT="$(dirname "$HERE")"; else ROOT="$HERE"; fi
for f in "$ROOT/nextcloud/appinfo/info.xml" "$ROOT/appinfo/info.xml"; do [ -f "$f" ] && INFO="$f" && break; done
[ -n "${INFO:-}" ] || { echo "appinfo/info.xml introuvable" >&2; exit 1; }
for d in "$ROOT/nextcloud/scripts" "$ROOT/scripts"; do [ -d "$d" ] && SCRIPTS="$d" && break; done
for f in "${DOCKERFILE:-}" "$ROOT/Dockerfile.exapp" "$ROOT/Dockerfile"; do [ -n "$f" ] && [ -f "$f" ] && DOCKERFILE="$f" && break; done

# Commentaires XML retires (sur une ligne ou sur plusieurs) : un exemple de balise dans un
# commentaire serait sinon lu comme la vraie valeur.
xml() { sed -e 's/<!--.*-->//g' -e '/<!--/,/-->/d' "$INFO" | sed -n "s:.*<$1>\(.*\)</$1>.*:\1:p" | head -n1; }
APPID="$(xml id)"; VERSION="$(xml version)"
REGISTRY="$(xml registry)"; IMAGE="$(xml image)"; TAG="$(xml image-tag)"
REF="${REGISTRY:+$REGISTRY/}$IMAGE:$TAG"
if [ -z "$APPID" ] || [ -z "$IMAGE" ] || [ -z "$TAG" ]; then
  echo "info.xml incomplet (<id>, <image>, <image-tag>) : $INFO" >&2; exit 1
fi

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
ok()   { printf '    [OK] %s\n' "$*"; }
die()  { printf '    [KO] %s\n' "$*" >&2; exit 1; }
occ()  { docker exec --user www-data "$NC_CT" php occ "$@"; }

# Variables d'environnement transmises a l'ExApp
ENV_ARGS=()
if [ -n "${NC_ROLE_MAP:-}" ]; then ENV_ARGS+=(--env "NC_ROLE_MAP=$NC_ROLE_MAP"); fi
if [ -n "${EXTRA_ENV:-}" ]; then
  IFS=';' read -ra _extra <<< "$EXTRA_ENV"
  for e in "${_extra[@]}"; do if [ -n "$e" ]; then ENV_ARGS+=(--env "$e"); fi; done
fi

# --------------------------------------------------------------------------- 0
step "Verifications ($APPID $VERSION)"
command -v docker >/dev/null || die "docker introuvable"
docker info >/dev/null 2>&1 || die "Docker inaccessible (lancer en root ou avec sudo)"
[ "$(docker inspect -f '{{.State.Running}}' "$NC_CT" 2>/dev/null)" = "true" ] || die "Conteneur $NC_CT non demarre"
ok "Nextcloud $(occ status --output=json | sed -n 's/.*"versionstring":"\([0-9.]*\)".*/\1/p')"
[ "$TAG" = "$VERSION" ] || die "info.xml : image-tag ($TAG) different de version ($VERSION)"
[ -n "${DOCKERFILE:-}" ] || die "Dockerfile introuvable (DOCKERFILE=...)"
ok "Image cible : $REF (depuis $(basename "$DOCKERFILE"))"
# Sortie capturee d'abord : avec pipefail, `occ ... | grep -q` peut echouer sur SIGPIPE.
DAEMONS="$(occ app_api:daemon:list)"
printf '%s\n' "$DAEMONS" | grep -q "$DAEMON" || die "Demon $DAEMON absent : activer HaRP dans l'interface AIO"
ok "Demon $DAEMON present"
if [ -n "${NC_ROLE_MAP:-}" ]; then
  GROUPS_JSON="$(occ group:list --output=json 2>/dev/null || true)"
  for entry in $(printf '%s' "$NC_ROLE_MAP" | tr ';,' '  '); do
    g="${entry%%=*}"
    if printf '%s' "$GROUPS_JSON" | grep -q "\"$g\""; then ok "Groupe $g -> ${entry#*=}"
    else printf '    [!!] Groupe Nextcloud "%s" introuvable (occ group:list)\n' "$g"; fi
  done
fi

# --------------------------------------------------------------------------- 1
if [ "$REGISTRY" = "localhost:5000" ]; then
  step "Registre d'images local (localhost:5000, partage par toutes les ExApps)"
  if curl -fsS http://127.0.0.1:5000/v2/ >/dev/null 2>&1; then
    ok "Registre deja actif"
  else
    docker run -d --restart=always --name "$REGISTRY_CT" \
      -p 127.0.0.1:5000:5000 -v exapp_registry_data:/var/lib/registry registry:2 >/dev/null
    for _ in $(seq 1 20); do curl -fsS http://127.0.0.1:5000/v2/ >/dev/null 2>&1 && break; sleep 1; done
    curl -fsS http://127.0.0.1:5000/v2/ >/dev/null 2>&1 || die "Registre muet sur 127.0.0.1:5000"
    ok "Registre $REGISTRY_CT demarre (ecoute uniquement en local)"
  fi
fi

# --------------------------------------------------------------------------- 2
step "Construction de l'image $REF"
docker build -f "$DOCKERFILE" -t "$REF" "$ROOT"
docker push "$REF"
ok "Image poussee"

# --------------------------------------------------------------------------- 3
step "Enregistrement dans Nextcloud"
docker cp "$INFO" "$NC_CT:/tmp/$APPID-info.xml"
APPS="$(occ app_api:app:list)"
if printf '%s\n' "$APPS" | grep -qw -- "$APPID"; then
  # Reenregistrement : applique aussi les --env et les routes. SANS --rm-data.
  echo "    ExApp deja presente : reenregistrement (donnees conservees)"
  occ app_api:app:unregister "$APPID" --silent
fi
occ app_api:app:register "$APPID" "$DAEMON" --info-xml "/tmp/$APPID-info.xml" ${ENV_ARGS[@]+"${ENV_ARGS[@]}"} --wait-finish
ok "ExApp $APPID enregistree"

# --------------------------------------------------------------------------- 4
if [ -n "$IMPORT" ]; then
  step "Import des donnees ($IMPORT)"
  "$SCRIPTS/restore-exapp.sh" "$APPID" "$IMPORT" --yes
fi

# --------------------------------------------------------------------------- 5
step "Controle final"
chmod +x "$SCRIPTS"/*.sh
sleep 5
"$SCRIPTS/check-exapp.sh" "$APPID" "$INFO" || true

cat <<EOF

Termine. Entree de menu Nextcloud ajoutee ; lien direct :
  <url-nextcloud>/index.php/apps/app_api/embedded/$APPID/main
Sauvegarde a programmer (le volume n'est PAS dans la sauvegarde AIO) :
  0 3 * * * $SCRIPTS/backup-exapp.sh $APPID /srv/backups/$APPID
EOF
