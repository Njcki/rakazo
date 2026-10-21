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
| 0023 | 2026-10-21 | web_search: Tavily come 2° livello / Tavily second tier | `TavilyWebProvider` (`packages/adapters/src/tavily-web.ts`), POST `https://api.tavily.com/search`, Bearer, `search_depth: basic` (1 credito), `max_results` = limite. Con `TAVILY_API_KEY` la catena è SearXNG → Tavily → DuckDuckGo: Tavily solo se SearXNG va in errore/timeout/0 risultati. `WEB_PROVIDER=tavily` lo mette primo; opzionale `TAVILY_TIMEOUT_MS` (10 s). Ogni chiamata loggata (`web_search Tavily call`: esito, risultati, durata). Solo api+worker; serve `TAVILY_API_KEY` in `.env`. |
| 0024 | 2026-10-21 | web_search: Exa + Serper (3° e 4° livello / tiers 3 and 4) | Catena SearXNG → Tavily → Exa → Serper → DuckDuckGo, ogni livello solo con la sua chiave e solo se tutti i precedenti falliscono/0 risultati. Base comune `ApiSearchTier` (`api-search-tier.ts`). Exa (`exa-web.ts`): `x-api-key`, `type` auto (`EXA_SEARCH_TYPE`, lite più economico), `numResults` = limite, highlights 300 caratteri; costo nel log. Serper (`serper-web.ts`): `X-API-KEY`, `{q, num, gl, hl}` (`SERPER_GL`/`SERPER_HL`), `organic[]`. Timeout `EXA_TIMEOUT_MS`/`SERPER_TIMEOUT_MS` (10 s). Log `web_search Exa call` / `web_search Serper call`. Solo api+worker; servono `EXA_API_KEY`, `SERPER_API_KEY` in `.env`. |
| 0025 | 2026-10-21 | chat web: resta in fondo ai nuovi messaggi / stick to bottom | In fondo (entro 100 px) la trascrizione segue risposte, streaming e crescita tardiva (immagini, grafici, KaTeX) con `ResizeObserver` sulle righe (`observeTranscriptContent` in `transcript-scroll.ts`). Causa: `onPointerDown`/`onTouchStart` azzeravano `following`, quindi un clic/tap in fondo fermava l'auto-scroll. Ora clic/tap rimandano lo scatto al rilascio; scorrere in su lo ferma; il proprio invio riporta in fondo; messaggi in arrivo da più in alto accendono un pallino sul pulsante («Vai all'ultimo, nuovi messaggi»). Solo web (serve rebuild web). |
| 0026 | 2026-10-21 | agent: niente risposte finali tronche / final-answer guard | Causa (run del 21/10, 56 tool su 500): Gemini ha chiuso con un testo che annunciava il passo successivo e la chiamata `call:default_api:shell{…}` scritta come testo, salvato come risposta finale. `final-answer-guard.ts`: `looksLikeDanglingNarration` (tool call nel testo, `:`/`…` finali, annuncio breve in prima persona it/en/es/fr/de). Dopo i tool una risposta così è trattata come narrazione e riceve un follow-up interno: continua con tool veri o scrivi il riepilogo finale (fatto, trovato, cosa resta, «continua»; niente annunci). `DANGLING_NARRATION_NUDGES` (default 2, 0 off). Budget `MAX_TOOL_CALLS_PER_TURN` esaurito: chiamata finale senza strumenti con lo stesso riepilogo, poi l'avviso di stop (`TOOL_BUDGET_FINAL_SUMMARY=0` disattiva). Limite 500 invariato. Solo api+worker. |
| 0027 | 2026-10-21 | agent: messaggio a metà run non chiude il lavoro / mid-run steering keeps the run going | Causa: lo steering iniettato al confine del turno arrivava al modello così com'era; una richiesta di riepilogo portava a una risposta di solo testo, trattata come finale. Ora, solo per lo steering a metà run, `MID_RUN_STEERING_NOTE` (in inglese; risposta breve nella lingua dell'utente, poi riprendi; fermati solo se richiesto esplicitamente). Risposta di solo testo subito dopo lo steering → follow-up `steeringContinuePrompt` (riprendi con strumenti, oppure riepilogo finale se l'utente ha chiesto di fermarsi), con il limite `DANGLING_NARRATION_NUDGES` della 0026. Steering all'avvio e run di continuazione invariati. `STEERING_CONTINUE_NOTE=0` disattiva. Solo api+worker. |

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
- nk22 (0022): 2026-10-21 — web_search via SearXNG (`SEARXNG_URL` in `.env`, letto da api/worker con `env_file`), fallback DuckDuckGo. Build senza errori; cutover completo con snapshot `20261020T222036` (DB incluso), circa 1–1,5 min di 502.
- nk23 (0023): 2026-10-21 — Tavily 2° livello di web_search (`TAVILY_API_KEY` in `.env`). Build senza errori; cutover completo con snapshot `20261020T232253` (DB incluso), circa 50 s di 502. Verificato: SearXNG risponde dal worker; con SearXNG irraggiungibile il log mostra `web_search Tavily call` (5 risultati).
- nk24 (0024): 2026-10-21 — Exa + Serper 3° e 4° livello di web_search (`EXA_API_KEY`, `SERPER_API_KEY` in `.env`). Build senza errori; cutover completo con snapshot `20261020T234028` (DB incluso), circa 55 s di 502. Verificato: SearXNG risponde dal worker; container usa-e-getta: `web_search Exa call` (5 risultati, 0,007 USD) e `web_search Serper call` (5 risultati).
- nk27 (0025–0027): 2026-10-21 — chat web in fondo ai nuovi messaggi (0025), guardia sulla risposta finale + riepilogo a budget esaurito (0026), steering a metà run senza interruzioni (0027). Nessuna nuova variabile obbligatoria (`DANGLING_NARRATION_NUDGES`, `TOOL_BUDGET_FINAL_SUMMARY`, `STEERING_CONTINUE_NOTE` opzionali, default attivi). Build senza errori (27 patch applicate); cutover completo con snapshot `20261021T004039` (DB incluso), circa 66 s di 502 (02:50:10–02:51:16 ora italiana) più qualche timeout isolato del sito durante lo snapshot. Verificato: api/worker/web su nk27, codice 0026/0027 nel worker, stringhe 0025 nel bundle web, SearXNG risponde dal worker (25 risultati), chiavi Tavily/Exa/Serper presenti, nessun errore nei log. / Full cutover with snapshot, ~66 s of 502; verified.
- 2026-10-21 — `update-rakazo-v2.sh`: snapshot di cutover senza `docker commit` (`.env` col tag precedente, compose, `PREVIOUS`, `pg_dump -Fc -Z zstd:3` con nice/ionice), nuovo comando `snapshot` (solo snapshot), `rollback --yes [STAMP]` sul tag precedente con rifiuto se l'immagine manca, snapshot vecchi con immagini rollback ancora supportati, `SNAPSHOT_COMMIT_IMAGES=1` per il vecchio comportamento. Prova `snapshot`: 2 s, dump 10 MB (prima ~9 min). / Cutover snapshot without docker commit; snapshot-only command; tag-based rollback that refuses when the image is missing.
- 2026-10-21 — `backup-nightly.sh`: backup notturno incrementale con restic (volume `rakazo_appdata` in sola lettura, `pg_dump` non compresso, `.env` e compose), retention 7 giornalieri / 4 settimanali / 3 mensili con prune, check settimanale sul 5% dei dati, nice/ionice/flock, log ruotati (14), cron alle 04:30 ora italiana (`CRON_TZ=Europe/Rome`). Primo backup completo avviato il 21/10 alle 03:04. / Nightly incremental restic backup of the app volume, DB dump and config; 7/4/3 retention with prune; weekly 5% check; cron 04:30 Europe/Rome.

Ultimo aggiornamento CHANGELOG: 2026-10-21 (Europe/Rome).
