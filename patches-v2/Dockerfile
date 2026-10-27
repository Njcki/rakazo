# Rakazo fork image — tip-as-base (after 2026-10-27).
# Preferred: build the app image from REBASE_TIP git tree / existing tag rebase-7c1067d.
# This Dockerfile remains for *future* deltas: FROM an upstream-or-tip base, then git apply series/*.patch.
#
# IT: Con series/ vuota il loop apply è no-op (nessun file *.patch).
# EN: With an empty series/ the apply loop is a no-op (no *.patch files).
#
# Build (future): docker build --build-arg BASE=<image@digest-or-tag> --build-arg PATCHSET=<tag> -t rakazo-app-nk:<tag> .
ARG BASE
FROM ${BASE}
USER root
COPY series/ /tmp/rakazo-patches/
# git apply refuses partial application: any hunk that no longer fits fails the build.
# Empty series: the shell glob fails closed — skip apply when no patches.
RUN cd /app && \
    if ls /tmp/rakazo-patches/*.patch >/dev/null 2>&1; then \
      for p in /tmp/rakazo-patches/*.patch; do echo "applying $p"; git apply --whitespace=nowarn "$p" || exit 1; done; \
      CI=1 pnpm install --frozen-lockfile --prod=false --ignore-scripts --store-dir /pnpm/store \
        --config.confirmModulesPurge=false \
      && pnpm --filter @rakazo/db exec prisma generate \
      && RAKAZO_ALLOW_DEV_SECRETS=1 NODE_OPTIONS=--max-old-space-size=2048 pnpm --filter @rakazo/web build \
      && mkdir -p /app/.rakazo-patches && cp /tmp/rakazo-patches/*.patch /app/.rakazo-patches/; \
    else \
      echo "no series patches — tip-as-base / empty series"; \
    fi \
 && install -d -m 750 -o node -g node /app/apps/web/node_modules/.vite-temp
ARG PATCHSET=unknown
LABEL org.rakazo-fork.patchset=$PATCHSET
USER node
