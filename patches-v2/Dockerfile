# Rakazo + fork patches, built on a PINNED upstream image (no blind file copies).
# Build: docker build --build-arg BASE=ghcr.io/elie222/rakazo/app@sha256:<digest> -t rakazo-app-nk:<tag> .
ARG BASE
FROM ${BASE}
USER root
COPY series/ /tmp/rakazo-patches/
# git apply refuses partial application: any hunk that no longer fits fails the build.
RUN cd /app && for p in /tmp/rakazo-patches/*.patch; do \
      echo "applying $p"; git apply --whitespace=nowarn "$p" || exit 1; \
    done \
 && pnpm --filter @rakazo/db exec prisma generate \
 && RAKAZO_ALLOW_DEV_SECRETS=1 NODE_OPTIONS=--max-old-space-size=2048 pnpm --filter @rakazo/web build \
 && install -d -m 750 -o node -g node /app/apps/web/node_modules/.vite-temp \
 && mkdir -p /app/.rakazo-patches && cp /tmp/rakazo-patches/*.patch /app/.rakazo-patches/
ARG PATCHSET=unknown
LABEL org.rakazo-fork.patchset=$PATCHSET
USER node
