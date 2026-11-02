# Android fork changelog

Neutral notes for the public `android-app-onto-rebase` branch (package `com.rakazo.fork`). Personal install package and VPS hostnames stay out of this file.

## 1.0.30 (vc30) — 2026-11-02

- A render error in a chat no longer replaces the whole app with a full-screen "Try again": the chat has its own error boundary that remounts it right away and then with backoff (0.4 s → 10 s), keeps the conversation (it lives outside the tree), and shows only a small inline note. The manual retry appears only after 3 failures in a minute.
- The app-wide boundary also retries on its own before showing the retry screen.
- Render failures are kept on the device (last 10, stack + component stack); "Copy details" copies them for a bug report, because a release build without a crash-reporting DSN otherwise loses them.
- Automatic-continuation status line from the server meta block (`continuation {state,index,max,percent}`), with the same wording as the web and a "Stop" button on the latest scheduled continuation.
- Italian strings for all of the above.

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
