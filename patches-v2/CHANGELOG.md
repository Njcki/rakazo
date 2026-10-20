# Changelog — patch custom Rakazo (serie v2)

Base upstream: `elie222/rakazo` commit `0723154` (`PINS`).
Ogni file in `series/NNNN-*.patch` è pensato per diventare **un commit GitHub separato** (in ordine).

Formato: `NNNN | data | titolo | scopo in una riga`.

| # | Data (Europe/Rome) | Titolo | Scopo |
|---|---|---|---|
| 0001 | 2026-10-14 | gsq-voice: alias modelli locali extra | Alias locali con etichetta/context propri da `/data/local-extra-models.json` (o env), riscritti a `upstreamId` sulla rete. |
| 0002 | 2026-10-14 | attachments: qualsiasi tipo + 100 MiB | Fallback `application/octet-stream` e limite allegati 100 MiB (web, contracts, core, thread-artifacts). |
| 0003 | 2026-10-14 | tts-language: locale UI → ElevenLabs | Passa la lingua UI a ElevenLabs come `language_code` (web → API → adapter). |
| 0004 | 2026-10-14 | i18n-it: registra locale italiano | Aggiunge `it` a lingui config, `ui-locale` e loader i18n. |
| 0005 | 2026-10-14 | compaction: timeout 480s | Timeout fisso 480s per il summarizer di compaction (hunk “no tools” non più necessario upstream). |
| 0006 | 2026-10-14 | computer-support: path `/home/rakazo` | Risolve path assoluti `/home/rakazo/...` dentro il workspace del computer. |
| 0007 | 2026-10-14 | continua: pulsante soft «Continua» | Riprende AskCard in sospeso o continua se l’ultimo testo del bot sembra incompleto. |
| 0008 | 2026-10-14 | i18n-it: catalogo web italiano | Catalogo completo IT (1107/1107, 156 stringhe nuove). |
| 0009 | 2026-10-14 | i18n-it: loader nei test | Include `it` nei loader di attivazione i18n usati dai test. |
| 0010 | 2026-10-14 | attachments: estensione > octet-stream | Se il browser manda octet-stream, vince l’estensione nota (compatibile con `.zip` upstream). |
| 0011 | 2026-10-14 | lint: biome format | Formattazione biome sui file toccati dalle patch portate. |
| 0012 | 2026-10-15 | progress: narrazione mid-turn 8000 | Testo mid-turn (prima di un tool) clamp a 8000 come messaggio finale; USER_PROGRESS resta a 500. |
| 0013 | 2026-10-15 | plan: task decomposition | Strumenti `plan_*`, tabelle DB, pannello «Piano», i18n IT, hint di sistema + reminder soft. |
| 0014 | 2026-10-15 | plan UI: fuori da Avanzate | «Piano» sezione top-level nel pannello impostazioni bot (non più sotto Advanced). |
| 0015 | 2026-10-15 | UI: Salva sticky + divisori | Divisori tra sezioni della barra destra; footer «Salva» sempre visibile in basso. |
| 0016 | 2026-10-15 | UI: card Avanzate + footer sticky | Card di Avanzate a filo e footer «Salva» sticky affinato. |
| 0017 | 2026-10-15 | plan: piani completati visibili | I piani completati restano visibili finché `plan_create` non ne crea uno nuovo. |
| 0018 | 2026-10-15 | UI: card più scure + campi bianchi | Card più scure, campi/selettori a riposo bianchi, placeholder più chiari. |
| 0019 | 2026-10-16 | UI: icone titoli barra destra | Icone Lucide a sinistra di Nome, Titolo, Descrizione, Notifiche, Avanzate (stile «Piano»). |
| 0020 | 2026-10-16 | UI: icone card Avanzate | Icone Lucide sui titoli delle card in «Avanzate» (Computer, Lavori aperti, Memoria/Skill, Modello, Ambito memoria, Voce, Strumenti, Credenziali). |
| 0021 | 2026-10-18 | chat: formule TeX (KaTeX) | `$…$`, `$$…$$`, `\(…\)`, `\[…\]` composte con remark-math + rehype-katex; prezzi tipo «$5 o $10» restano testo (regole Pandoc); nuove dipendenze katex/remark-math/rehype-katex (lockfile nel patch, `pnpm install` nel Dockerfile). |
| 0022 | 2026-10-21 | web_search: backend SearXNG / SearXNG backend | `SearxngWebProvider` (`packages/adapters/src/searxng-web.ts`): si attiva con `SEARXNG_URL` (o `WEB_PROVIDER=searxng`); opzionali `SEARXNG_TIMEOUT_MS` (10 s), `SEARXNG_CATEGORIES`, `SEARXNG_LANGUAGE`. `results[]` title/url/content → `{title,url,snippet}`; su errore/timeout/0 risultati ripiega su DuckDuckGo HTML. Nome strumento `web_search` e `web_fetch` invariati. Solo api+worker; serve `SEARXNG_URL` in `.env`. Uses a self-hosted SearXNG JSON API for web_search, DuckDuckGo fallback. |

## Compose (fuori da series/)

| Patch | Scopo |
|---|---|
| `compose/0001-…` | Supervisor: `SANDBOX_IDLE_MS` e timeout comandi default 20 min. |

## Note per commit GitHub futuri

1. Branch tipico: `selfhost-v2` sopra `0723154`.
2. Un commit per patch: `git am series/0001-….patch` … oppure `git apply` + commit con subject della patch.
3. Dopo rebase su upstream nuovo: rigenerare con `git format-patch 0723154..selfhost-v2` e aggiornare `PINS`.
4. Tag immagine: `0723154-nkN` dove N = numero di patch in `series/` (vedi `update-rakazo-v2.sh`).

## Deploy recenti (riferimento)

- nk12 (0012): 2026-10-15 — progress 8000
- nk13 (0013): 2026-10-15 — Piano / task decomposition
- nk14 (0014): 2026-10-15 — Piano fuori da Avanzate
- nk15 (0015): 2026-10-15 — sticky Salva (build; cutover light se applicato)
- nk21 (0021): 2026-10-18 — formule TeX (KaTeX); Dockerfile: `pnpm install --frozen-lockfile --prod=false` dopo i patch (senza `--prod=false` NODE_ENV=production potava le devDependencies, prisma incluso). Cutover con snapshot `20261018T182438`, ~1 min di 502.

Ultimo aggiornamento CHANGELOG: 2026-10-21 (Europe/Rome).
