import { describe, expect, it } from "vitest";
import {
  PLAN_CREATE_REMINDER,
  ProgressCadenceTracker,
  planReminderConfig,
  progressCadenceConfig,
  shouldPromoteNarration,
} from "./progress-cadence.js";

const config = { nudgeTools: 3, nudgeSeconds: 60, maxNudges: 2, narrationMinGapSeconds: 40 };

describe("progressCadenceConfig", () => {
  it("uses defaults and clamps env values", () => {
    expect(progressCadenceConfig({})).toEqual({
      nudgeTools: 8,
      nudgeSeconds: 150,
      maxNudges: 8,
      narrationMinGapSeconds: 40,
    });
    expect(
      progressCadenceConfig({
        PROGRESS_NUDGE_TOOLS: "5",
        PROGRESS_NUDGE_SECONDS: "-1",
        PROGRESS_NUDGE_MAX: "0",
        PROGRESS_NARRATION_MIN_GAP_S: "abc",
      }),
    ).toEqual({ nudgeTools: 5, nudgeSeconds: 150, maxNudges: 0, narrationMinGapSeconds: 40 });
    expect(planReminderConfig({})).toEqual({ every: 4, createAfter: 4 });
    expect(planReminderConfig({ PLAN_REMINDER_EVERY: "0", PLAN_CREATE_NUDGE_TOOLS: "6" })).toEqual({
      every: 0,
      createAfter: 6,
    });
  });
});

describe("ProgressCadenceTracker", () => {
  it("nudges after N silent tool calls and re-arms", () => {
    const tracker = new ProgressCadenceTracker(config, 0);
    tracker.onToolStart("shell", 1);
    tracker.onToolStart("shell", 2);
    expect(tracker.takeNudge(3)).toBeUndefined();
    tracker.onToolStart("shell", 3);
    const nudge = tracker.takeNudge(4);
    expect(nudge).toContain("3 tool calls");
    expect(tracker.pending).toBe(true);
    // Ignored: the next nudge needs a full interval again.
    tracker.onToolTurnEnd();
    expect(tracker.pending).toBe(false);
    tracker.onToolStart("shell", 5);
    expect(tracker.takeNudge(6)).toBeUndefined();
  });

  it("nudges on time only after at least two tools", () => {
    const tracker = new ProgressCadenceTracker(config, 0);
    tracker.onToolStart("shell", 1000);
    expect(tracker.takeNudge(120_000)).toBeUndefined();
    tracker.onToolStart("web_search", 121_000);
    expect(tracker.takeNudge(122_000)).toContain("about 2 min");
  });

  it("resets on visible output and respects the cap", () => {
    const tracker = new ProgressCadenceTracker(config, 0);
    for (const name of ["shell", "shell", "message_user", "shell", "shell"]) {
      tracker.onToolStart(name, 1);
    }
    expect(tracker.takeNudge(2)).toBeUndefined();
    tracker.onToolStart("shell", 3);
    expect(tracker.takeNudge(4)).toBeDefined();
    tracker.onToolStart("plan_update_step", 5);
    expect(tracker.pending).toBe(false);
    for (let i = 0; i < 3; i++) tracker.onToolStart("shell", 6);
    expect(tracker.takeNudge(7)).toBeDefined();
    tracker.onVisibleText(8);
    for (let i = 0; i < 3; i++) tracker.onToolStart("shell", 9);
    expect(tracker.takeNudge(10)).toBeUndefined();
  });

  it("is off when maxNudges is 0", () => {
    const tracker = new ProgressCadenceTracker({ ...config, maxNudges: 0 }, 0);
    for (let i = 0; i < 10; i++) tracker.onToolStart("shell", i);
    expect(tracker.takeNudge(999_999)).toBeUndefined();
  });

  it("steering counts as visible", () => {
    const tracker = new ProgressCadenceTracker(config, 0);
    for (let i = 0; i < 3; i++) tracker.onToolStart("shell", i);
    tracker.onSteering(5);
    expect(tracker.takeNudge(6)).toBeUndefined();
  });
});

describe("shouldPromoteNarration", () => {
  it("throttles narration close to the previous chat message", () => {
    const base = { minGapSeconds: 40, steeringSinceDurable: false };
    expect(shouldPromoteNarration({ ...base, now: 10_000, lastDurableAt: undefined })).toBe(true);
    expect(shouldPromoteNarration({ ...base, now: 30_000, lastDurableAt: 10_000 })).toBe(false);
    expect(shouldPromoteNarration({ ...base, now: 50_000, lastDurableAt: 10_000 })).toBe(true);
    expect(
      shouldPromoteNarration({
        ...base,
        now: 11_000,
        lastDurableAt: 10_000,
        steeringSinceDurable: true,
      }),
    ).toBe(true);
    expect(
      shouldPromoteNarration({ ...base, minGapSeconds: 0, now: 11_000, lastDurableAt: 10_000 }),
    ).toBe(true);
  });

  it("plan reminder names plan_create", () => {
    expect(PLAN_CREATE_REMINDER).toContain("plan_create");
  });
});
