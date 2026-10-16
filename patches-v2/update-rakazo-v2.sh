#!/usr/bin/env bash
# Rakazo update v2: pinned upstream digest + reproducible patch series (patches-v2/series).
# Old update-rakazo.sh is untouched. Default is a dry run.
#
#   ./update-rakazo-v2.sh check                    # show pinned vs remote digests, patch list
#   ./update-rakazo-v2.sh build  [APP_DIGEST]      # build rakazo-app-nk:<tag> (applies series, builds web)
#   ./update-rakazo-v2.sh cutover --yes            # snapshot prod, migrate, recreate on the new image
#   ./update-rakazo-v2.sh rollback --yes           # back to the snapshot images + DB dump taken at cutover
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
  B="$ROOT/backups/cutover-$STAMP"; mkdir -p "$B"
  echo "== snapshot prod (no restart; --pause=false) =="
  for s in api worker web supervisor; do
    docker commit --pause=false "rakazo-$s-1" "rakazo-rollback-$s:$STAMP" >/dev/null
  done
  cp .env docker-compose.images.yml "$B/"
  docker exec rakazo-postgres-1 pg_dump -U "${POSTGRES_USER:-rakazo}" -d "${POSTGRES_DB:-rakazo}" -Fc > "$B/db.dump"
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
rollback)
  need_yes
  S=$(cat "$ROOT/backups/LAST_CUTOVER"); B="$ROOT/backups/cutover-$S"
  "${NEWC[@]}" stop api worker web supervisor || true
  cp "$B/.env" .env; cp "$B/docker-compose.images.yml" docker-compose.images.yml
  echo "== restore DB (new migrations are forward-only) =="
  docker exec -i rakazo-postgres-1 pg_restore -U "${POSTGRES_USER:-rakazo}" -d "${POSTGRES_DB:-rakazo}" --clean --if-exists --no-owner < "$B/db.dump"
  # Snapshot images carry the old live patches (incl. Italian web dist) in their layers.
  cat > docker-compose.rollback.override.yml <<YML
services:
  api: {image: rakazo-rollback-api:$S}
  worker: {image: rakazo-rollback-worker:$S}
  web: {image: rakazo-rollback-web:$S}
  supervisor: {image: rakazo-rollback-supervisor:$S}
YML
  docker compose --env-file .env -f docker-compose.images.yml -f docker-compose.rollback.override.yml \
    up -d --force-recreate --wait --wait-timeout 400 supervisor api worker web
  echo "rolled back to snapshot $S" ;;
*) echo "unknown command $CMD"; exit 2 ;;
esac
