#!/usr/bin/env bash
# Déploiement automatique de Budget Manager (lancé par budgetpbdbcompta-deploy.timer).
#
# Si origin/main a avancé : avance la copie locale (fast-forward uniquement,
# jamais d'écrasement), reconstruit l'image, recrée le conteneur et attend
# qu'il soit « healthy ». Sans changement, ne fait rien.
#
# Variables : DEPLOY_DIR (défaut /opt/docker/budgetpbdbcompta), DEPLOY_BRANCH (défaut main).

# Tout le script est dans une fonction : bash la lit en entier avant de
# l'exécuter, ce qui évite les surprises quand `git merge` réécrit ce fichier.
main() {
  set -euo pipefail
  local dir="${DEPLOY_DIR:-/opt/docker/budgetpbdbcompta}"
  local branch="${DEPLOY_BRANCH:-main}"
  local container=budgetpbdbcompta

  # Un seul déploiement à la fois.
  exec 9>/run/budgetpbdbcompta-deploy.lock
  flock -n 9 || { echo "Déploiement déjà en cours"; return 0; }

  cd "$dir"
  git fetch --quiet origin "$branch"

  if [ "$(git rev-parse --abbrev-ref HEAD)" != "$branch" ]; then
    echo "Passage sur la branche $branch"
    git checkout --quiet "$branch"
  fi

  local before after
  before=$(git rev-parse HEAD)
  after=$(git rev-parse "origin/$branch")
  if [ "$before" = "$after" ] && [ -n "$(docker ps -q --filter "name=^${container}$")" ]; then
    return 0
  fi

  git merge --ff-only --quiet "origin/$branch"
  echo "Mise à jour ${before:0:7} → ${after:0:7} : $(git log -1 --format=%s)"

  docker compose up -d --build --remove-orphans

  local status=absent
  for _ in $(seq 1 60); do
    status=$(docker inspect -f '{{.State.Health.Status}}' "$container" 2>/dev/null || echo absent)
    if [ "$status" = healthy ]; then
      echo "Déployé : $(git log -1 --format='%h %s')"
      docker image prune -f >/dev/null
      return 0
    fi
    sleep 2
  done
  echo "ERREUR : conteneur $container « $status » après le déploiement" >&2
  docker logs --tail 30 "$container" >&2 || true
  return 1
}

main "$@"
exit $?
