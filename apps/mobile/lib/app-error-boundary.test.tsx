// @vitest-environment jsdom

import * as SplashScreen from "expo-splash-screen";
import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppErrorBoundary } from "../components/app-error-boundary";
import { setRenderFailureStorage } from "./render-recovery";

vi.mock("./monitoring", () => ({ reportMobileError: vi.fn() }));
vi.mock("expo-clipboard", () => ({ setStringAsync: vi.fn().mockResolvedValue(true) }));
vi.mock("expo-splash-screen", () => ({ hideAsync: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/appearance", () => ({
  mobileTokens: () => ({
    background: "background",
    foreground: "foreground",
    primary: "primary",
    primaryForeground: "primary-foreground",
  }),
}));
vi.mock("../lib/i18n", () => ({ t: (text: string) => text }));
vi.mock("react-native", () => ({
  ActivityIndicator: () => <progress />,
  Pressable: (props: { children?: ReactNode; onPress?: () => void }) => (
    <button type="button" onClick={props.onPress}>
      {props.children}
    </button>
  ),
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

let shouldThrow = true;

function Child() {
  if (shouldThrow) throw new Error("render failed");
  return <div>Recovered content</div>;
}

describe("AppErrorBoundary", () => {
  let root: Root;
  let container: HTMLDivElement;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    shouldThrow = true;
    vi.useFakeTimers();
    setRenderFailureStorage(null);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    consoleError.mockRestore();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("retries a one-off failure on its own, without the retry screen", () => {
    act(() =>
      root.render(
        <AppErrorBoundary>
          <Child />
        </AppErrorBoundary>,
      ),
    );
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("progress")).not.toBeNull();
    shouldThrow = false;
    act(() => vi.advanceTimersByTime(0));
    expect(container.textContent).toBe("Recovered content");
  });

  it("shows one retry action only when the failure keeps coming back", () => {
    act(() =>
      root.render(
        <AppErrorBoundary>
          <Child />
        </AppErrorBoundary>,
      ),
    );
    act(() => vi.advanceTimersByTime(0));
    act(() => vi.advanceTimersByTime(400));

    const retry = container.querySelector("button");
    expect(retry?.textContent).toBe("Try again");
    expect(SplashScreen.hideAsync).toHaveBeenCalled();

    shouldThrow = false;
    act(() => retry?.click());

    expect(container.textContent).toBe("Recovered content");
  });
});
