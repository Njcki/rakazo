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
