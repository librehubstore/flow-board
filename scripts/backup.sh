#!/bin/sh
# Sauvegarde Flowboard : base MongoDB + pièces jointes, horodatées, avec rétention.
# Usage (depuis le dossier du docker-compose.yml) : scripts/backup.sh [dossier] [jours de rétention]
# Planification quotidienne (crontab de l'hôte) : 0 2 * * * cd /opt/flowboard && scripts/backup.sh /var/backups/flowboard 14
set -eu
# Git Bash (Windows) : ne pas réécrire les chemins du conteneur (/data/uploads) en chemins Windows.
export MSYS_NO_PATHCONV=1
DEST="${1:-backups}"
KEEP_DAYS="${2:-14}"
STAMP="$(date +%Y-%m-%d_%H%M)"
mkdir -p "$DEST"

docker compose exec -T mongo mongodump --db flowboard --archive --gzip > "$DEST/flowboard-$STAMP.mongo.gz"
docker compose exec -T api tar czf - -C /data/uploads . > "$DEST/flowboard-$STAMP.uploads.tgz"

# Une sauvegarde vide est un échec silencieux : on le rend bruyant.
for f in "$DEST/flowboard-$STAMP.mongo.gz" "$DEST/flowboard-$STAMP.uploads.tgz"; do
  [ -s "$f" ] || { echo "Sauvegarde vide : $f" >&2; exit 1; }
done
find "$DEST" -name 'flowboard-*' -mtime +"$KEEP_DAYS" -delete
echo "Sauvegarde OK : $DEST/flowboard-$STAMP.*"
