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
# Cutover modes / Modalità di cutover (CUTOVER_MODE):
#   fast (default): IT: tutto ciò che non ferma nulla (snapshot, immagine tools, compose, migrazioni one-shot,
#     cache corepack) prima; poi ricrea un servizio alla volta con --no-deps: supervisor -> api -> web -> worker,
#     aspettando ogni servizio con un polling da 0,5 s invece degli healthcheck da 10 s di compose.
#     EN: everything that stops nothing (snapshot, tools image, compose, one-shot migrations, corepack cache)
#     first; then one service at a time with --no-deps: supervisor -> api -> web -> worker, each awaited with a
#     0.5 s poll instead of compose's 10 s healthchecks.
#   legacy: IT/EN: il vecchio percorso (force-recreate di tutto lo stack + --wait) / the old whole-stack path.
#   PREMIGRATE=0 salta le migrazioni one-shot (fallo se una migrazione non è retrocompatibile: le esegue api
#     all'avvio) / skips the one-shot migrations (use it when a migration is not backward compatible).
#   ALLOW_ACTIVE_RUNS=1 salta il controllo delle run attive / skips the active-run check.
#   Ogni fase finisce in backups/cutover-<STAMP>/phases.log / every phase is logged there with timestamps.
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
# Public hostname for the final check: env, else RAKAZO_HOST from .env / da env, altrimenti da .env.
RAKAZO_HOST="${RAKAZO_HOST:-$(env_get RAKAZO_HOST .env 2>/dev/null)}"
CUTOVER_MODE="${CUTOVER_MODE:-fast}"
PHASE_LOG=/dev/null; T_START=$(date +%s.%N)
# phase MSG: timestamped line (UTC) with seconds since start, to stdout and PHASE_LOG.
phase(){ local now; now=$(date +%s.%N)
  printf '%s +%6.1fs %s\n' "$(date -u +%H:%M:%S.%3N)" "$(awk -v a="$now" -v b="$T_START" 'BEGIN{print a-b}')" "$*" | tee -a "$PHASE_LOG"; }
# wait_for DESC TIMEOUT_S CMD...: poll CMD every 0.5 s until it succeeds.
wait_for(){ local desc="$1" tmo="$2" t0; shift 2; t0=$(date +%s)
  until "$@" >/dev/null 2>&1; do
    (( $(date +%s) - t0 >= tmo )) && { phase "TIMEOUT waiting for $desc (${tmo}s)"; return 1; }
    sleep 0.5
  done; phase "ready: $desc"; }
# Active or queued runs (ACTIVE_RUN_STATUSES in packages/core/src/run-state.ts).
active_runs(){ docker exec rakazo-postgres-1 psql -U "$PG_USER" -d "$PG_DB" -At -c \
  "select count(*) from runs where status in ('queued','leased','running','waiting_input','waiting_takeover')"; }
sup_healthy(){ docker exec rakazo-supervisor-1 node -e \
  "fetch('http://127.0.0.1:7091/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; }
api_healthy(){ curl -fsS -m 2 -o /dev/null "http://127.0.0.1:${API_PORT}/health"; }
web_ready(){ curl -fsS -m 2 -o /dev/null "http://127.0.0.1:${WEB_PORT}/"; }
worker_ready(){ docker logs --since "$1" rakazo-worker-1 2>&1 | grep -q '"worker ready"'; }
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
  [[ "$CUTOVER_MODE" == fast || "$CUTOVER_MODE" == legacy ]] || { echo "CUTOVER_MODE must be fast or legacy"; exit 2; }
  B="$ROOT/backups/cutover-$STAMP"; mkdir -p "$B"; PHASE_LOG="$B/phases.log"
  phase "cutover $STAMP mode=$CUTOVER_MODE target=$IMAGE"
  if [[ "${ALLOW_ACTIVE_RUNS:-0}" != 1 ]]; then
    n=$(active_runs); [[ "$n" == 0 ]] || { phase "refusing: $n active/queued runs (ALLOW_ACTIVE_RUNS=1 to override)"; exit 4; }
  fi
  phase "snapshot start"
  snapshot_prod "$B"
  echo "$STAMP" > "$ROOT/backups/LAST_CUTOVER"
  phase "snapshot done"
  echo "== computer tools image on pinned computer digest =="
  docker pull -q "$COMP_REPO@$COMPUTER_DIGEST"
  sed "s#^FROM .*#FROM $COMP_REPO@$COMPUTER_DIGEST#" computer-tools/Dockerfile > "$B/Dockerfile.tools"
  docker build -q -t "$TOOLS_IMAGE" -f "$B/Dockerfile.tools" computer-tools
  phase "tools image done"
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
  # IT: api/worker leggono .env (env_file): la cache corepack su appdata evita di riscaricare pnpm a ogni avvio.
  # EN: api/worker read .env (env_file): a corepack cache on appdata avoids re-downloading pnpm on every start.
  [[ "$CUTOVER_MODE" == fast ]] && set_env COREPACK_HOME /data/.corepack
  "${NEWC[@]}" config -q
  API_PORT=$(env_get RAKAZO_API_PORT .env); API_PORT=${API_PORT:-3100}
  WEB_PORT=$(env_get RAKAZO_WEB_PORT .env); WEB_PORT=${WEB_PORT:-5173}
  phase "compose + .env done"
  if [[ "$CUTOVER_MODE" == legacy ]]; then
    phase "legacy: recreate whole stack (downtime starts)"
    "${NEWC[@]}" up -d --pull never --force-recreate supervisor api worker web
    phase "legacy: containers recreated"
    "${NEWC[@]}" up -d --wait --wait-timeout 400 supervisor api worker web
    phase "legacy: stack healthy"
  else
    if [[ "${PREMIGRATE:-1}" == 1 ]]; then
      # One-shot on the new image while the old stack serves; also warms the corepack cache.
      phase "premigrate start (one-shot, old stack still serving)"
      "${NEWC[@]}" run --rm --no-deps -T api bash -lc "pnpm --filter @rakazo/db exec prisma migrate deploy" 2>&1 | tail -3
      phase "premigrate done"
    fi
    phase "supervisor recreate"
    "${NEWC[@]}" up -d --no-deps --pull never --force-recreate supervisor
    wait_for supervisor 180 sup_healthy
    phase "api recreate (API downtime starts)"
    "${NEWC[@]}" up -d --no-deps --pull never --force-recreate api
    phase "api container started"
    wait_for "api /health" 400 api_healthy
    phase "web recreate (proxy retries hide the gap)"
    "${NEWC[@]}" up -d --no-deps --pull never --force-recreate web
    wait_for "web /" 300 web_ready
    phase "worker recreate"
    WSINCE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    "${NEWC[@]}" up -d --no-deps --pull never --force-recreate worker
    wait_for worker 400 worker_ready "$WSINCE"
    phase "reconcile (compose --wait, recreates nothing that is current)"
    "${NEWC[@]}" up -d --pull never --wait --wait-timeout 400 supervisor api worker web
    phase "stack healthy"
  fi
  "${NEWC[@]}" ps
  # Optional healthcheck: RAKAZO_HOST (env or .env) is your public hostname (no scheme).
  if [ -n "${RAKAZO_HOST:-}" ]; then
    curl -fsS -o /dev/null -w "site %{http_code}\n" "https://${RAKAZO_HOST}/" || true
  fi
  phase "cutover done"
  echo "phases: $PHASE_LOG"
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
