import { describe, expect, it, vi } from "vitest";
import { continuationLabel, continuationOf } from "./continuation";

vi.mock("./i18n", () => ({
  t: (text: string, values?: Record<string, string | number>) =>
    text.replace(/\{(\w+)\}/g, (_, key: string) => String(values?.[key] ?? `{${key}}`)),
}));

describe("continuation status", () => {
  it("reads the continuation of a meta block and ignores other blocks", () => {
    expect(
      continuationOf({
        kind: "meta",
        text: "Continuing automatically (3/50) · 40%",
        continuation: { state: "scheduled", index: 3, max: 50, percent: 40 },
      } as { kind: string }),
    ).toEqual({ state: "scheduled", index: 3, max: 50, percent: 40 });
    expect(
      continuationOf({ kind: "meta", text: "Plain meta" } as { kind: string }),
    ).toBeUndefined();
    expect(
      continuationOf({ kind: "meta", continuation: { state: "later", index: 1, max: 2 } } as {
        kind: string;
      }),
    ).toBeUndefined();
    expect(continuationOf({ kind: "text" })).toBeUndefined();
  });

  it("words each state like the web app", () => {
    expect(continuationLabel({ state: "scheduled", index: 3, max: 50 })).toBe(
      "Continuing automatically (3/50)",
    );
    expect(continuationLabel({ state: "scheduled", index: 3, max: 50, percent: 40 })).toBe(
      "Continuing automatically (3/50) · 40%",
    );
    expect(continuationLabel({ state: "limit", index: 50, max: 50 })).toBe(
      "Automatic continuation stopped: limit reached (50)",
    );
    expect(continuationLabel({ state: "no_progress", index: 2, max: 50 })).toBe(
      "Automatic continuation stopped: no progress",
    );
    expect(continuationLabel({ state: "superseded", index: 2, max: 50 })).toBe(
      "Automatic continuation skipped: other work is in progress",
    );
  });
});
