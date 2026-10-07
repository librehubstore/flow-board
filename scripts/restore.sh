#!/bin/sh
# Restauration Flowboard depuis une sauvegarde de scripts/backup.sh.
# Usage : scripts/restore.sh backups/flowboard-AAAA-MM-JJ_HHMM
# ATTENTION : remplace intégralement la base et les pièces jointes actuelles.
set -eu
# Git Bash (Windows) : ne pas réécrire les chemins du conteneur (/data/uploads) en chemins Windows.
export MSYS_NO_PATHCONV=1
PREFIX="${1:?Usage : scripts/restore.sh <dossier>/flowboard-AAAA-MM-JJ_HHMM}"
[ -s "$PREFIX.mongo.gz" ] && [ -s "$PREFIX.uploads.tgz" ] || { echo "Sauvegarde introuvable : $PREFIX.*" >&2; exit 1; }

docker compose stop api
docker compose exec -T mongo mongorestore --drop --archive --gzip < "$PREFIX.mongo.gz"
docker compose run --rm -T --no-deps --entrypoint sh api -c 'find /data/uploads -mindepth 1 -delete && tar xzf - -C /data/uploads' < "$PREFIX.uploads.tgz"
docker compose start api
echo "Restauration OK depuis $PREFIX"
