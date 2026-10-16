# Personal Android build (com.rakazo.fork) — custom mods

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
