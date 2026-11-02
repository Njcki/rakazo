import * as Clipboard from "expo-clipboard";
import type { ErrorInfo, ReactNode } from "react";
import { Component, Fragment } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { mobileTokens } from "../../lib/appearance";
import { t } from "../../lib/i18n";
import { reportMobileError } from "../../lib/monitoring";
import {
  noteRenderFailure,
  RENDER_FAILURES_BEFORE_NOTICE,
  recordRenderFailure,
  renderFailureReport,
  renderRetryDelay,
} from "../../lib/render-recovery";

type Props = { children: ReactNode; scope?: string };
type State = {
  failed: boolean;
  /** Bumped on every retry so the chat mounts fresh. */
  generation: number;
  failures: number[];
  /** A small note after a recovery; never a full-screen error. */
  notice: "recovered" | "failing" | null;
};

/** How long the "reloaded" note stays after a quiet recovery. */
const RECOVERED_NOTICE_MS = 4_000;

/**
 * Keeps a render failure inside the chat from replacing the whole app with a "Try again" screen.
 * The chat remounts by itself (at once, then with a growing delay if it keeps failing); its data
 * lives outside this tree (snapshot cache, pending sends), so it comes straight back.
 */
export class ThreadErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false, generation: 0, failures: [], notice: null };
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    const scope = this.props.scope ?? "thread";
    recordRenderFailure(scope, error, info?.componentStack);
    reportMobileError(error, "react.render", { boundary: scope });
    const failures = noteRenderFailure(this.state.failures, Date.now());
    const failing = failures.length >= RENDER_FAILURES_BEFORE_NOTICE;
    this.setState({ failures, notice: failing ? "failing" : "recovered" });
    this.scheduleRetry(renderRetryDelay(failures.length));
  }

  override componentWillUnmount() {
    clearTimeout(this.retryTimer);
    clearTimeout(this.noticeTimer);
  }

  private scheduleRetry(delay: number) {
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.retry(), delay);
  }

  private retry = () => {
    clearTimeout(this.retryTimer);
    this.setState((state) => ({ failed: false, generation: state.generation + 1 }));
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => {
      this.setState((state) => (state.failed ? null : { notice: null }));
    }, RECOVERED_NOTICE_MS);
  };

  private copyDetails = () => {
    // Copying is a convenience; the failure is still recorded on the device.
    void Clipboard.setStringAsync(renderFailureReport()).catch(() => undefined);
  };

  private dismiss = () => {
    clearTimeout(this.noticeTimer);
    this.setState({ notice: null });
  };

  override render() {
    const tokens = mobileTokens();
    const { failed, generation, notice } = this.state;
    const banner = notice ? (
      <View
        accessibilityLiveRegion="polite"
        testID="thread-recovery-notice"
        style={[styles.notice, { backgroundColor: tokens.card, borderColor: tokens.border }]}
      >
        <Text style={[styles.noticeText, { color: tokens.mutedForeground }]}>
          {failed
            ? t("Reloading the chat…")
            : notice === "failing"
              ? t("The chat keeps hitting an error. Retrying…")
              : t("The chat hit an error and reloaded.")}
        </Text>
        {notice === "failing" ? (
          <Pressable accessibilityRole="button" onPress={this.retry} hitSlop={8}>
            <Text style={[styles.noticeAction, { color: tokens.primary }]}>{t("Try again")}</Text>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" onPress={this.copyDetails} hitSlop={8}>
          <Text style={[styles.noticeAction, { color: tokens.primary }]}>{t("Copy details")}</Text>
        </Pressable>
        {failed ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("Dismiss")}
            onPress={this.dismiss}
            hitSlop={8}
          >
            <Text style={[styles.noticeAction, { color: tokens.mutedForeground }]}>✕</Text>
          </Pressable>
        )}
      </View>
    ) : null;
    return (
      <View style={styles.fill}>
        {failed ? (
          <View style={[styles.fill, styles.center, { backgroundColor: tokens.background }]}>
            <ActivityIndicator color={tokens.mutedForeground} />
          </View>
        ) : (
          <Fragment key={generation}>{this.props.children}</Fragment>
        )}
        {banner}
      </View>
    );
  }
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center" },
  notice: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 96,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  noticeText: { flex: 1, fontSize: 13, lineHeight: 17 },
  noticeAction: { fontSize: 13, fontWeight: "600" },
});
