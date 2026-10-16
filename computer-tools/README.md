# computer-tools

**IT** — Strato locale sopra l'immagine "computer" upstream (il PC dei bot). Aggiunge strumenti CLI (git, jq, ripgrep, rsync, npm, pip…), lettura documenti (poppler, djvulibre, ghostscript) e OCR (tesseract eng/fra/ita), più lo script `page-text FILE [PAGINA]` che stampa una pagina di PDF/DjVu usando il layer di testo o, se vuoto, l'OCR. Nessuna immagine binaria nel repo: si costruisce localmente.

**EN** — Local layer on top of the upstream "computer" image (the bots' PC). Adds CLI tools, document readers and OCR (tesseract eng/fra/ita), plus `page-text FILE [PAGE]`, which prints one PDF/DjVu page from the text layer or falls back to OCR. No binary image is committed: build it locally.

## Build

```bash
# pin the upstream computer image by digest (see patches-v2/PINS → COMPUTER_DIGEST)
docker build \
  --build-arg BASE_IMAGE=ghcr.io/elie222/rakazo/computer@sha256:<COMPUTER_DIGEST> \
  -t rakazo-computer-tools:local computer-tools
```

Then in `.env` / poi nel `.env`:

```
RAKAZO_COMPUTER_IMAGE=rakazo-computer-tools
RAKAZO_COMPUTER_IMAGE_TAG=local
```

and restart / e riavvia: `docker compose -f docker-compose.images.yml up -d`.
Without `--build-arg` the base is `computer:edge` (unpinned). / Senza `--build-arg` la base è `computer:edge` (non fissata).
