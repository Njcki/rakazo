# Android fork changelog

Neutral notes for the public `android-app-onto-rebase` branch (package `com.rakazo.fork`). Personal install package and VPS hostnames stay out of this file.

## 1.0.27 (vc27) — 2026-10-27

Port of local Android custom features onto the rebase tip (`rebase/onto-upstream-main`):

- Italian UI locale (`it`) plus System / Light / Soft Dark / Black appearance picker (Black uses dark native chrome; soft dark palette `#181A1E`).
- Native Plan section in bot settings (icons + sticky save).
- Outgoing reconcile: in-flight text sends are one list row that only drops the “Sending…” label when the server copy arrives; stick-to-bottom threshold 100 px.
- Table swipe guard (`rakazo-scroll-guard`) and conditional edge fades on tip `SidewaysScrollView`.
- Call audio AEC (`rakazo-call-audio` + `expo-speech-recognition` pnpm patch).
- Offline KaTeX math blocks and Plot chart blocks in chat.
- Android APK attachment opens via package-installer intent (`REQUEST_INSTALL_PACKAGES`).

## Earlier

See the previous `android-app` branch history for 1.0.8–1.0.26 notes.
