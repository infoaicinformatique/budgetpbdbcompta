#!/usr/bin/env bash
# Mise a jour automatique d'une ExApp, equivalent de Watchtower pour une app construite depuis git.
#
# Watchtower ne convient pas : il tire une image d'un registre et recree lui-meme le conteneur,
# alors que l'ExApp est construite depuis le depot sur l'hote AIO et que son conteneur appartient
# a AppAPI (le recreer dans son dos casserait l'enregistrement Nextcloud).
#
# Ce script, lance par cron (toutes les 5 min par exemple) :
#   1. git fetch ; rien a faire si la branche suivie n'a pas bouge (cout : une requete git) ;
#   2. refuse de continuer s'il y a des modifications locales dans le clone ;
#   3. sauvegarde le volume de l'ExApp (backup-exapp.sh) — pas de mise a jour sans sauvegarde ;
#   4. git pull --ff-only, puis install-aio.sh (build, push, reenregistrement SANS perte de donnees,
#      controle final). Le build a lieu AVANT le desenregistrement : un build casse laisse l'app en place.
#
# Installation (root, sur l'hote AIO) :
#   (crontab -l 2>/dev/null; echo "*/5 * * * * /opt/<id>/nextcloud/auto-update.sh >> /var/log/<id>-autoupdate.log 2>&1") | crontab -
# Variables : BACKUP_DIR (defaut /srv/backups/<id>).
set -euo pipefail

# Tout le corps est dans une fonction appelee a la fin : bash lit ainsi le fichier en entier avant
# de l'executer, et le `git pull` qui remplace ce script en cours d'execution ne peut pas le corrompre.
main() {
  local here root info appid lock local_rev remote_rev
  here="$(cd "$(dirname "$0")" && pwd)"
  if [ "$(basename "$here")" = "nextcloud" ]; then root="$(dirname "$here")"; else root="$here"; fi
  cd "$root"
  for info in nextcloud/appinfo/info.xml appinfo/info.xml; do [ -f "$info" ] && break; done
  # Commentaires XML retires (sur une ligne ou sur plusieurs) : un exemple de balise dans un
  # commentaire ne doit pas etre lu comme la vraie valeur.
  appid="$(sed -e 's/<!--.*-->//g' -e '/<!--/,/-->/d' "$info" | sed -n 's:.*<id>\(.*\)</id>.*:\1:p' | head -n1)"
  if [ -z "$appid" ]; then echo "$(date '+%F %T') <id> introuvable dans $root/$info" >&2; exit 1; fi
  local scripts=nextcloud/scripts installer=nextcloud/install-aio.sh
  [ -d "$scripts" ] || scripts=scripts
  [ -f "$installer" ] || installer=install-aio.sh

  # Une seule mise a jour a la fois (un build peut depasser l'intervalle du cron).
  lock="/tmp/${appid}-autoupdate.lock"
  exec 9>"$lock"
  flock -n 9 || exit 0

  git fetch --quiet origin
  local_rev="$(git rev-parse HEAD)"
  remote_rev="$(git rev-parse '@{u}')"
  [ "$local_rev" = "$remote_rev" ] && exit 0

  echo "$(date '+%F %T') [$appid] nouvelle version : ${local_rev:0:7} -> ${remote_rev:0:7} ($(git log -1 --format=%s "$remote_rev"))"
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    echo "$(date '+%F %T') [$appid] modifications locales dans $root : mise a jour SUSPENDUE"
    git status --short --untracked-files=no
    exit 1
  fi
  if ! git merge-base --is-ancestor HEAD '@{u}'; then
    echo "$(date '+%F %T') [$appid] historique diverge (pas d'avance rapide possible) : mise a jour SUSPENDUE"
    exit 1
  fi

  if ! bash "$scripts/backup-exapp.sh" "$appid" "${BACKUP_DIR:-/srv/backups/$appid}"; then
    echo "$(date '+%F %T') [$appid] sauvegarde en echec : mise a jour ANNULEE"
    exit 1
  fi

  git pull --ff-only --quiet
  if bash "$installer"; then
    echo "$(date '+%F %T') [$appid] mise a jour terminee ($(git log -1 --format='%h %s'))"
  else
    echo "$(date '+%F %T') [$appid] ECHEC de install-aio.sh : voir ci-dessus ; derniere sauvegarde dans ${BACKUP_DIR:-/srv/backups/$appid}"
    exit 1
  fi
}

main "$@"
exit
