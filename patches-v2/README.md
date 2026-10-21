# Rakazo patches v2 (reproducible, pinned)

Base: upstream `elie222/rakazo` commit `0723154` = `ghcr.io/elie222/rakazo/app@sha256:ec48ecd3…`
(computer `@sha256:75c3cdc5…`). Pins in `PINS`. The image is built by `Dockerfile`:
`FROM <pinned digest>` → `git apply` every `series/*.patch` (any hunk that no longer fits fails the
build) → `pnpm --filter @rakazo/web build`. No `docker cp`, nothing lost on recreate.

Source branch: `selfhost-v2` on top of `0723154` (regenerate with `git format-patch 0723154..selfhost-v2`).
To move to a newer upstream: rebase the branch (or `git am -3 series/*.patch` on the new commit),
fix conflicts, run `pnpm check` + vitest, regenerate `series/`, update `PINS`, `update-rakazo-v2.sh build`.

## Series
| # | Patch | What | Notes vs. old patches |
|---|---|---|---|
| 0001 | gsq-voice | Extra local model aliases (`/data/local-extra-models.json` or `RAKAZO_LOCAL_EXTRA_MODELS`), own label/context/max tokens; alias id rewritten to `upstreamId` on the wire | same as live 14 Oct patch; `pi-local-provider.ts` unchanged upstream |
| 0002 | attachments | `application/octet-stream` any-type fallback, 100 MiB limit (contracts, core, thread-artifacts, web Shell text) | merged next to upstream `application/zip` (#1289) |
| 0010 | attachments fix | known extension beats a generic octet-stream report (keeps upstream `.zip` inference) + tests | new: needed after the zip merge |
| 0003 | tts-language | web sends UI locale → API → ElevenLabs `language_code` | the API half was NOT live in prod since 5 Oct; now complete |
| 0004/0008/0009 | i18n-it | `it` registered (lingui config, ui-locale, i18n loaders, test loaders); catalog 1107/1107 (156 new strings translated) | |
| 0005 | compaction | flat 480 s summarizer timeout | "no tools for compact:" hunk dropped: upstream passes `tools: []` and no longer falls back to builtin tools |
| 0006 | computer-support | `/home/rakazo/...` absolute paths resolve inside the workspace | was not live since 5 Oct |
| 0007 | continua | soft «Continua» button: answers a pending AskCard (choice-1/«continua») or resumes when the last bot text looks unfinished | was not live since 5 Oct; rewritten for new Composer API, reads text blocks (old code read a non-existent `.text`) |
| 0011 | lint | biome formatting | |

`compose/0001-…patch`: supervisor gets `SANDBOX_IDLE_MS` and the 20-min command timeout default.

## Dropped (and why)
- **timeouts** (undici 30-min body/headers, `MODEL_STREAM_TIMEOUT_MS` 30 min, local `longStreamFetch`):
  not live since the 5 Oct edge merge and prod has run 9 days without them; upstream now has
  `MODEL_STREAM_TIMEOUT_MS` (headers) + `MODEL_STREAM_IDLE_TIMEOUT_MS` 180 s idle; reasoning streams keep
  the idle timer alive. Old files kept in `../patches/timeouts` if long silent prefills ever abort.
- **run-limits / incomplete-continue `pi-runtime-limits.ts`**: identical to upstream already — nothing to port.
- **tool cap**: native `MAX_TOOL_CALLS_PER_TURN` env (still in `.env`, 500) — no code patch.
- **markdown tables (chat-ui)**: upstream ships GFM tables + `repairMarkdownTableDelimiters`; ours (Sept) is superseded.
- **reply-proxy**: lives on the home PC, not in the image.
- **mobile i18n**: APK build tree, not the server image (`../patches/i18n-it-mobile`).

- 0012 progress: mid-turn narration (text before a tool call) clamped at 8000 (final-message limit) instead of 500; USER_PROGRESS 500 cap kept for send-progress beats. Deployed 0723154-nk12 on api+worker 2026-10-15.

- 0013 plan: Task Decomposition — `plan_*` tools, DB `agent_plans`/`agent_plan_steps`, right-rail «Piano» panel (computer + settings), Italian i18n, system hint + soft `_planReminder` every 3 non-plan tools. Dockerfile now runs `prisma generate` after patches.

- 0014 plan UI: «Piano» moved out of Advanced / Avanzate to a top-level section in bot settings (computer panel was already top-level); light separator.

- 0015 UI: right-rail section dividers; sticky Save footer in bot settings (`bot-settings-footer`).

## Backup (incrementale)

Per i backup di routine usare `~/rakazo/backup-incremental.sh` (DB con `pg_dump -Fc` solo se
cambiato, `.env`/compose solo se mtime cambiato, **nessun** `docker commit`; retention `RETAIN=3`).
Il rollback alle immagini resta sui tag `0723154-nkN` e sugli snapshot di cutover
(`update-rakazo-v2.sh cutover` / `rollback`). Changelog patch: `CHANGELOG.md`.

### Snapshot di cutover veloce / fast cutover snapshot (2026-10-21)

IT: `update-rakazo-v2.sh cutover` non fa più `docker commit` dei container (circa 9 minuti su una VPS
lenta, sito rallentato): lo snapshot salva `.env` (con il `RAKAZO_IMAGE_TAG` precedente), i file compose,
`PREVIOUS` (immagini in uso) e un `pg_dump -Fc -Z zstd:3` eseguito con `nice -n 19 ionice -c3` dentro il
container postgres, verificato con `pg_restore -l`; in prova circa 2 s. `snapshot` fa solo lo snapshot
(nessun container ricreato, `LAST_CUTOVER` invariato). `rollback --yes [STAMP]` ripristina `.env`, compose e
DB e ricrea sul tag precedente; rifiuta (exit 3) se l'immagine del tag o quella computer mancano, quindi il
tag precedente non va eliminato. Gli snapshot vecchi con immagini `rakazo-rollback-*` tornano indietro come
prima. `SNAPSHOT_COMMIT_IMAGES=1` ripristina il vecchio `docker commit`. Healthcheck finale solo con
`RAKAZO_HOST`.

EN: `cutover` no longer runs `docker commit` on the containers (about 9 minutes on a slow VPS, site slowed
down). The snapshot keeps `.env` (holding the previous `RAKAZO_IMAGE_TAG`), the compose files, `PREVIOUS`
(images in use) and a `pg_dump -Fc -Z zstd:3` run under `nice -n 19 ionice -c3` inside the postgres
container and checked with `pg_restore -l`; about 2 s in testing. `snapshot` takes only the snapshot (nothing
recreated, `LAST_CUTOVER` unchanged). `rollback --yes [STAMP]` restores `.env`, compose and DB and recreates on
the previous tag; it refuses (exit 3) when that image or the computer image is missing, so never prune the
previous tag. Older snapshots with `rakazo-rollback-*` images roll back as before. `SNAPSHOT_COMMIT_IMAGES=1`
brings back the old `docker commit`. Final healthcheck only with `RAKAZO_HOST`.

### Backup notturno incrementale / nightly incremental backup (2026-10-21)

IT: `backup-nightly.sh` (da copiare in `~/rakazo/`) fa un backup restic cifrato e deduplicato del volume
`rakazo_appdata` (letto in sola lettura via `sudo`; esclusi le cartelle con `CACHEDIR.TAG` e `homes/*/.cache`),
di un `pg_dump -Fc -Z 0` appena fatto (non compresso, così restic lo deduplica e lo comprime) e di `.env` e dei
file compose. Retention `--keep-daily 7 --keep-weekly 4 --keep-monthly 3 --prune`; la domenica `restic check
--read-data-subset=5%`. Gira con `nice -n 19 ionice -c3` e `flock` (una sola istanza), log in
`~/rakazo/backups/nightly-*.log` (ultimi 14), `LAST_NIGHTLY_OK` a fine run. Prerequisiti: binario restic statico
in `~/bin/restic` (SHA256 verificato su `SHA256SUMS` della release), password in
`~/.config/rakazo-backup/restic-password` (mode 600: senza questo file i backup sono illeggibili, conservarne una
copia fuori dal server), `restic init` su `~/rakazo-backups-repo` (di root, perché restic gira via sudo). Cron
utente: `CRON_TZ=Europe/Rome` e `30 4 * * * ~/rakazo/backup-nightly.sh`. Il repository sta sullo stesso disco:
protegge da errori e cancellazioni, non dalla perdita del server; per quello serve una copia esterna
(object storage o PC di casa, ad es. `restic copy`).

EN: `backup-nightly.sh` (copy to `~/rakazo/`) makes an encrypted, deduplicated restic backup of the
`rakazo_appdata` volume (read-only through `sudo`; `CACHEDIR.TAG` folders and `homes/*/.cache` excluded), a fresh
`pg_dump -Fc -Z 0` (uncompressed so restic can deduplicate and compress it) and `.env` plus the compose files.
Retention `--keep-daily 7 --keep-weekly 4 --keep-monthly 3 --prune`; on Sundays `restic check
--read-data-subset=5%`. Runs under `nice -n 19 ionice -c3` and `flock` (single instance), logs to
`~/rakazo/backups/nightly-*.log` (last 14), writes `LAST_NIGHTLY_OK` when done. Needs a static restic binary in
`~/bin/restic` (SHA256 checked against the release `SHA256SUMS`), a password in
`~/.config/rakazo-backup/restic-password` (mode 600: without it the backups cannot be read, keep a copy off the
server) and `restic init` on `~/rakazo-backups-repo` (root-owned, since restic runs through sudo). User cron:
`CRON_TZ=Europe/Rome` and `30 4 * * * ~/rakazo/backup-nightly.sh`. The repository sits on the same disk: it
covers mistakes and deletions, not losing the server; that needs an off-site copy (object storage or a home PC,
e.g. `restic copy`).

Copie esterne / offsite copies: ogni file `~/.config/rakazo-backup/offsite-NOME.env` (mode 600) è una
destinazione. Dopo un backup locale riuscito lo script esegue `restic copy` (solo host/tag del nightly) e
`forget --prune` 7/4/3 sulla destinazione, con `nice`/`ionice` e un timeout per comando (`OFFSITE_TIMEOUT_MIN`,
default 240; restic ritenta a lungo una destinazione irraggiungibile). Una destinazione che fallisce scrive solo un
`WARN` nel log e non fa fallire il backup locale. Guardia di dimensione: se la stima (dimensione del repo locale,
che la copia rispecchia con la stessa retention) supera `OFFSITE_MAX_GB` (default 18, sotto i 20 GB gratuiti di
OCI) la copia viene saltata con un avviso. Chiavi: `OFFSITE_REPOSITORY` (es.
`s3:https://NAMESPACE.compat.objectstorage.REGION.oraclecloud.com/BUCKET/restic`), `OFFSITE_PASSWORD_FILE`
(diversa da quella locale), `OFFSITE_PRUNE` (0 per destinazioni append-only), `OFFSITE_RESTIC_ARGS` (per OCI
`-o s3.bucket-lookup=path`), `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_DEFAULT_REGION` (Customer Secret Key
OCI) oppure `RESTIC_REST_USERNAME`/`RESTIC_REST_PASSWORD`. Inizializzare con `restic init --copy-chunker-params
--from-repo …` per mantenere la deduplicazione. `--offsite-only` esegue solo le copie.

EN: each `~/.config/rakazo-backup/offsite-NAME.env` file (mode 600) is one target. After a successful local
backup the script runs `restic copy` (nightly host/tag only) and `forget --prune` 7/4/3 on the target, under
`nice`/`ionice` with a per-command timeout (`OFFSITE_TIMEOUT_MIN`, default 240; restic keeps retrying a dead target
for a long time). A failing target only logs a `WARN` and never fails the local backup. Size guard: when the
estimate (the local repo size, which the copy mirrors with the same retention) exceeds `OFFSITE_MAX_GB` (default
18, below OCI's 20 GB free tier) the copy is skipped with a warning. Keys as listed above; initialise with
`restic init --copy-chunker-params --from-repo …` to keep deduplication. `--offsite-only` runs just the copies.
A home PC can instead pull over a private network (e.g. Tailscale) with `restic copy --no-lock` from a
read-only source, so it needs no inbound port.

- 0016 UI: Advanced accordion groups in light cards; sticky Save footer flush to panel bottom (settings pb-0 + footer -mb).

- 0017 plan: keep completed plans visible in sidebar until plan_create replaces them (getDisplayPlan); no nested sub-steps.

- 0018 UI: Advanced cards darker (bg-muted/60); idle NativeSelect/Input/textarea forced white (dark: background) so they do not look disabled.

- 0021 chat: TeX math rendered with remark-math + rehype-katex (shared `packages/chat-ui/src/math.ts` normalizer, Pandoc dollar rules so prices stay text). First patch that adds npm packages: it carries the `pnpm-lock.yaml` hunk and the Dockerfile now runs `pnpm install --frozen-lockfile --store-dir /pnpm/store` after `git apply`.

- 0022 web: `web_search` via a self-hosted SearXNG JSON API (`SearxngWebProvider`, `packages/adapters/src/searxng-web.ts`) when `SEARXNG_URL` is set (or `WEB_PROVIDER=searxng`); optional `SEARXNG_TIMEOUT_MS` (default 10 s), `SEARXNG_CATEGORIES`, `SEARXNG_LANGUAGE`. Falls back to DuckDuckGo HTML on error, timeout or zero results; tool names and `web_fetch` unchanged. Runtime-only (api + worker, no web rebuild needed); set e.g. `SEARXNG_URL=http://searxng:8080` in `.env` (api/worker read it via `env_file`).
- 0023 web: Tavily (`TavilyWebProvider`, `packages/adapters/src/tavily-web.ts`) as the second `web_search` tier when `TAVILY_API_KEY` is set: SearXNG → Tavily → DuckDuckGo, Tavily only when SearXNG errors, times out or returns nothing; basic depth (1 credit), optional `TAVILY_TIMEOUT_MS`; each call is logged (`web_search Tavily call`). `WEB_PROVIDER=tavily` puts it first. Runtime-only (api + worker).
- 0024 web: Exa (`exa-web.ts`) and Serper (`serper-web.ts`) as `web_search` tiers 3 and 4 on a shared `ApiSearchTier` base: SearXNG → Tavily → Exa → Serper → DuckDuckGo, each tier only with its key (`EXA_API_KEY`, `SERPER_API_KEY`) and only after every earlier tier failed or found nothing. Exa: type auto (`EXA_SEARCH_TYPE`), short highlights as snippets, cost logged; Serper: `{q, num, gl, hl}` (`SERPER_GL`/`SERPER_HL`). Optional `EXA_TIMEOUT_MS`, `SERPER_TIMEOUT_MS`; every call logged. `WEB_PROVIDER=tavily|exa|serper` starts the chain at that tier. Runtime-only (api + worker).
- 0025 chat (web): the transcript sticks to the bottom (within 100 px) for bot replies, streaming and late layout (images, charts, KaTeX) via a ResizeObserver on the rows; a click/tap no longer stops following (root cause: pointerdown/touchstart cleared `following`), scrolling up does; the reader's own send returns to the bottom; incoming messages while scrolled up show a dot on the jump button ("Jump to latest, new messages" / "Vai all'ultimo, nuovi messaggi"). Web-only (needs a web rebuild).
- 0026 agent: final-answer guard (`packages/adapters/src/final-answer-guard.ts`, `pi-runtime.ts`). A text-only reply right after tool results that looks like an announced next step (tool call leaked as text such as `call:default_api:shell{…}`, trailing `:`/`…`, or a short unstructured first-person announcement) is treated as narration and gets an internal follow-up: keep going with native tool calls or write the final summary (done / found / remains / «continua», no announced actions). `DANGLING_NARRATION_NUDGES` (default 2, 0 = off, max 5); skipped while ask_user is pending, after the budget or on a provider error; silence clause kept for `allowSilentEmpty`. When `MAX_TOOL_CALLS_PER_TURN` (prod 500, unchanged) is spent, one final no-tools call asks for the same summary before the stop notice (`TOOL_BUDGET_FINAL_SUMMARY=0` = old behavior). api+worker only (worker runs the agent); no DB/compose/frontend change.
- 0027 agent: mid-run steering keeps the run going (`final-answer-guard.ts`, `pi-runtime.ts` `prepareNextTurnWithContext`). Messages injected at a turn boundary via `agent.steer` get `MID_RUN_STEERING_NOTE` in front (status/summary → brief answer in the user's language via `message_user` or alongside the next tool call, then continue; stop/change course only if explicitly asked). Steering claimed at run start and continuation runs are not framed; DB/history keep the original text. A text-only reply right after a mid-run steer is treated as a status update and gets `steeringContinuePrompt` (resume with tools, or final summary if the user asked to stop / the task is done), sharing 0026's `DANGLING_NARRATION_NUDGES` cap and exclusions. `STEERING_CONTINUE_NOTE=0` disables note and nudge (default on). api+worker only.
- 0028 agent: progress cadence and plan reminders (`progress-cadence.ts`, `pi-runtime.ts`, `executor.ts`, `plan-context.ts`). Silent-stretch nudge: after `PROGRESS_NUDGE_TOOLS` (default 8) tool calls or `PROGRESS_NUDGE_SECONDS` (150, needs 2+ tools) with nothing visible, `prepareNextTurnWithContext` steers an internal note asking for one short `message_user` line plus `plan_update_step`, then more tools; cap `PROGRESS_NUDGE_MAX` (8); re-arms if ignored; a text-only reply right after it gets `progressNudgeContinuePrompt` (shares the 0026 cap). Off for routines/background runs and when `message_user` is disabled. Narration throttle: narration is promoted to a chat message only if `PROGRESS_NARRATION_MIN_GAP_S` (40) passed since the previous one, otherwise it stays a live progress line; never throttled after a mid-run user message; `message_user` is never throttled. Plan: the 0013 `_planReminder` counter was declared inside the per-call `applyTool` closure (always 1, never fired); it is now per run, every `PLAN_REMINDER_EVERY` (4); with no active plan, one `PLAN_CREATE_REMINDER` after `PLAN_CREATE_NUDGE_TOOLS` (4) non-plan tools (not on messaging-channel runs). Prompt: `LONG_WORK_PROGRESS_GUIDANCE` states the cadence (every 5-8 tools or 2 min, each milestone, one-line ack of mid-run messages); `MID_RUN_STEERING_NOTE` (0027) now asks to acknowledge every mid-run message in one line, not only status questions; plan clause and completed-plan preamble say a completed plan does not cover a new request. Every threshold: 0 disables.
- 0029 agent + supervisor: offline model server detected in ~5 s, exec heartbeat (`pi-openai-compatible-provider.ts`, `pi-runtime.ts`, `infra/sandboxes/supervisor/src/index.ts`). OpenAI-compatible connect (TCP/TLS handshake only, never the streamed answer) is bounded by `OPENAI_COMPATIBLE_CONNECT_TIMEOUT_MS` (default 5000; 0 = undici default); an endpoint that fails to connect is marked offline for `OPENAI_COMPATIBLE_OFFLINE_TTL_MS` (default 60000; 0 = off), so later requests fail at once and the backup model takes over; after the TTL the next request re-probes and a success clears it. The OpenAI SDK's "Connection error." now advances the fallback chain like timeouts. Supervisor `/exec` writes an empty NDJSON line every `SANDBOX_EXEC_HEARTBEAT_MS` (default 30000; 0 = off) so quiet commands are not cut by the worker's 300 s body timeout. Image side: `computer-tools/chromium` headless wrapper (drops the libnss_wrapper preload, `--no-sandbox`, temp profile, hard `RAKAZO_HEADLESS_CHROMIUM_TIMEOUT` limit, default 90 s, reaping crashpad); built by `update-rakazo-v2.sh cutover` into the same `rakazo-computer-tools:<computer digest>` tag, so tag the old image before a cutover if you may need it back.
