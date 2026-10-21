ARG BASE_IMAGE=ghcr.io/elie222/rakazo/computer:edge
FROM ${BASE_IMAGE}
USER root
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ca-certificates curl wget unzip zip gzip bzip2 xz-utils git openssh-client \
      jq file tree rsync patch less binutils xxd bsdmainutils \
      iputils-ping dnsutils ripgrep python3-pip npm \
      poppler-utils djvulibre-bin ghostscript \
      tesseract-ocr tesseract-ocr-eng tesseract-ocr-fra tesseract-ocr-ita \
 && rm -rf /var/lib/apt/lists/*
COPY page-text /usr/local/bin/page-text
# nk29 (0029): headless-safe chromium wrapper. /usr/local/bin precedes /usr/bin, so
# `chromium --headless …` drops the libnss_wrapper preload (headless Chromium
# hangs forever with it), adds --no-sandbox (no userns / SUID helper here) and
# a hard time limit (RAKAZO_HEADLESS_CHROMIUM_TIMEOUT, default 90 s) that also
# reaps crashpad so `| head` pipelines end. Desktop launches pass through.
COPY --chmod=755 chromium /usr/local/bin/chromium
USER 1000
