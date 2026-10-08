import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { actionFills, iosAtLeast } from "./native-controls";

const platform = vi.hoisted(() => ({
  OS: "ios",
  Version: 26 as number | string,
}));

vi.mock("react-native", () => ({
  Platform: platform,
}));

const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function source(path: string) {
  return readFileSync(resolve(mobileRoot, path), "utf8");
}

describe("native iOS controls", () => {
  it("uses system header items for sheet Cancel on iOS 26 and a plain fallback otherwise", () => {
    const header = source("components/sheet-header.tsx");
    expect(header).toContain("iosAtLeast(26)");
    expect(header).toContain("unstable_headerLeftItems");
    expect(header).toContain('variant: "plain"');
    expect(header).toContain("unstable_headerRightItems");
    expect(header).toContain('variant: "done"');
    for (const screen of [
      "app/new.tsx",
      "app/new-space.tsx",
      "app/change-password.tsx",
      "app/server.tsx",
    ]) {
      const file = source(screen);
      expect(file).toContain("cancelHeaderOptions");
      expect(file).not.toMatch(/headerLeft:\s*\(\)\s*=>/);
    }
  });

  it("preserves plain actions and scopes small muted borderless styling to quiet actions", () => {
    const ios = source("components/native-action-button.ios.tsx");
    expect(ios).toContain('if (prominence === "plain") return glass ? "glass" : "plain";');
    expect(ios).toContain('if (prominence === "quiet") return "plain";');
    expect(ios).toContain(
      'controlSize(stretches ? "large" : prominence === "quiet" ? "small" : "regular")',
    );
    expect(ios).toContain(
      '...(prominence === "quiet"\n            ? [font({ size: 15 }), foregroundStyle(tokens.mutedForeground)]',
    );
    const fallback = source("components/native-action-button.tsx");
    expect(fallback).toContain('const compact = prominence === "plain" || prominence === "quiet";');
    expect(fallback).toContain(
      'fontSize: prominence === "quiet" ? 15 : prominence === "plain" ? 17 : 16',
    );
    expect(fallback).toContain(
      'if (prominence === "quiet") {\n    return { background: "transparent" as const, label: tokens.mutedForeground, border: undefined };',
    );
    expect(fallback).toContain(
      'return { background: "transparent" as const, label: native.label, border: undefined };',
    );
  });

  it("places secondary SSO after the password submit and keeps SSO-only primary", () => {
    const auth = source("app/sign-in.tsx");
    expect(auth).toContain('reset?.sso && !reset.passwordAuth && mode !== "forgot"');
    const submit = auth.indexOf("onPress={() => void submit()}");
    const secondary = auth.indexOf('prominence="quiet"', submit);
    expect(secondary).toBeGreaterThan(submit);
    expect(secondary).toBeLessThan(auth.indexOf('t("Don’t have an account?")'));
    expect(auth.slice(submit, secondary)).toContain('reset.sso && mode !== "forgot"');
  });

  it("keeps Android segmented pills and uses a SwiftUI picker on iOS", () => {
    expect(source("components/native-segmented-control.tsx")).toContain("SegmentedPills");
    expect(source("components/native-segmented-control.ios.tsx")).toContain(
      'pickerStyle("segmented")',
    );
    expect(source("components/computer-mode-picker.tsx")).toContain("NativeSegmentedControl");
    expect(source("components/computer-mode-picker.tsx")).toContain('t("Team")');
    expect(source("components/computer-mode-picker.tsx")).toContain('t("Private")');
  });
});

describe("iosAtLeast", () => {
  it("stays false off iOS, including Android version numbers and strings", () => {
    platform.OS = "android";
    platform.Version = 36;
    expect(iosAtLeast(26)).toBe(false);
    platform.Version = "36.0";
    expect(iosAtLeast(18)).toBe(false);
  });

  it("compares the iOS major version from a number or a string", () => {
    platform.OS = "ios";
    platform.Version = 18;
    expect(iosAtLeast(26)).toBe(false);
    expect(iosAtLeast(18)).toBe(true);
    platform.Version = 26;
    expect(iosAtLeast(26)).toBe(true);
    platform.Version = "18.2";
    expect(iosAtLeast(26)).toBe(false);
    expect(iosAtLeast(18)).toBe(true);
    platform.Version = "26.1";
    expect(iosAtLeast(26)).toBe(true);
  });
});

describe("actionFills", () => {
  it("fills primary and destructive buttons unless fill is set", () => {
    expect(actionFills("primary", undefined)).toBe(true);
    expect(actionFills("destructive", undefined)).toBe(true);
    expect(actionFills("secondary", undefined)).toBe(false);
    expect(actionFills("plain", undefined)).toBe(false);
    expect(actionFills("quiet", undefined)).toBe(false);
    expect(actionFills("primary", false)).toBe(false);
    expect(actionFills("secondary", true)).toBe(true);
  });
});
