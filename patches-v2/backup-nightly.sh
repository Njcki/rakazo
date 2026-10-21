#!/usr/bin/env bash
# Rakazo nightly incremental backup (restic, encrypted, deduplicated).
#   ~/rakazo/backup-nightly.sh            # normal run (cron)
#   ~/rakazo/backup-nightly.sh --no-prune # skip forget/prune
#   ~/rakazo/backup-nightly.sh --offsite-only # only copy existing snapshots to the offsite repos
# Covers: rakazo_appdata volume (read-only, via sudo, CACHEDIR.TAG dirs and homes/*/.cache excluded),
#         a fresh pg_dump (-Fc -Z0, so restic can deduplicate + compress it), .env and compose files.
# Retention: keep-daily 7, keep-weekly 4, keep-monthly 3 (+ prune). Runs under nice 19 / ionice idle / flock.
# Repo: ~/rakazo-backups-repo (owned by root because restic runs via sudo to read the volume).
# Password: ~/.config/rakazo-backup/restic-password (mode 600; LOSING IT = LOSING THE BACKUPS).
# Offsite copies (optional): every ~/.config/rakazo-backup/offsite-NAME.env (mode 600) is one target.
#   After a successful local backup: restic copy (host/tag filtered) + forget/prune 7/4/3 on the target.
#   A failing target only logs a warning; it never fails the local backup. Keys in the file:
#     OFFSITE_REPOSITORY=s3:https://NAMESPACE.compat.objectstorage.REGION.oraclecloud.com/BUCKET/restic
#                       or rest:http://HOST:8000/rakazo/   (restic rest-server)
#     OFFSITE_PASSWORD_FILE=~/.config/rakazo-backup/restic-password-NAME   (different from the local one)
#     OFFSITE_MAX_GB=18        size guard: skip (with a warning) when the target would exceed this
#     OFFSITE_TIMEOUT_MIN=240  per-command limit (restic retries a dead target for a long time)
#     OFFSITE_RESTIC_ARGS="-o s3.bucket-lookup=path"   extra restic options (word-split)
#     OFFSITE_PRUNE=1          0 for append-only targets (prune runs on the target side)
#     AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_DEFAULT_REGION   (S3-compatible targets)
#     RESTIC_REST_USERNAME / RESTIC_REST_PASSWORD                       (rest-server targets)
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

MODE="${1:-}"
LOG="$LOGDIR/nightly-$(date +%Y%m%dT%H%M%S).log"
exec >>"$LOG" 2>&1
log(){ printf '%s %s\n' "$(date -Is)" "$*"; }
trap 'rc=$?; [[ $rc -ne 0 ]] && log "FAILED rc=$rc"; exit $rc' EXIT
R(){ sudo -n --preserve-env=RESTIC_REPOSITORY,RESTIC_PASSWORD_FILE,RESTIC_CACHE_DIR nice -n 19 ionice -c3 "$RESTIC" "$@"; }

offsite_copy(){ # $1 = offsite-NAME.env ; runs in a subshell, never exits the main script
  local f="$1" name; name=$(basename "$f" .env); name=${name#offsite-}
  (
    set +e
    set -a; . "$f"; set +a
    [[ -n "${OFFSITE_REPOSITORY:-}" && -s "${OFFSITE_PASSWORD_FILE:-}" ]] || { log "WARN offsite $name: OFFSITE_REPOSITORY or password file missing"; exit 1; }
    local_repo="$RESTIC_REPOSITORY"; local_pw="$RESTIC_PASSWORD_FILE"
    export RESTIC_REPOSITORY="$OFFSITE_REPOSITORY" RESTIC_PASSWORD_FILE="$OFFSITE_PASSWORD_FILE"
    export RESTIC_FROM_REPOSITORY="$local_repo" RESTIC_FROM_PASSWORD_FILE="$local_pw"
    D(){ timeout -k 60 "${D_TIMEOUT:-${OFFSITE_TIMEOUT_MIN:-240}m}" sudo -n --preserve-env=RESTIC_REPOSITORY,RESTIC_PASSWORD_FILE,RESTIC_FROM_REPOSITORY,RESTIC_FROM_PASSWORD_FILE,RESTIC_CACHE_DIR,AWS_ACCESS_KEY_ID,AWS_SECRET_ACCESS_KEY,AWS_DEFAULT_REGION,RESTIC_REST_USERNAME,RESTIC_REST_PASSWORD nice -n 19 ionice -c3 "$RESTIC" ${OFFSITE_RESTIC_ARGS:-} "$@"; }
    max=$(( ${OFFSITE_MAX_GB:-18} * 1000000000 ))
    local_bytes=$(sudo -n du -sb "$local_repo" | cut -f1)
    dest_bytes=$(D_TIMEOUT=180 D stats --mode raw-data --json 2>/dev/null | python3 -c 'import sys,json; print(json.load(sys.stdin).get("total_size",0))' 2>/dev/null) \
      || { log "WARN offsite $name: target unreachable or not initialised, skipped"; exit 1; }
    # The target mirrors the local snapshots with the same retention, so the local repo size is the estimate.
    est=$(( local_bytes > dest_bytes ? local_bytes : dest_bytes ))
    if (( est > max )); then
      log "WARN offsite $name: size guard, estimated $((est/1000000)) MB > ${OFFSITE_MAX_GB:-18} GB, copy SKIPPED"; exit 1
    fi
    log "offsite $name: copy (target now $((dest_bytes/1000000)) MB, estimate $((est/1000000)) MB)"
    D copy --host rakazo-vps --tag nightly || { log "WARN offsite $name: copy failed"; exit 1; }
    if [[ "${OFFSITE_PRUNE:-1}" == "1" && "$MODE" != "--no-prune" ]]; then
      D forget --host rakazo-vps --tag nightly --keep-daily 7 --keep-weekly 4 --keep-monthly 3 --prune \
        || { log "WARN offsite $name: forget/prune failed"; exit 1; }
    fi
    date -Is > "$LOGDIR/LAST_OFFSITE_OK-$name"
    log "offsite $name: ok"
  ) || true
}

if [[ "$MODE" != "--offsite-only" ]]; then
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

if [[ "$MODE" != "--no-prune" ]]; then
  log "restic forget/prune"
  R forget --host rakazo-vps --tag nightly --keep-daily 7 --keep-weekly 4 --keep-monthly 3 --prune
fi
if [[ "$(date +%u)" == "7" ]]; then
  log "weekly restic check (5% data)"
  R check --read-data-subset=5%
fi
fi

shopt -s nullglob
for f in "$H"/.config/rakazo-backup/offsite-*.env; do offsite_copy "$f"; done
shopt -u nullglob

find "$LOGDIR" -maxdepth 1 -name 'nightly-*.log' -type f | sort | head -n -"$KEEP_LOGS" | xargs -r rm -f
[[ "$MODE" == "--offsite-only" ]] || date -Is > "$LOGDIR/LAST_NIGHTLY_OK"
log "done"
