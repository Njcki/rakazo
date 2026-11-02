// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThreadErrorBoundary } from "../components/thread/thread-error-boundary";
import { recentRenderFailures, setRenderFailureStorage } from "./render-recovery";

const clipboard = vi.hoisted(() => ({ setStringAsync: vi.fn(async (_text: string) => true) }));
vi.mock("expo-clipboard", () => clipboard);
vi.mock("./monitoring", () => ({ reportMobileError: vi.fn() }));
vi.mock("../lib/monitoring", () => ({ reportMobileError: vi.fn() }));
vi.mock("../lib/appearance", () => ({
  mobileTokens: () => ({
    background: "background",
    card: "card",
    border: "border",
    mutedForeground: "muted",
    primary: "primary",
  }),
}));
vi.mock("../lib/i18n", () => ({ t: (text: string) => text }));
vi.mock("react-native", () => ({
  ActivityIndicator: () => <progress />,
  Pressable: (props: {
    children?: ReactNode;
    onPress?: () => void;
    accessibilityLabel?: string;
  }) => (
    <button type="button" aria-label={props.accessibilityLabel} onClick={props.onPress}>
      {props.children}
    </button>
  ),
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  View: ({ children, testID }: { children?: ReactNode; testID?: string }) => (
    <div data-testid={testID}>{children}</div>
  ),
}));

// React renders a failing tree twice before the boundary takes over, so failures are counted
// per boundary attempt: the test flips `failing` off when the chat should come back.
let failing = false;

function Chat() {
  if (failing) throw new Error("live update failed");
  return <div>conversation</div>;
}

describe("ThreadErrorBoundary", () => {
  let root: Root;
  let container: HTMLDivElement;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    failing = false;
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

  function mount() {
    act(() =>
      root.render(
        <ThreadErrorBoundary>
          <Chat />
        </ThreadErrorBoundary>,
      ),
    );
  }

  it("brings the chat straight back after a transient failure, with a small note", () => {
    failing = true;
    mount();
    expect(container.textContent).not.toContain("Try again");
    expect(container.textContent).toContain("Reloading the chat…");
    failing = false;
    act(() => vi.advanceTimersByTime(0));
    expect(container.textContent).toContain("conversation");
    expect(container.textContent).toContain("The chat hit an error and reloaded.");
    expect(recentRenderFailures().at(-1)?.message).toBe("Error: live update failed");

    act(() => vi.advanceTimersByTime(4_000));
    expect(container.querySelector('[data-testid="thread-recovery-notice"]')).toBeNull();
    expect(container.textContent).toBe("conversation");
  });

  it("backs off when the failure repeats and offers a manual retry inline", () => {
    failing = true;
    mount();
    act(() => vi.advanceTimersByTime(0));
    act(() => vi.advanceTimersByTime(399));
    expect(container.textContent).not.toContain("conversation");
    act(() => vi.advanceTimersByTime(1));
    expect(container.textContent).not.toContain("conversation");
    expect(container.textContent).toContain("Reloading the chat…");
    failing = false;
    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Try again",
    );
    expect(retry).toBeDefined();
    act(() => retry?.click());
    expect(container.textContent).toContain("conversation");
    expect(container.textContent).toContain("The chat keeps hitting an error. Retrying…");
  });

  it("copies the recorded failures for a report", () => {
    failing = true;
    mount();
    const copy = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Copy details",
    );
    act(() => copy?.click());
    expect(clipboard.setStringAsync).toHaveBeenCalledWith(
      expect.stringContaining("[thread] Error: live update failed"),
    );
  });
});
