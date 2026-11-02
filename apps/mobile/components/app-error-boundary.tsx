import * as Clipboard from "expo-clipboard";
import * as SplashScreen from "expo-splash-screen";
import type { ErrorInfo, ReactNode } from "react";
import { Component, Fragment } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { mobileTokens } from "../lib/appearance";
import { t } from "../lib/i18n";
import { reportMobileError } from "../lib/monitoring";
import {
  noteRenderFailure,
  RENDER_FAILURES_BEFORE_NOTICE,
  recordRenderFailure,
  renderFailureReport,
  renderRetryDelay,
} from "../lib/render-recovery";
import { completeMobileStartup } from "../lib/startup";

type Props = { children: ReactNode };
type State = { failed: boolean; failures: number[]; generation: number };

/**
 * Keep a render failure from becoming a blank release screen. A failure is retried on its own
 * first (at once, then with a growing delay); the "Try again" screen only shows when the app keeps
 * failing, so a one-off error never takes the whole screen.
 */
export class AppErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false, failures: [], generation: 0 };
  private retryTimer: ReturnType<typeof setTimeout> | undefined;

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    recordRenderFailure("app", error, info?.componentStack);
    reportMobileError(error, "react.render");
    void SplashScreen.hideAsync()
      .then(completeMobileStartup)
      .catch(() => undefined);
    const failures = noteRenderFailure(this.state.failures, Date.now());
    this.setState({ failures });
    clearTimeout(this.retryTimer);
    if (failures.length < RENDER_FAILURES_BEFORE_NOTICE)
      this.retryTimer = setTimeout(this.retry, renderRetryDelay(failures.length));
  }

  override componentWillUnmount() {
    clearTimeout(this.retryTimer);
  }

  private retry = () => {
    clearTimeout(this.retryTimer);
    this.setState((state) => ({ failed: false, generation: state.generation + 1 }));
  };

  override render() {
    if (!this.state.failed)
      return <Fragment key={this.state.generation}>{this.props.children}</Fragment>;
    const tokens = mobileTokens();
    if (this.state.failures.length < RENDER_FAILURES_BEFORE_NOTICE)
      return (
        <View style={[styles.screen, { backgroundColor: tokens.background }]}>
          <ActivityIndicator color={tokens.mutedForeground} />
        </View>
      );
    return (
      <View style={[styles.screen, { backgroundColor: tokens.background }]}>
        <Pressable
          accessibilityRole="button"
          onPress={this.retry}
          style={({ pressed }) => [
            styles.action,
            { backgroundColor: tokens.primary, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={[styles.actionText, { color: tokens.primaryForeground }]}>
            {t("Try again")}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            void Clipboard.setStringAsync(renderFailureReport()).catch(() => undefined)
          }
          hitSlop={8}
        >
          <Text style={[styles.detailText, { color: tokens.mutedForeground }]}>
            {t("Copy details")}
          </Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center", gap: 18, padding: 28 },
  action: { borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12 },
  actionText: { fontSize: 15, fontWeight: "600" },
  detailText: { fontSize: 13 },
});
