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
USER 1000
