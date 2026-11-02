import { beforeEach, describe, expect, it } from "vitest";
import {
  noteRenderFailure,
  recentRenderFailures,
  recordRenderFailure,
  renderFailureReport,
  renderRetryDelay,
  setRenderFailureStorage,
} from "./render-recovery";

describe("render recovery", () => {
  let stored: string | null = null;
  beforeEach(() => {
    stored = null;
    setRenderFailureStorage({ read: () => stored, write: (value) => (stored = value) });
  });

  it("retries at once, then backs off up to a cap", () => {
    expect([1, 2, 3, 4, 5, 6, 9].map(renderRetryDelay)).toEqual([
      0, 400, 1_000, 2_500, 5_000, 10_000, 10_000,
    ]);
  });

  it("counts only the failures of the last minute", () => {
    expect(noteRenderFailure([0, 30_000], 70_000)).toEqual([30_000, 70_000]);
  });

  it("keeps the last failures on the device for a report", () => {
    for (let i = 0; i < 12; i += 1)
      recordRenderFailure("thread", new TypeError(`bad ${i}`), "\n    in MessageRow", new Date(0));
    expect(recentRenderFailures()).toHaveLength(10);
    expect(JSON.parse(stored ?? "[]")).toHaveLength(10);
    setRenderFailureStorage({ read: () => stored, write: (value) => (stored = value) });
    expect(recentRenderFailures().at(-1)?.message).toBe("TypeError: bad 11");
    expect(renderFailureReport("1.0.30")).toContain("[thread] TypeError: bad 11\nin MessageRow");
  });
});
