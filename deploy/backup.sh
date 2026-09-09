#!/usr/bin/env bash
set -euo pipefail
umask 077
cd /srv/pocket-partner/deploy
backup_root=/var/backups/pocket-partner
stamp=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$backup_root/$stamp"
# Stop writers while capturing the matching database and files snapshot.
docker compose stop app worker >/dev/null
trap 'docker compose up -d app worker >/dev/null' EXIT
docker compose exec -T db pg_dump -U pocket -d pocket -Fc > "$backup_root/$stamp/database.dump"
docker run --rm --network none --user 0 --entrypoint tar -v pocket-partner_files:/source:ro -v "$backup_root/$stamp:/backup" "$(docker compose images -q app)" -czf /backup/files.tar.gz -C /source .
docker compose up -d app worker >/dev/null
trap - EXIT
# Retain three days of snapshots. Credentials are managed separately.
find "$backup_root" -mindepth 1 -maxdepth 1 -type d -mtime +2 -exec rm -rf -- {} +
