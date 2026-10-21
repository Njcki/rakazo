#!/usr/bin/env bash
# Rakazo nightly incremental backup (restic, encrypted, deduplicated).
#   ~/rakazo/backup-nightly.sh            # normal run (cron)
#   ~/rakazo/backup-nightly.sh --no-prune # skip forget/prune
# Covers: rakazo_appdata volume (read-only, via sudo, CACHEDIR.TAG dirs and homes/*/.cache excluded),
#         a fresh pg_dump (-Fc -Z0, so restic can deduplicate + compress it), .env and compose files.
# Retention: keep-daily 7, keep-weekly 4, keep-monthly 3 (+ prune). Runs under nice 19 / ionice idle / flock.
# Repo: ~/rakazo-backups-repo (owned by root because restic runs via sudo to read the volume).
# Password: ~/.config/rakazo-backup/restic-password (mode 600; LOSING IT = LOSING THE BACKUPS).
# Inspect:  sudo -n env RESTIC_REPOSITORY=~/rakazo-backups-repo RESTIC_PASSWORD_FILE=~/.config/rakazo-backup/restic-password ~/bin/restic snapshots
set -euo pipefail
umask 077

if [[ -z "${RAKAZO_BACKUP_NICED:-}" ]]; then
  export RAKAZO_BACKUP_NICED=1
  exec nice -n 19 ionice -c3 "$0" "$@"
fi

H="${HOME:?}"
ROOT="$H/rakazo"
RESTIC="$H/bin/restic"
export RESTIC_REPOSITORY="${RESTIC_REPOSITORY:-$H/rakazo-backups-repo}"
export RESTIC_PASSWORD_FILE="${RESTIC_PASSWORD_FILE:-$H/.config/rakazo-backup/restic-password}"
export RESTIC_CACHE_DIR=/var/cache/rakazo-restic
STAGE="$H/rakazo-backups-staging"
LOGDIR="$ROOT/backups"
LOCK="$H/.cache/rakazo-backup-nightly.lock"
KEEP_LOGS="${KEEP_LOGS:-14}"
PG_USER="${POSTGRES_USER:-rakazo}"; PG_DB="${POSTGRES_DB:-rakazo}"

mkdir -p "$STAGE" "$LOGDIR" "$(dirname "$LOCK")"
exec 9>"$LOCK"
if ! flock -n 9; then echo "$(date -Is) another backup-nightly is running, exit"; exit 0; fi

LOG="$LOGDIR/nightly-$(date +%Y%m%dT%H%M%S).log"
exec >>"$LOG" 2>&1
log(){ printf '%s %s\n' "$(date -Is)" "$*"; }
trap 'rc=$?; [[ $rc -ne 0 ]] && log "FAILED rc=$rc"; exit $rc' EXIT
R(){ sudo -n --preserve-env=RESTIC_REPOSITORY,RESTIC_PASSWORD_FILE,RESTIC_CACHE_DIR nice -n 19 ionice -c3 "$RESTIC" "$@"; }

log "start (repo=$RESTIC_REPOSITORY)"
[[ -x "$RESTIC" ]] || { log "restic missing"; exit 1; }
[[ -s "$RESTIC_PASSWORD_FILE" ]] || { log "password file missing"; exit 1; }
VOL=$(docker volume inspect rakazo_appdata -f '{{.Mountpoint}}')

log "pg_dump"
docker exec rakazo-postgres-1 nice -n 19 ionice -c3 pg_dump -U "$PG_USER" -d "$PG_DB" -Fc -Z 0 > "$STAGE/rakazo-db.dump.tmp"
docker exec -i rakazo-postgres-1 pg_restore -l < "$STAGE/rakazo-db.dump.tmp" >/dev/null
mv -f "$STAGE/rakazo-db.dump.tmp" "$STAGE/rakazo-db.dump"
mkdir -p "$STAGE/config"
cp -a "$ROOT/.env" "$ROOT"/docker-compose*.yml "$STAGE/config/" 2>/dev/null || true
log "pg_dump ok ($(du -h "$STAGE/rakazo-db.dump" | cut -f1))"

log "restic backup"
R backup --host rakazo-vps --tag nightly --exclude-caches \
  --exclude "$VOL/homes/*/.cache" \
  "$VOL" "$STAGE"

if [[ "${1:-}" != "--no-prune" ]]; then
  log "restic forget/prune"
  R forget --host rakazo-vps --tag nightly --keep-daily 7 --keep-weekly 4 --keep-monthly 3 --prune
fi
if [[ "$(date +%u)" == "7" ]]; then
  log "weekly restic check (5% data)"
  R check --read-data-subset=5%
fi

find "$LOGDIR" -maxdepth 1 -name 'nightly-*.log' -type f | sort | head -n -"$KEEP_LOGS" | xargs -r rm -f
date -Is > "$LOGDIR/LAST_NIGHTLY_OK"
log "done"
