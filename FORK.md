# Fork personale / Personal fork

Questo repository è un fork di [elie222/rakazo](https://github.com/elie222/rakazo) (licenza Apache-2.0, attribuzione e `LICENSE` originali invariati) con le personalizzazioni usate per la mia istanza self-hosted.
*This is a fork of elie222/rakazo with the customizations used for my self-hosted instance. Upstream copyright and the Apache-2.0 license are unchanged.*

Nessuna chiave, `.env`, keystore o credenziale è inclusa: devi fornire le tue.
*No keys, `.env` files, keystores or credentials are included: bring your own.*

## Branch

| Branch | Base | Contenuto |
|---|---|---|
| `main` | upstream `main` | Copia di upstream, senza modifiche. |
| `selfhost-v2` | upstream `0723154` | Patch web/self-host (20 commit, uno per patch) + `patches-v2/` per costruire l'immagine Docker. |
| `android-app` | upstream `main` | App Android personale (`apps/mobile`), package `com.rakazo.fork`. |

L'app Android non ha un repository separato: vive nello stesso monorepo, in `apps/mobile`.
*The Android app is not a separate repo: it lives in `apps/mobile` of the same monorepo.*

## Requisiti / Requirements

- Node 22+ e pnpm (`corepack enable`).
- Docker + Docker Compose per il self-host.
- Per l'APK: JDK 17, Android SDK (o un account Expo/EAS).
- Un server Rakazo raggiungibile via HTTPS (es. `https://rakazo.example.com`).

## `selfhost-v2` — web / self-host

Patch principali (dettagli in `patches-v2/CHANGELOG.md`):

| # | Cosa fa |
|---|---|
| 0001 | Alias di modelli locali extra con etichetta/context propri (`/data/local-extra-models.json` o `RAKAZO_LOCAL_EXTRA_MODELS`). |
| 0002, 0010 | Allegati di qualsiasi tipo fino a 100 MiB; l'estensione nota vince su `octet-stream`. |
| 0003 | La lingua della UI viene passata a ElevenLabs (TTS). |
| 0004, 0008, 0009 | Interfaccia web in **italiano** (catalogo completo). |
| 0005 | Timeout fisso di 480 s per la compattazione. |
| 0006 | Path assoluti `/home/rakazo/...` risolti nel workspace del computer. |
| 0007 | Pulsante «Continua». |
| 0011 | Formattazione biome. |
| 0012 | Narrazione a metà turno fino a 8000 caratteri. |
| 0013, 0014, 0017 | **Piano**: scomposizione dei task (strumenti `plan_*`, pannello «Piano», piani completati visibili). |
| 0015, 0016, 0018–0020 | Ritocchi UI impostazioni bot: «Salva» sticky, divisori, card, icone. |

Commit upstream fissato: `0723154f23d6622ef0f4accafdd170e1cda808dd` (vedi `patches-v2/PINS`).

### Uso / Usage

Sviluppo locale:

```bash
git checkout selfhost-v2
pnpm install
pnpm --filter @rakazo/web build   # oppure segui il README upstream per dev/compose
```

Immagine Docker sopra l'immagine upstream fissata (vedi `patches-v2/README.md`):

```bash
cd patches-v2
docker build --build-arg BASE=ghcr.io/elie222/rakazo/app@$(. ./PINS; echo $APP_DIGEST) -t rakazo-app-nk .
```

`patches-v2/update-rakazo-v2.sh` è lo script che uso sul mio server (percorsi da adattare). La migrazione del DB per il Piano viene eseguita dal normale `migrate` di Rakazo. Configura il tuo `.env` come da upstream (`SANDBOX_SUPERVISOR_TOKEN`, ecc.).
`patches-v2/compose/` contiene una patch opzionale per `docker-compose.images.yml` (timeout comandi 20 min, `SANDBOX_IDLE_MS`).

## `android-app` — app Android

Funzioni aggiunte rispetto a upstream:

- Package personale `com.rakazo.fork` (convive con l'app ufficiale).
- Interfaccia in **italiano** (`apps/mobile/lib/locales/it.ts`).
- Sezione **Piano** del bot con icone uguali al web.
- Menu del bot moderno, riordino dei bot, suggerimenti con pressione lunga sull'intestazione.
- Impostazioni con icone e «Salva» sticky.
- Allegati: «Apri» vs «Condividi».
- Selettori del modello raggruppati per provider.
- Temi **Sistema / Chiaro / Scuro / Nero**, tema scuro più leggibile, selettore aspetto 2×2.
- Caricamento modelli selettivo/differito nei parametri bot (filtro `providers` su `models/list`) e selettori lunghi Android nella safe area.
- Grafici `render_plot` nella chat (interattivi) e formule TeX (KaTeX per i blocchi, testo Unicode in linea).
- Allegati `.apk` aperti nell'installer di Android (MIME corretto + `REQUEST_INSTALL_PACKAGES`).
- La chat resta in fondo ai nuovi messaggi (`autoscrollToTopThreshold` sulla lista invertita); chi è salito a leggere non viene spostato.
- Il proprio messaggio non compare più doppio per un istante all'invio (bolla locale nascosta nello stesso render in cui arriva la copia del server).

Storico versioni: `apps/mobile/ANDROID-FORK-CHANGELOG.md`.

### Build

L'URL del server **non** è nel codice: va passato in fase di build.
*The server URL is not hardcoded: pass it at build time.*

```bash
git checkout android-app
pnpm install
cd apps/mobile
export EXPO_PUBLIC_API_URL=https://YOUR-HOST
npx expo prebuild -p android
cd android && ./gradlew assembleRelease     # oppure: eas build -p android
```

Il keystore di firma non è nel repository: generane uno tuo, ad esempio
`keytool -genkeypair -v -keystore my-release.keystore -alias rakazo -keyalg RSA -keysize 2048 -validity 10000`,
e configuralo in Gradle/EAS. Per un APK di debug basta `./gradlew assembleDebug`.
