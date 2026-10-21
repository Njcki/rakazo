#!/usr/bin/env bash
# Rakazo update v2: pinned upstream digest + reproducible patch series (patches-v2/series).
# Old update-rakazo.sh is untouched. Default is a dry run.
#
#   ./update-rakazo-v2.sh check                    # show pinned vs remote digests, patch list
#   ./update-rakazo-v2.sh build  [APP_DIGEST]      # build rakazo-app-nk:<tag> (applies series, builds web)
#   ./update-rakazo-v2.sh snapshot                 # snapshot only (.env, compose, DB dump); recreates nothing
#   ./update-rakazo-v2.sh cutover --yes            # snapshot prod, migrate, recreate on the new image
#   ./update-rakazo-v2.sh rollback --yes [STAMP]   # back to the image tag + DB dump of a snapshot (default LAST_CUTOVER)
#
# Snapshot (fast, default): copies .env (which holds the previous RAKAZO_IMAGE_TAG), the compose files
# and a pg_dump -Fc (zstd:3 when supported) run with nice/ionice inside the postgres container. No
# docker commit: the previous rakazo-app-nk:<tag> image is the rollback image, so it must not be pruned.
# SNAPSHOT_COMMIT_IMAGES=1 restores the old, slow behaviour (docker commit of api/worker/web/supervisor).
# Older snapshots that carry rakazo-rollback-* images still roll back the old way.
#
# Pins live in patches-v2/PINS (APP_DIGEST, COMPUTER_DIGEST, UPSTREAM_COMMIT).
#
# Backups: prefer ~/rakazo/backup-incremental.sh for routine DB/.env/compose snapshots
# (no docker commit; keeps last N=3). Full cutover still does docker commit + db.dump
# for rollback images. See patches-v2/CHANGELOG.md for the patch series.
set -euo pipefail
ROOT=/home/opc/rakazo
P2="$ROOT/patches-v2"
cd "$ROOT"
# shellcheck disable=SC1091
source "$P2/PINS"
CMD="${1:-check}"; shift || true
YES=0; for a in "$@"; do [[ "$a" == "--yes" ]] && YES=1; done
[[ "${1:-}" =~ ^sha256: ]] && APP_DIGEST="$1"
APP_REPO=ghcr.io/elie222/rakazo/app
COMP_REPO=ghcr.io/elie222/rakazo/computer
NSERIES=$(ls "$P2"/series/*.patch | wc -l)
TAG="${UPSTREAM_COMMIT:0:7}-nk${NSERIES}"
IMAGE="rakazo-app-nk:$TAG"
TOOLS_IMAGE="rakazo-computer-tools:${COMPUTER_DIGEST#sha256:}"; TOOLS_IMAGE="${TOOLS_IMAGE:0:40}"
OLDC=(docker compose --env-file .env -f docker-compose.images.yml)
NEWC=(docker compose --env-file .env -f docker-compose.images.v2.yml)
STAMP=$(date +%Y%m%dT%H%M%S)
need_yes(){ [[ $YES -eq 1 ]] || { echo "refusing without --yes"; exit 2; }; }
env_get(){ { grep -E "^$1=" "$2" || true; } | tail -1 | cut -d= -f2-; }
PG_USER="${POSTGRES_USER:-rakazo}"; PG_DB="${POSTGRES_DB:-rakazo}"
# snapshot_prod DIR: no restart, nothing recreated.
snapshot_prod(){
  local B="$1" t0; mkdir -p "$B"; t0=$(date +%s)
  if [[ "${SNAPSHOT_COMMIT_IMAGES:-0}" == "1" ]]; then
    echo "== snapshot: docker commit (SNAPSHOT_COMMIT_IMAGES=1, slow) =="
    for s in api worker web supervisor; do
      docker commit --pause=false "rakazo-$s-1" "rakazo-rollback-$s:$(basename "$B" | sed 's/^[a-z-]*-//')" >/dev/null
    done
    echo images > "$B/MODE"
  else
    echo tag > "$B/MODE"
  fi
  cp -p .env "$B/.env"; chmod 600 "$B/.env"
  for f in docker-compose.images.v2.yml docker-compose.images.yml; do [[ -f "$f" ]] && cp -p "$f" "$B/"; done
  { echo "image=$(env_get RAKAZO_IMAGE .env):$(env_get RAKAZO_IMAGE_TAG .env)"
    echo "computer=$(env_get RAKAZO_COMPUTER_IMAGE .env):$(env_get RAKAZO_COMPUTER_IMAGE_TAG .env)"; } > "$B/PREVIOUS"
  echo "== snapshot: pg_dump (nice/ionice) =="
  local PGD=(docker exec rakazo-postgres-1 nice -n 19 ionice -c3 pg_dump -U "$PG_USER" -d "$PG_DB" -Fc)
  if ! "${PGD[@]}" -Z zstd:3 > "$B/db.dump" 2>"$B/pg_dump.err"; then
    echo "zstd not available, default compression"; "${PGD[@]}" > "$B/db.dump"
  fi
  rm -f "$B/pg_dump.err"
  docker exec -i rakazo-postgres-1 pg_restore -l < "$B/db.dump" >/dev/null || { echo "db.dump unreadable"; exit 1; }
  echo "snapshot $(basename "$B"): $(cat "$B/MODE"), $(cat "$B/PREVIOUS" | tr '\n' ' ')db $(du -h "$B/db.dump" | cut -f1), $(( $(date +%s) - t0 )) s"
}

case "$CMD" in
check)
  echo "pinned app:      $APP_DIGEST ($UPSTREAM_COMMIT)"
  echo "pinned computer: $COMPUTER_DIGEST"
  echo "remote app:      $(docker buildx imagetools inspect $APP_REPO:edge | awk '/^Digest:/{print $2;exit}')"
  echo "remote computer: $(docker buildx imagetools inspect $COMP_REPO:edge | awk '/^Digest:/{print $2;exit}')"
  echo "running api:     $(docker inspect rakazo-api-1 --format '{{.Config.Image}} {{.Image}}' 2>/dev/null)"
  echo "target image:    $IMAGE"; ls "$P2/series" ;;
build)
  docker pull -q "$APP_REPO@$APP_DIGEST"
  (cd "$P2" && nice -n 19 docker build --build-arg BASE="$APP_REPO@$APP_DIGEST" \
      --build-arg PATCHSET="$TAG" -t "$IMAGE" .)
  echo "built $IMAGE" ;;
cutover)
  need_yes
  docker image inspect "$IMAGE" >/dev/null
  B="$ROOT/backups/cutover-$STAMP"
  snapshot_prod "$B"
  echo "$STAMP" > "$ROOT/backups/LAST_CUTOVER"
  echo "== computer tools image on pinned computer digest =="
  docker pull -q "$COMP_REPO@$COMPUTER_DIGEST"
  sed "s#^FROM .*#FROM $COMP_REPO@$COMPUTER_DIGEST#" computer-tools/Dockerfile > "$B/Dockerfile.tools"
  docker build -q -t "$TOOLS_IMAGE" -f "$B/Dockerfile.tools" computer-tools
  echo "== compose v2 = upstream compose (from the image) + our compose patches =="
  docker run --rm --entrypoint cat "$IMAGE" /app/infra/compose/docker-compose.images.yml > docker-compose.images.v2.yml
  for cp in "$P2"/compose/*.patch; do docker run --rm -i -u "$(id -u)" -v "$ROOT:/w" -w /w --entrypoint patch "$IMAGE" --batch -s -p1 docker-compose.images.v2.yml < "$cp"; done
  echo "== .env: point at the patched image; new compose already prefixes 127.0.0.1 =="
  set_env(){ grep -q "^$1=" .env && sed -i "s#^$1=.*#$1=$2#" .env || echo "$1=$2" >> .env; }
  set_env RAKAZO_IMAGE rakazo-app-nk
  set_env RAKAZO_IMAGE_TAG "$TAG"
  set_env RAKAZO_COMPUTER_IMAGE "${TOOLS_IMAGE%%:*}"
  set_env RAKAZO_COMPUTER_IMAGE_TAG "${TOOLS_IMAGE#*:}"
  set_env RAKAZO_WEB_PORT 5173
  "${NEWC[@]}" config -q
  echo "== recreate (downtime starts) =="
  "${NEWC[@]}" up -d --pull never --force-recreate supervisor api worker web
  "${NEWC[@]}" up -d --wait --wait-timeout 400 supervisor api worker web
  "${NEWC[@]}" ps
  # Optional healthcheck: set RAKAZO_HOST to your public hostname (no scheme).
  if [ -n "${RAKAZO_HOST:-}" ]; then
    curl -fsS -o /dev/null -w "site %{http_code}\n" "https://${RAKAZO_HOST}/" || true
  fi
  echo "rollback: $0 rollback --yes  (snapshot $STAMP)" ;;
snapshot)
  snapshot_prod "$ROOT/backups/snapshot-$STAMP"
  echo "snapshot only: nothing recreated, LAST_CUTOVER unchanged" ;;
rollback)
  need_yes
  S="${ROLLBACK_STAMP:-}"
  for a in "$@"; do [[ "$a" =~ ^[0-9]{8}T[0-9]{6}$ ]] && S="$a"; done
  [[ -n "$S" ]] || S=$(cat "$ROOT/backups/LAST_CUTOVER")
  B="$ROOT/backups/cutover-$S"
  [[ -d "$B" && -f "$B/db.dump" ]] || { echo "refusing: snapshot $B or its db.dump is missing"; exit 3; }
  MODE=$(cat "$B/MODE" 2>/dev/null || echo images)
  if [[ "$MODE" == "tag" ]]; then
    OLD_IMAGE="$(env_get RAKAZO_IMAGE "$B/.env"):$(env_get RAKAZO_IMAGE_TAG "$B/.env")"
    OLD_COMP="$(env_get RAKAZO_COMPUTER_IMAGE "$B/.env"):$(env_get RAKAZO_COMPUTER_IMAGE_TAG "$B/.env")"
    docker image inspect "$OLD_IMAGE" >/dev/null 2>&1 || {
      echo "refusing: rollback image $OLD_IMAGE is missing (pruned?). Rebuild it or pick another snapshot."; exit 3; }
    [[ "$OLD_COMP" == ":" ]] || docker image inspect "$OLD_COMP" >/dev/null 2>&1 || {
      echo "refusing: computer image $OLD_COMP is missing. Rebuild it or pick another snapshot."; exit 3; }
    [[ -f "$B/docker-compose.images.v2.yml" ]] || { echo "refusing: $B has no docker-compose.images.v2.yml"; exit 3; }
    echo "== rollback to $OLD_IMAGE (snapshot $S) =="
    "${NEWC[@]}" stop api worker web supervisor || true
    cp -p "$B/.env" .env; cp -p "$B/docker-compose.images.v2.yml" docker-compose.images.v2.yml
    echo "== restore DB (new migrations are forward-only) =="
    docker exec -i rakazo-postgres-1 pg_restore -U "$PG_USER" -d "$PG_DB" --clean --if-exists --no-owner < "$B/db.dump"
    "${NEWC[@]}" up -d --pull never --force-recreate --wait --wait-timeout 400 supervisor api worker web
    echo "rolled back to $OLD_IMAGE (snapshot $S)"
  else
    # Legacy snapshot: rakazo-rollback-* images from docker commit.
    for s in api worker web supervisor; do
      docker image inspect "rakazo-rollback-$s:$S" >/dev/null 2>&1 || {
        echo "refusing: legacy snapshot $S lacks image rakazo-rollback-$s:$S"; exit 3; }
    done
    # Snapshots taken with SNAPSHOT_COMMIT_IMAGES=1 (MODE file) saved the v2 compose; older ones the v1 file.
    LCF=docker-compose.images.yml; [[ -f "$B/MODE" && -f "$B/docker-compose.images.v2.yml" ]] && LCF=docker-compose.images.v2.yml
    "${NEWC[@]}" stop api worker web supervisor || true
    cp "$B/.env" .env; cp "$B/$LCF" "$LCF"
    echo "== restore DB (new migrations are forward-only) =="
    docker exec -i rakazo-postgres-1 pg_restore -U "$PG_USER" -d "$PG_DB" --clean --if-exists --no-owner < "$B/db.dump"
    # Snapshot images carry the old live patches (incl. Italian web dist) in their layers.
    cat > docker-compose.rollback.override.yml <<YML
services:
  api: {image: rakazo-rollback-api:$S}
  worker: {image: rakazo-rollback-worker:$S}
  web: {image: rakazo-rollback-web:$S}
  supervisor: {image: rakazo-rollback-supervisor:$S}
YML
    docker compose --env-file .env -f "$LCF" -f docker-compose.rollback.override.yml \
      up -d --force-recreate --wait --wait-timeout 400 supervisor api worker web
    echo "rolled back to legacy snapshot $S"
  fi ;;
*) echo "unknown command $CMD"; exit 2 ;;
esac
