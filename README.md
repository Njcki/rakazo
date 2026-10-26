# Rakazo

[![GitHub stars](https://img.shields.io/github/stars/elie222/rakazo?labelColor=black&style=for-the-badge&color=2563EB)](https://github.com/elie222/rakazo/stargazers)
[![Discord](https://img.shields.io/badge/Discord-Join%20the%20community-5865F2?labelColor=black&style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/RWwKa2Sn7h)
[![Download on the App Store](https://img.shields.io/badge/App%20Store-Download%20for%20iPhone-black?labelColor=black&style=for-the-badge&logo=apple&logoColor=white)](https://apps.apple.com/app/rakazo/id6801531099)
[![Download the Android APK](https://img.shields.io/badge/Android-Download%20APK-black?labelColor=black&style=for-the-badge&logo=android&logoColor=white)](https://github.com/elie222/rakazo/releases/download/android/rakazo.apk)

![Rakazo — AI teammates you actually own](./docs/readme-hero.png)

Rakazo is an open source AI agent for persistent teammates, and a self-hosted AI assistant you
can run on your own machine. It is available on the web, as an Electron desktop app, and on
[iPhone](https://apps.apple.com/app/rakazo/id6801531099) and [Android](https://github.com/elie222/rakazo/releases/download/android/rakazo.apk). Bring your own model
and computer provider, or run the complete stack locally.

It is an open source, self-hosted alternative to Grok Bot, Meta Muse, OpenAI Dots, Instinct,
OpenClaw, Hermes Agent, and Hark Pro.

Rakazo is in beta. Learn more at [rakazo.com](https://rakazo.com).

## Fork personale / Personal fork

**IT —** Questo repository è un fork di [elie222/rakazo](https://github.com/elie222/rakazo) (Apache-2.0, attribuzione e `LICENSE` originali invariati) con le modifiche che uso sulla mia istanza self-hosted e sulla mia app Android personale. Nessun segreto è incluso: niente `.env`, chiavi, token o keystore — fornisci i tuoi.

**EN —** This repository is a fork of [elie222/rakazo](https://github.com/elie222/rakazo) (Apache-2.0; upstream attribution and `LICENSE` unchanged) carrying the changes I run on my self-hosted instance and my personal Android app. No secrets are included: no `.env`, keys, tokens or keystores — bring your own.

### Branch / Branches

| Branch | Base | IT | EN |
|---|---|---|---|
| `main` | upstream `main` | Copia di upstream senza modifiche. | Untouched mirror of upstream. |
| [`selfhost-v2`](https://github.com/Njcki/rakazo/tree/selfhost-v2) | upstream `0723154` | Patch web/server per il self-host (20 commit, uno per patch) + `patches-v2/` per l'immagine Docker. | Web/server self-host patches (20 commits, one per patch) + `patches-v2/` to build the Docker image. |
| [`android-app`](https://github.com/Njcki/rakazo/tree/android-app) | upstream `main` | App Android personale in `apps/mobile` (package `com.rakazo.fork`). | Personal Android app in `apps/mobile` (package `com.rakazo.fork`). |

L'app Android vive nello stesso monorepo, non in un repo separato. / *The Android app lives in the same monorepo, not in a separate repo.*

### Modifiche in questo branch (`android-app`) / Changes in this branch

| Versione | IT | EN |
|---|---|---|
| vc7 | **Build personale** `com.rakazo.fork` (convive con l'app ufficiale); **interfaccia in italiano**; allegati: tocco = **Apri** nel visualizzatore, **Condividi** azione separata; menu messaggi unico; link cliccabili; riparazione tabelle markdown. | **Personal build** `com.rakazo.fork` (installs next to the official app); **Italian UI**; attachments: tap = **Open** in a viewer, **Share** is a separate action; single message menu; tappable links; markdown table repair. |
| vc8 | Sezione **Piano** nativa nelle impostazioni chat (✅ ⏳ ⭕, badge completato, aggiornamento ogni 4 s); icone sulle sezioni; **Salva** sempre visibile; +95 stringhe IT. | Native **Plan** section in chat settings (✅ ⏳ ⭕, completed badge, 4 s polling); section icons; always-visible **Save**; +95 IT strings. |
| vc9 | Menu ⋮ del bot moderno (bottom sheet, icone, righe distruttive in rosso); Piano sotto Descrizione; **riordino bot** (pressione lunga → Sposta su/giù, salvato sul server); suggerimenti con pressione lunga nell'intestazione. | Modern bot ⋮ menu (bottom sheet, icons, red destructive rows); Plan under Description; **bot reordering** (long-press → move up/down, saved on the server); long-press header hints. |
| vc10 | **Menu modelli per provider** (sottomenu provider → modelli); **icone del Piano uguali al web**; temi **Sistema / Chiaro / Scuro / Nero** (Nero OLED). | **Provider-grouped model menus**; **Plan icons matching the web**; **System / Light / Dark / Black** themes (Black = OLED). |
| vc11 | Tema Scuro più leggibile (meno nero); selettore Aspetto 2×2 con anteprime. | More readable, lighter Dark theme; 2×2 Appearance picker with previews. |
| vc12–13 | Parametri bot più leggeri: modelli caricati solo all'apertura di Avanzate e solo per i provider collegati; liste lunghe in un foglio che non finisce sotto la status bar. | Lighter bot settings: models loaded only when Advanced opens and only for connected providers; long lists in a sheet that stays below the status bar. |
| vc14 | **Grafici nella chat**: i messaggi `[chart: …]` (render_plot) ora mostrano il grafico vero, come sul web (Observable Plot in una WebView offline); tocco = schermo intero. | **Charts in chat**: `[chart: …]` messages (render_plot) now draw the real chart like the web (Observable Plot in an offline WebView); tap = full screen. |
| vc15 | **Grafici interattivi**: tocco su una barra/punto mostra l'etichetta con i dati come sul web; pulsante espandi per lo schermo intero; tema scuro. | **Interactive charts**: tap a bar/point to show a data label like the web; expand button for full screen; dark theme. |
| vc16 | **Formule matematiche**: Formule TeX: `$…$` in linea diventa testo leggibile (`$1018.86\text{hPa}$` → «1018.86 hPa», `x^2` → «x²»); `$$…$$` / `\[…\]` su riga propria disegnate con KaTeX in una WebView offline (CSS e font inclusi, nessuna rete), ridotte se troppo larghe. Prezzi come «$5 o $10» restano testo (regole Pandoc); il codice non viene toccato; copia/selezione danno testo leggibile. | **Math formulas**: TeX math: inline `$…$` reads as Unicode text; display `$$…$$` / `\[…\]` typeset by KaTeX in an offline WebView (CSS and fonts inlined), scaled down when too wide. Prices like "$5 or $10" stay text (Pandoc rules); code untouched; copy/select gives readable text. |
| vc16 | Allegati .apk: «Installa pacchetti» non faceva nulla. Ora l'intent porta il MIME `application/vnd.android.package-archive` (prima `*/*` per gli allegati octet-stream) e l'app dichiara `REQUEST_INSTALL_PACKAGES`: Android chiede una volta di consentire le installazioni da Rakazo e poi apre l'installer. | .apk attachments: "Install packages" did nothing. The intent now carries `application/vnd.android.package-archive` (was `*/*` for octet-stream attachments) and the app declares `REQUEST_INSTALL_PACKAGES`, so Android asks once to allow installs from Rakazo and opens the installer. |
| vc17 | **Chat in fondo**: Chat in fondo: se sei in fondo (entro 100 px) il nuovo messaggio, l'indicatore «sta lavorando» e le bolle di invio fallito restano visibili invece di finire appena sotto lo schermo. Causa: la lista invertita usava `maintainVisibleContentPosition` senza `autoscrollToTopThreshold`, quindi Android teneva ferma l'ultima riga e spingeva il contenuto nuovo fuori vista; il JS seguiva solo un nuovo id messaggio. Ora `autoscrollToTopThreshold: 100` riporta in fondo a livello nativo; streaming e immagini/grafici/formule tardivi restano ancorati; se sei salito a leggere la vista non si sposta e resta il pulsante «Vai all'ultimo, nuovi messaggi». | **Stick to bottom**: Stick to bottom: within 100 px of the bottom, a new message, the working indicator and failed-send bubbles stay in view instead of landing just below the screen. Root cause: the inverted list used `maintainVisibleContentPosition` without `autoscrollToTopThreshold`, so Android kept the newest row fixed and pushed new content out of view, and JS only followed a new message id. `autoscrollToTopThreshold: 100` now re-pins natively; streaming and late images/charts/math stay anchored; a reader who scrolled up is not moved and keeps the "Jump to latest, new messages" button. |
| vc18 | **Messaggio doppio**: Messaggio doppio all'invio: il proprio messaggio compariva due volte per un istante (bolla locale «Invio…» + copia del server). Causa: `confirmEchoes` toglieva la bolla solo in un `useEffect`, un frame dopo che la copia del server era già disegnata; e se il feed live portava la copia prima della risposta di `threads/send` la bolla restava fino alla risposta. Ora `withoutEchoedSends` (`lib/thread-feedback.ts`) filtra le bolle già nel render: nascosta se il suo `seq` è nel thread, oppure (ancora senza seq) se arriva un messaggio utente con lo stesso testo e seq più alto di quello visibile all'invio. Le bolle di invio fallito restano. | **Double message**: Double message on send: your own message briefly showed twice (local "Sending…" bubble + server copy). Root cause: `confirmEchoes` removed the bubble only in a `useEffect`, one frame after the server copy was drawn; and when the live feed delivered the copy before `threads/send` returned, the bubble lingered until the response. `withoutEchoedSends` (`lib/thread-feedback.ts`) now filters bubbles during render: hidden once its `seq` is in the thread or, before a seq is known, when a user message with the same text and a seq above the one on screen at send time arrives. Failed-send bubbles stay. |
| vc19 | **Messaggio doppio (fix completo)**: Messaggio doppio, fix completo: in 1.0.18 restava un lampo. Causa reale: la bolla locale «Invio…» stava nell'intestazione della FlatList mentre la copia del server entrava come riga dei dati (due liste, due componenti), e la copia arrivata dal feed live (`thread.message.created`) non ha `seq`, quindi non combaciava con il seq della risposta di `threads/send` e restava doppia fino al refresh; in più la radice di `MessageRow` aveva `key={message.id}`. Ora un invio di testo in corso è una riga della stessa lista (`lib/outgoing-reconcile.ts`, `reconcileOutgoing`) con chiave `local:<nonce>`; quando arriva la copia del server (per seq, per `runId` della risposta se è la copia live senza seq, o prima della risposta per testo tra i messaggi nuovi) la riga provvisoria sparisce nello stesso render e la copia eredita la stessa chiave: stessa bolla, stessa posizione e altezza, sparisce solo l'etichetta «Invio…» (posizionata in assoluto, non occupa spazio). Gli invii falliti, offline o con allegati mantengono la bolla con «Riprova». | **Double message (complete fix)**: Double message, complete fix: 1.0.18 still flashed. Actual cause: the local "Sending…" bubble lived in the FlatList header while the server copy arrived as a data row (two lists, two components), and the live-feed copy (`thread.message.created`) carries no `seq`, so it never matched the seq returned by `threads/send` and stayed doubled until a refresh; also `MessageRow`'s root had `key={message.id}`. A text send in flight is now a row of the same list (`lib/outgoing-reconcile.ts`, `reconcileOutgoing`) keyed `local:<nonce>`; when the server copy arrives (by seq, by the send's `runId` for a seq-less live copy, or before the response by text among new user messages) the stand-in is dropped in the same render and the copy inherits its key: same bubble, position and height, only the absolutely positioned "Sending…" label goes away. Failed, offline and attachment sends keep the retry bubble. |
| vc20 | **Tabelle larghe**: Tabelle larghe: le tabelle più larghe della bolla ora scorrono in orizzontale. Causa: le colonne fuori vista erano ridotte a una riga tagliata finché uno stato legato allo scroll non le espandeva, così ogni swipe ri-impaginava la tabella (e la lista invertita intorno) a metà gesto; su Android non c'era nessun indicatore di scorrimento e le larghezze ignoravano formule in linea e caratteri larghi. Ora ogni colonna ha sempre la sua altezza piena, la ScrollView orizzontale (`nestedScrollEnabled`, `directionalLockEnabled`) è attiva solo se la tabella sborda, con barra di scorrimento persistente e bordo sfumato; nessun ricalcolo durante lo scroll. Le tabelle strette restano uguali; scroll verticale della chat e pressione lunga invariati. | **Wide tables**: Wide tables: tables wider than the bubble now scroll horizontally. Root cause: off-screen columns were collapsed to a clipped single line until scroll-driven state expanded them, so every swipe re-laid out the table (and the inverted list around it) mid-gesture; Android showed no scroll affordance, and width estimates ignored inline math and wide glyphs. Every column now keeps its full height, the horizontal ScrollView (`nestedScrollEnabled`, `directionalLockEnabled`) is enabled only when the table overflows, with a persistent scrollbar and fading edge; no re-layout while scrolling. Narrow tables are unchanged; chat vertical scrolling and long-press still work. |
| vc20 | **Eco in chiamata**: Chiamata in vivavoce: la voce del bot usciva dall'altoparlante, rientrava nel microfono e veniva trascritta come richiesta dell'utente. Causa: il riconoscimento registrava con la sorgente `VOICE_RECOGNITION` in modalità audio normale, senza cancellazione dell'eco, e il filtro testuale ignorava i testi oltre 12 parole e contava la finestra di 15 s dall'inizio della risposta. Ora durante la chiamata il dispositivo è in modalità comunicazione (`MODE_IN_COMMUNICATION`, modulo locale `rakazo-call-audio`, audio sull'altoparlante o sulle cuffie collegate, ripristinata se un player cambia la modalità) e il microfono registra con `VOICE_COMMUNICATION` + `AcousticEchoCanceler`/`NoiseSuppressor` (patch pnpm di expo-speech-recognition): l'eco viene cancellato in hardware e si può ancora interrompere il bot parlando. Rete di sicurezza: si scartano anche le trascrizioni lunghe quasi identiche alla risposta (≥85% in ordine) e la finestra parte dalla fine della riproduzione. Il microfono non viene silenziato durante la risposta. | **Call echo**: Speakerphone call: the bot's own voice from the speaker leaked into the mic and was transcribed as the user's request. Root cause: recognition recorded from `VOICE_RECOGNITION` in normal audio mode with no echo cancellation, and the text filter ignored transcripts over 12 words and timed its 15 s window from the start of the reply. During a call the device is now in communication mode (`MODE_IN_COMMUNICATION`, local module `rakazo-call-audio`, routed to the loudspeaker or a connected headset, re-applied if a player resets the mode) and the mic records from `VOICE_COMMUNICATION` with `AcousticEchoCanceler`/`NoiseSuppressor` (pnpm patch of expo-speech-recognition): the echo is cancelled in hardware and you can still interrupt the bot by speaking. Safety net: long transcripts that are nearly the reply (≥85% in order) are also dropped, and the window starts when playback ends. The mic is not muted while the bot speaks. |
| vc21 | **Tabelle larghe (swipe)**: Tabelle larghe, swipe col dito: in 1.0.20 la tabella non scorreva col dito e la sfumatura restava anche a fine scorrimento. Causa: la tabella non è dentro un Text (verificato), ma su Android la lista verticale della chat viene interpellata per prima e si prende il tocco appena il dito si sposta di pochi pixel in verticale; uno swipe veloce non è mai perfettamente orizzontale e con campioni di tocco radi entrambe le soglie scattano nello stesso evento, quindi vinceva la lista. La sfumatura: la ScrollView orizzontale di React Native su Android restituisce sempre intensità piena per i bordi, a prescindere dalla posizione. Ora la tabella è avvolta da una vista nativa (`rakazo-scroll-guard`) che all'inizio del tocco chiede agli antenati di non intercettare e, appena il gesto ha una direzione, restituisce i gesti verticali alla lista e tiene quelli orizzontali per la tabella; una pressione lunga resta al fumetto. Le sfumature sinistra/destra si accendono solo se c'è contenuto oltre quel bordo (offset da `onScroll`, `scrollEventThrottle` 16, larghezza da `onContentSizeChange`), senza ri-impaginare la tabella. | **Wide tables (swipe)**: Wide tables, finger swipe: in 1.0.20 the table would not scroll under the finger and the fade stayed at the scroll end. Root cause: the table is not inside a Text (checked), but on Android the chat's vertical list is asked first and takes the touch as soon as the finger drifts a few pixels vertically; a quick swipe is never perfectly horizontal, and with coarse touch samples both thresholds trip on the same event, so the list won. The fade: React Native's Android horizontal ScrollView always reports full edge strength, whatever the position. The table is now wrapped in a native view (`rakazo-scroll-guard`) that asks its ancestors not to intercept when a touch starts and, once the gesture has a direction, hands vertical ones back to the list and keeps horizontal ones for the table; long-press still reaches the bubble. Left/right fades only show when there is content beyond that edge (offset from `onScroll`, `scrollEventThrottle` 16, width from `onContentSizeChange`), with no table re-layout. |
| vc26 | **Narrazione mid-turn**: Bolla «In corso…»: le frasi non si spezzano più a metà tra i chip degli strumenti (`cat`+chip+`egoria` → `categoria`) e le frasi consecutive non restano attaccate senza spazio (`pulita.Sto` → `pulita. Sto`). Portati in `packages/core` i fix di `reduceLiveMessageBlocks` / `ensureSentenceSpacing` (patch 0050 e prerequisiti). | **Mid-turn narration**: "In progress…" bubble: sentences no longer split mid-word across tool chips (`cat`+chip+`egoria` → `categoria`) and consecutive sentences are no longer glued without a space (`pulita.Sto` → `pulita. Sto`). Ported `reduceLiveMessageBlocks` / `ensureSentenceSpacing` fixes into `packages/core` (patch 0050 and prerequisites). |
| vc26 | **Codice in tema scuro**: Nei blocchi di codice (fence) il testo era quasi nero su sfondo scuro e illeggibile (artefatti e chat). Causa: i token «plain» di Prism non portano un colore e Android usa il nero di default. Ora `fence_token` usa `palette.foreground` (chiaro in Scuro/Nero, scuro in Chiaro). | **Dark-theme code**: Fenced code text was nearly black on a dark background and unreadable (artifacts and chat). Root cause: Prism plain tokens carry no color and Android defaults to black. `fence_token` now uses `palette.foreground` (light in Dark/Black, dark in Light). |
| vc26 | **Installazione**: La 1.0.22 non si installava («Pacchetto non valido») perché sul telefono c'era già la 1.0.25: Android rifiuta il downgrade di `versionCode`. Ripubblicata come 1.0.26. | **Install**: 1.0.22 would not install ("Invalid package") because the phone already had 1.0.25: Android rejects a `versionCode` downgrade. Republished as 1.0.26. |

Storico completo / full history: `apps/mobile/ANDROID-FORK-CHANGELOG.md`.

### Uso / Usage

**Requisiti / Requirements:** Node 22+, pnpm, JDK 17, Android SDK (oppure/or Expo EAS), e un server Rakazo raggiungibile via HTTPS / a Rakazo server reachable over HTTPS.

**IT —** L'URL del server **non** è nel codice: impostalo in fase di build con `EXPO_PUBLIC_API_URL` (es. `https://rakazo.example.com`). Il keystore di firma non è nel repo: generane uno tuo.
**EN —** The server URL is **not** hardcoded: set it at build time with `EXPO_PUBLIC_API_URL`. The signing keystore is not in the repo: generate your own.

```bash
git checkout android-app
pnpm install
cd apps/mobile
export EXPO_PUBLIC_API_URL=https://YOUR-HOST
npx expo prebuild -p android
cd android && ./gradlew assembleDebug        # oppure/or assembleRelease, oppure/or: eas build -p android
# keystore release / release keystore:
keytool -genkeypair -v -keystore my-release.keystore -alias rakazo -keyalg RSA -keysize 2048 -validity 10000
```

Vedi anche / see also [FORK.md](FORK.md).

---

## How Rakazo compares

Once Rakazo is running, it is just chat, like Grok Bot: you set up a bot and manage it from that
chat. Muse, Dots, Instinct, and Hark Pro are hosted assistants. OpenClaw
and Hermes Agent are also open source agents you can run yourself. Their docs describe installers,
config files, and a gateway. Hermes Desktop can reach a first chat without the CLI; a messaging
gateway is a separate process.

- [Grok Bot](https://rakazo.com/grok-bot-alternative/)
- [Muse](https://rakazo.com/muse-alternative/)
- [Dots](https://rakazo.com/dots-alternative/)
- [Instinct](https://rakazo.com/instinct-alternative/), the personal assistant you text or call
- [OpenClaw](https://rakazo.com/openclaw-alternative/)
- [Hermes Agent](https://rakazo.com/hermes-alternative/), Nous Research's open source agent
- [Hark Pro](https://rakazo.com/hark-alternative/), the personal agent at hark.com
- [All comparisons](https://rakazo.com/alternatives/)
- [Self-hosting guide](https://rakazo.com/self-hosted-ai-agent/)

## Features

- Persistent bots with their own conversations, memory, routines, and history
- Voice mode: speak replies, dictate, and call a bot. Bring your own ElevenLabs, OpenAI, Cartesia, or Fish Audio key
- Shared Team Computers and isolated Private computers
- Browser, terminal, file, and graphical desktop access
- Bots that can delegate to peer bots or short-lived subagents
- Bring-your-own model credentials through Pi
- App integrations through Composio or Pipedream Connect, plus user-installed Treg, remote MCP, and OpenAPI tool sources
- Docker, E2B, Daytona, CreateOS, Box, and trusted local-computer support

## Demo

https://github.com/user-attachments/assets/dccdeddb-2134-4a56-8eed-b2e591736b1c

## Stack

- TypeScript
- React 19, Vite, and Tailwind CSS
- Electron and Expo
- Hono and oRPC
- PostgreSQL and Prisma
- Better Auth
- Graphile Worker
- Pi
- Docker, E2B, Daytona, CreateOS, and Box
- Composio, Pipedream Connect, MCP, and OpenAPI integrations

## Quick start (published images)

You need Docker Engine, the Compose plugin, curl, and OpenSSL. No clone or Node install.

```bash
mkdir -p rakazo && cd rakazo &&
curl -fsSLO https://raw.githubusercontent.com/elie222/rakazo/main/infra/compose/install-images.sh &&
bash install-images.sh
```

The installer downloads the Compose files, creates `.env` with random secrets, and starts Rakazo.
It preserves an existing `.env` when rerun.

Open [http://127.0.0.1:5173](http://127.0.0.1:5173), create an account, and connect a model.
Local Docker computers are on by default. Optional remote providers: `e2b`, `daytona`, `createos`, `box`, or `railway`
with the matching API key.

Default image tag is `edge` (main builds, `linux/amd64` + `linux/arm64`). Details and tags:
[self-hosting guide](./docs/self-host.md#published-images-no-checkout).

On restricted networks, override the installer download base (`RAKAZO_DOWNLOAD_BASE`), skip
existing Compose files (`--local` / `RAKAZO_DOWNLOAD_SKIP_EXISTING`), or mirror the bootstrap
script URL — see
[Restricted networks / mirror downloads](./docs/self-host.md#restricted-networks--mirror-downloads).

For an agent-assisted install, use [SETUP_PROMPT.md](./SETUP_PROMPT.md).

## Run on a server

Bots stay on when the backend runs on a server. Use the same installer on a VPS, then connect from
the desktop app, the mobile app, or a browser.

```bash
bash install-images.sh --prepare-only
# edit .env: SANDBOX_PROVIDER=box (or e2b / daytona / createos) with its API key, RAKAZO_HOST=your.domain
bash install-images.sh
```

Put HTTPS in front of port 5173; [docs/self-host.md](./docs/self-host.md#public-single-vm-deployment)
covers the Caddy setup and host hardening. In the desktop app choose **Existing instance** and enter
the `https://` address.

## Local development (source checkout)

You need Node.js 22.22.2 or newer in the 22.x line, Node.js 24.x, or Node.js 26+;
pnpm 9; and Docker. Node.js 23.x and 25.x are not supported.

```bash
git clone https://github.com/elie222/rakazo.git
cd rakazo
cp .env.example .env
```

Set `POSTGRES_PASSWORD` (for example `openssl rand -hex 16`), then put the same value in
`DATABASE_URL`. Set `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`, and `SCREEN_PROXY_SECRET` to
independent long random values. Docker sandboxes also need a dedicated
`SANDBOX_SUPERVISOR_TOKEN`. You can also set `OPENROUTER_API_KEY`, or connect a supported
model provider during onboarding.

For host-side development with Docker Desktop, set `SANDBOX_CONTROL_VIA_LOOPBACK=true`
in `.env`. The supervisor discovers Docker Desktop's user socket automatically;
`DOCKER_HOST` or `DOCKER_SOCKET` can override it for another Docker runtime.

Managed app catalogs are optional. Set `COMPOSIO_API_KEY` for Composio, or the
`PIPEDREAM_CLIENT_ID`, `PIPEDREAM_CLIENT_SECRET`, and `PIPEDREAM_PROJECT_ID` trio for Pipedream
Connect. Users can add an HTTPS MCP server, Treg endpoint, or OpenAPI JSON document from
**Integrations** without enabling either managed catalog. Connector credentials are encrypted on the
server and are never returned by the API.

Treg is usage-metered. Self-hosters supply their own Treg token; operators embedding Treg in a
hosted product should review [Treg's integration terms](https://treg.to/integrate.md), which require
a written agreement for hosted resale.

```bash
docker compose --env-file .env \
  -f infra/compose/docker-compose.yml \
  -f infra/compose/docker-compose.postgres-host.yml \
  up postgres -d
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm sandbox:build
pnpm dev
```

Postgres stays network-internal in the default Compose file (same as published images). The
`postgres-host` overlay publishes loopback `127.0.0.1:5433` for host-side `pnpm` and DB tools.
If that port is occupied, change `POSTGRES_HOST_PORT` and the port in `DATABASE_URL` in `.env`.
Without the overlay, open a shell with
`docker compose --env-file .env -f infra/compose/docker-compose.yml exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'`.
Use a URI-safe `POSTGRES_PASSWORD` (`openssl rand -hex 16`). An existing `pgdata` volume keeps the
user, password, and database from first init, so keep those values in `.env`, or change them in
place with `ALTER ROLE` / rename. Recreate the volume only after a backup (or when the data is
disposable); `docker compose down -v` deletes all Postgres state.

Open [http://127.0.0.1:5173](http://127.0.0.1:5173), create an account, connect a model, and create
your first bot.

For deployment, provider selection, backups, and upgrades, see the
[self-hosting guide](./docs/self-host.md).

To use CreateOS, set `SANDBOX_PROVIDER=createos` and `CREATEOS_SANDBOX_API_KEY`.
Optional `CREATEOS_SANDBOX_BASE_URL`, `CREATEOS_SANDBOX_SHAPE`, and
`CREATEOS_SANDBOX_ROOTFS` default to `https://api.sb.createos.sh`, `s-2vcpu-2gb`,
and `desktop:1`.

To use Railway computers, set `SANDBOX_PROVIDER=railway`, `RAILWAY_API_TOKEN`
and `RAILWAY_ENVIRONMENT_ID` on the API and worker. Choose the sandbox environment
explicitly; Railway's automatic environment ID identifies the hosted app's environment.
Use the narrowest Railway API token that works: prefer a project token if sufficient
for sandbox operations and supported by the client's authentication. This provider
currently uses bearer authentication, so use a team/workspace token rather than a
personal account token.
The live screen and desktop require `PRIVATE` networking so Railway's public domain
can serve the screen. Computers use this mode and can reach other services in the
same Railway project/environment, as well as the public internet. We recommend a
dedicated Railway project (or at least a separate environment) for sandboxes,
separate from the app and database. Recreate existing `ISOLATED` computers before use.
The desktop is installed on first start. Stopping a computer saves its portable
home and destroys the sandbox; the next start restores that home in a new sandbox.
Railway sandbox usage is metered.
Workspace exports reject files above 64 MiB without truncating them. Set `RAILWAY_MAX_WORKSPACE_FILE_BYTES` to change this limit.

## Desktop and mobile

The Electron and Expo apps are clients of the same Rakazo API used by the web app.

With the development stack running, launch Electron with:

```bash
pnpm --filter @rakazo/desktop dev
```

On first run the desktop app asks whether to run Rakazo on this computer or connect to an existing
server. **This computer** installs and starts the published images with Docker Compose (the same
files as `infra/compose/install-images.sh`) under the app's data directory, so Docker Desktop,
OrbStack, or Docker Engine must be installed; the app links to them when it is not. Installed
builds pin the image tag to their own version; unpackaged builds pull `edge`. Developers running
`pnpm dev` should pick **Existing instance** with `http://127.0.0.1:5173` instead. Public servers
must use HTTPS; HTTP is accepted only for loopback and private LAN addresses (not link-local). The
app verifies Rakazo's health endpoint before saving, and later launches go straight to that
instance. The stack keeps running after the app quits; **Stop Local Stack** in the application
menu turns it off.

Use **Change Rakazo Server…** in the application menu to reconnect. Closing that window without
saving returns to the previous instance. For development automation, set `RAKAZO_WEB_URL` to point
the shell somewhere else without changing the saved instance, or `RAKAZO_FORCE_SETUP=1` to run
setup again.

Mobile build and release instructions live in [docs/mobile-release.md](./docs/mobile-release.md).

## UI language

The web (and Electron-hosted) UI supports English, Deutsch, 한국어, Türkçe, हिन्दी,
Português (Brasil), 简体中文, Español, and Русский under **Settings → Language**. The Expo
app ships English, 简体中文, Русский, and Deutsch catalogs; **Account → Language** offers
English and 简体中文, and the other catalogs follow the device language or
`EXPO_PUBLIC_DEFAULT_UI_LOCALE`. The marketing
homepage (`apps/www`) is available in en/de/ko/zh via footer language links (`/`, `/de/`,
`/ko/`, `/zh/`); other marketing pages stay English. The Russian marketing homepage and
native Electron setup/menu remain separate follow-up work.

## Development

```text
apps/       web, api, worker, desktop, mobile, and public website
packages/   domain, contracts, persistence, adapters, UI, and test tooling
infra/      local services and computer images
docs/       architecture, operations, and release guides
```

Common checks:

```bash
pnpm lint
pnpm check
pnpm test
pnpm test:integration
pnpm test:e2e
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the development workflow and test matrix.

## Documentation

- [Self-hosting](./docs/self-host.md)
- [Self-host secrets](./docs/self-host-secrets.md)
- [Computer runtime and isolation](./docs/computer-runtime.md)
- [Desktop releases](./docs/desktop-release.md)
- [Mobile releases](./docs/mobile-release.md)
- [Performance testing](./docs/performance.md)

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull
request. For security vulnerabilities, follow [SECURITY.md](./SECURITY.md) instead of filing a public
issue.

Rakazo is licensed under the [Apache License 2.0](./LICENSE).

Questions and ideas are welcome in the [Rakazo Discord community](https://discord.gg/RWwKa2Sn7h).
