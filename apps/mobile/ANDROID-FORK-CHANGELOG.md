# Personal Android build (com.rakazo.fork) — custom mods

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
