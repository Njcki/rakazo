# Personal Android build (com.rakazo.fork) — custom mods

## Unreleased — 2026-10-16
- Grafici: il tocco sul grafico non faceva nulla (la WebView intercettava i tocchi, l'overlay Pressable non riceveva l'evento). Ora tocco su barra/punto = etichetta con i dati (tip di Observable Plot come sul web, emulato da touch), tocco fuori = chiude; pulsante ⤢ in alto a destra per lo schermo intero (anche lì con etichette); colori dal tema (scuro incluso). / Charts: tap on a mark shows a data tooltip like the web, expand button for full screen, theme-aware colors.
- Chat: i blocchi `chart` (tool render_plot, prima mostrati come testo `[chart: nome.png]`) ora vengono disegnati con lo stesso spec Observable Plot del web, in una WebView senza rete né sessione (bundle Plot incluso nell'app, `lib/plot-bundle.generated.ts`, rigenerabile con `scripts/build-plot-bundle.mjs`). Titolo + legenda, tocco = schermo intero; se il rendering fallisce resta il testo. / Chart blocks now render as live charts (same spec as web, offline WebView), tap for full screen, text fallback on error.
- Parametri bot: niente più `models/list` completo (~1500 voci) all'apertura. Al mount solo `me` + `models/credentials`; il catalogo si carica quando apri Avanzate, filtrato ai soli provider collegati (+ provider del modello attuale e del default), con cache in memoria per la sessione. / Bot settings no longer fetch the full catalog on mount; deferred until Advanced, narrowed to connected providers, session-cached.
- API: `models/list` accetta l'input opzionale `{ providers?: string[] }` (retrocompatibile; senza input = catalogo completo). / Optional backward-compatible provider filter.
- Android: liste lunghe nei selettori (>12 voci) aprono un foglio a schermo intero scorrevole che rispetta status bar e barra di navigazione (safe area), con gruppi provider espandibili; le liste corte restano menu nativi. / Long pickers use a safe-area-aware scrollable sheet instead of the native popup that overflowed under the status bar.

## 1.0.11 (vc11) — 2026-10-16
- Tema Scuro meno scuro: background #181A1E, card/popover/muted #212328, secondary/input #25272D, accent #282A31, border #2C2F36, sidebar #1C1E22. Chiaro e Nero invariati.
- Aspetto: nuovo picker 2×2 con anteprime (swatch sfondo + card + accento), Sistema metà chiaro/metà scuro, selezione con anello ring + spunta. SegmentedPills restano per le altre schermate.

## 1.0.10 (vc10) — 2026-10-16
- Model pickers: provider submenu then models (bot Advanced Model + backup add sheet); no more one endless flat list.
- Piano steps: Ionicons matching web PlanSection (check / radio / outline / lock / minus) with emerald/sky/amber/muted colors — not chat checklist emoji.
- Appearance: Sistema / Chiaro / Scuro / Nero (OLED #000 background, cards #0A0A0A); Sistema still follows phone light/dark. Debug signing unchanged (SHA-1 5E:8F…F6:25).

## 1.0.9 (vc9) — 2026-10-16
- Bot chat ⋮ menu: modern bottom sheet (rounded card, Ionicons, red destructive rows); message menu rows got icons too.
- Piano section moved just under Description.
- Bot reorder: long-press bot → Sposta su / Sposta giù, persisted via bots/reorder (server position).
- Home header long-press toasts (Account, Attività, Cerca, Artefatti).

## 1.0.8 (vc8) — 2026-10-16
- Rebased on upstream origin/main 7d5e64c (159 mobile commits: offline outbox, keyboard fix, Expo SDK 57, (settings) sheet).
- Kept: package/slug/API URL, Italian locale (+95 new upstream strings translated), LAN-only cleartext network_security_config,
  debug signing (SHA-1 5E:8F:…:F6:25), attachment tap = open in viewer (ACTION_VIEW) / Share = separate action,
  single flat Android message action sheet (no "Altro/More" paging) + Share entries in the main sheet,
  markdown table delimiter repair (native + web). Upstream linkifyExplicitUrls replaces our older linkify.
- New: native Piano section in Chat settings (plans/active, ✅ ⏳ ⭕, completed badge, 4s polling);
  icons on settings sections (Name, Title, Description, Color, Read aloud, Plan, Advanced, Model); sticky Save.

## 1.0.7 (vc7) and earlier
- Attachment open-vs-share, Italian i18n, flattened message action sheet, linkify, personal identity.
