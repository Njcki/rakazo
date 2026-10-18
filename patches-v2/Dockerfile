# Rakazo + fork patches, built on a PINNED upstream image (no blind file copies).
# Build: docker build --build-arg BASE=ghcr.io/elie222/rakazo/app@sha256:<digest> -t rakazo-app-nk:<tag> .
ARG BASE
FROM ${BASE}
USER root
COPY series/ /tmp/rakazo-patches/
# Patches that add npm packages (0021: katex, remark-math, rehype-katex) also patch pnpm-lock.yaml.
# The base image keeps node_modules but not its store, so pnpm install points at the store path
# recorded in node_modules/.modules.yaml (/pnpm/store/v3): linked packages stay, new ones download.
# --prod=false: the image sets NODE_ENV=production, and the base install includes devDependencies
# (prisma, vite); without it pnpm would prune them.
# git apply refuses partial application: any hunk that no longer fits fails the build.
RUN cd /app && for p in /tmp/rakazo-patches/*.patch; do \
      echo "applying $p"; git apply --whitespace=nowarn "$p" || exit 1; \
    done \
 && CI=1 pnpm install --frozen-lockfile --prod=false --ignore-scripts --store-dir /pnpm/store \
      --config.confirmModulesPurge=false \
 && pnpm --filter @rakazo/db exec prisma generate \
 && RAKAZO_ALLOW_DEV_SECRETS=1 NODE_OPTIONS=--max-old-space-size=2048 pnpm --filter @rakazo/web build \
 && install -d -m 750 -o node -g node /app/apps/web/node_modules/.vite-temp \
 && mkdir -p /app/.rakazo-patches && cp /tmp/rakazo-patches/*.patch /app/.rakazo-patches/
ARG PATCHSET=unknown
LABEL org.rakazo-fork.patchset=$PATCHSET
USER node
