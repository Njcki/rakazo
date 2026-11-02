import { describe, expect, it } from "vitest";
import {
  CONTINUE_LATER_TOOL,
  type ContinuationChain,
  continuationDigest,
  continuationMetaText,
  continuationPrompt,
  continueLaterEligible,
  continueLaterSettings,
  decideContinuation,
  normalizePercent,
  perBotMaxContinuations,
} from "./continue-later.js";
import { selectBuiltinToolsForRun } from "./run-tool-selection.js";

const fresh: ContinuationChain = {
  continuationIndex: 0,
  continuationRootRunId: null,
  continuationDigest: null,
  continuationRepeats: 0,
  continuationPercent: null,
};
const settings = { maxContinuations: 3, maxRepeats: 3 };

describe("continueLaterSettings", () => {
  it("defaults: enabled, cap 50, a few seconds delay, 3 repeats", () => {
    expect(continueLaterSettings({})).toEqual({
      enabled: true,
      maxContinuations: 50,
      delayMs: 5000,
      maxRepeats: 3,
    });
  });

  it("can be turned off globally and per bot", () => {
    expect(continueLaterSettings({ CONTINUE_LATER_ENABLED: "false" }).enabled).toBe(false);
    const env = { CONTINUE_LATER_MAX_BY_BOT: "bot_a=0, bot_b=7" };
    expect(continueLaterSettings(env, "bot_a").enabled).toBe(false);
    expect(continueLaterSettings(env, "bot_b").maxContinuations).toBe(7);
    expect(continueLaterSettings(env, "bot_c").maxContinuations).toBe(50);
  });

  it("clamps malformed values", () => {
    const parsed = continueLaterSettings({
      CONTINUE_LATER_MAX: "9999",
      CONTINUE_LATER_DELAY_MS: "-5",
      CONTINUE_LATER_MAX_REPEATS: "x",
    });
    expect(parsed.maxContinuations).toBe(500);
    expect(parsed.delayMs).toBe(0);
    expect(parsed.maxRepeats).toBe(3);
    expect(perBotMaxContinuations({ CONTINUE_LATER_MAX_BY_BOT: "a=-1" }, "a")).toBeUndefined();
  });
});

describe("continueLaterEligible", () => {
  const on = continueLaterSettings({});
  it("covers user, group, channel, webhook and routine runs", () => {
    for (const trigger of ["user", "follow_up", "messaging", "webhook", "routine"]) {
      expect(
        continueLaterEligible({ settings: on, trigger, voiceCall: false, peerMessage: false }),
      ).toBe(true);
    }
  });
  it("excludes voice calls, peer requests, background and created runs", () => {
    expect(
      continueLaterEligible({ settings: on, trigger: "user", voiceCall: true, peerMessage: false }),
    ).toBe(false);
    expect(
      continueLaterEligible({ settings: on, trigger: "user", voiceCall: false, peerMessage: true }),
    ).toBe(false);
    for (const trigger of ["created", "reaction", "bot_message", "call_end", "heartbeat"]) {
      expect(
        continueLaterEligible({ settings: on, trigger, voiceCall: false, peerMessage: false }),
      ).toBe(false);
    }
  });
});

describe("decideContinuation", () => {
  it("starts a chain rooted at the original run", () => {
    const decision = decideContinuation({
      runId: "run_1",
      chain: fresh,
      summary: "Done 3/10 files",
      percent: 30,
      workToolCalls: 0,
      settings,
    });
    expect(decision).toMatchObject({ ok: true, index: 1, max: 3, rootRunId: "run_1", repeats: 0 });
  });

  it("enforces the hard cap", () => {
    const decision = decideContinuation({
      runId: "run_4",
      chain: { ...fresh, continuationIndex: 3, continuationRootRunId: "run_1" },
      summary: "more",
      workToolCalls: 5,
      settings,
    });
    expect(decision).toEqual({ ok: false, reason: "limit", index: 4, max: 3 });
  });

  it("stops after repeated identical summaries / no work", () => {
    const summary = "Sto elaborando i file";
    let chain = { ...fresh };
    const outcomes: string[] = [];
    for (let i = 0; i < 4; i++) {
      const decision = decideContinuation({
        runId: `run_${i}`,
        chain,
        summary,
        workToolCalls: 2,
        settings: { maxContinuations: 50, maxRepeats: 3 },
      });
      outcomes.push(decision.ok ? "ok" : decision.reason);
      if (!decision.ok) break;
      chain = {
        continuationIndex: decision.index,
        continuationRootRunId: decision.rootRunId,
        continuationDigest: decision.digest,
        continuationRepeats: decision.repeats,
        continuationPercent: decision.percent,
      };
    }
    expect(outcomes).toEqual(["ok", "ok", "ok", "no_progress"]);
  });

  it("resets the repeat counter on real progress", () => {
    const decision = decideContinuation({
      runId: "run_3",
      chain: {
        continuationIndex: 2,
        continuationRootRunId: "run_1",
        continuationDigest: continuationDigest("Done 3/10"),
        continuationRepeats: 2,
        continuationPercent: 30,
      },
      summary: "Done 6/10",
      percent: 60,
      workToolCalls: 4,
      settings,
    });
    expect(decision).toMatchObject({ ok: true, repeats: 0, percent: 60 });
  });

  it("treats a lower percent or no work as no progress", () => {
    const chain = {
      continuationIndex: 1,
      continuationRootRunId: "r",
      continuationDigest: "x",
      continuationRepeats: 0,
      continuationPercent: 50,
    };
    expect(
      decideContinuation({
        runId: "a",
        chain,
        summary: "s1",
        percent: 40,
        workToolCalls: 3,
        settings,
      }),
    ).toMatchObject({ ok: true, repeats: 1 });
    expect(
      decideContinuation({
        runId: "a",
        chain,
        summary: "s2",
        percent: 70,
        workToolCalls: 0,
        settings,
      }),
    ).toMatchObject({ ok: true, repeats: 1 });
  });
});

describe("helpers", () => {
  it("digest ignores case, spacing and punctuation", () => {
    expect(continuationDigest("Fatto 3/10, avanti!")).toBe(
      continuationDigest("fatto  3 10 avanti"),
    );
    expect(continuationDigest("a")).not.toBe(continuationDigest("b"));
  });
  it("normalizes percent", () => {
    expect(normalizePercent("42%")).toBe(42);
    expect(normalizePercent(140)).toBe(100);
    expect(normalizePercent(undefined)).toBeNull();
    expect(normalizePercent("x")).toBeNull();
  });
  it("prompt note names index and cap", () => {
    expect(continuationPrompt({ index: 3, max: 50 })).toContain(
      "[Continuation 3 of max 50: resume the task from where you left off.]",
    );
  });
  it("meta fallback text", () => {
    expect(continuationMetaText({ state: "scheduled", index: 3, max: 50, percent: 40 })).toBe(
      "Continuing on its own · round 3 of max 50 · 40% (bot estimate)",
    );
    expect(continuationMetaText({ state: "scheduled", index: 3, max: 50 })).toBe(
      "Continuing on its own · round 3 of max 50",
    );
    expect(
      continuationMetaText({
        state: "scheduled",
        index: 3,
        max: 50,
        percent: 13,
        measure: { value: 120, target: 900, unit: "items" },
      }),
    ).toBe("Continuing on its own · round 3 of max 50 · 120 items of 900 (13%)");
    // The bot's own lower estimate is shown next to the measure (the lower-of rule).
    expect(
      continuationMetaText({
        state: "scheduled",
        index: 2,
        max: 50,
        percent: 10,
        measure: { value: 62, target: 100 },
      }),
    ).toBe("Continuing on its own · round 2 of max 50 · 62 of 100 (62%) · bot estimate 10%");
    expect(continuationMetaText({ state: "limit", index: 51, max: 50 })).toContain("limit");
  });
});

describe("tool selection", () => {
  const base = {
    graphicalToolsAllowed: false,
    groupId: null,
    semanticMemoryEnabled: false,
    messagingChannelRun: false,
  };
  const names = (options: Parameters<typeof selectBuiltinToolsForRun>[0]) =>
    selectBuiltinToolsForRun(options).map((tool) => tool.name);
  it("offers continue_later only when eligible", () => {
    expect(names({ ...base, trigger: "user", continueLater: true })).toContain(CONTINUE_LATER_TOOL);
    expect(names({ ...base, trigger: "user" })).not.toContain(CONTINUE_LATER_TOOL);
    expect(
      names({
        ...base,
        trigger: "user",
        continueLater: true,
        disabledBuiltinTools: [CONTINUE_LATER_TOOL],
      }),
    ).not.toContain(CONTINUE_LATER_TOOL);
  });
  it("is offered in channel runs and routines", () => {
    expect(
      names({ ...base, trigger: "messaging", messagingChannelRun: true, continueLater: true }),
    ).toContain(CONTINUE_LATER_TOOL);
    expect(names({ ...base, trigger: "routine", continueLater: true })).toContain(
      CONTINUE_LATER_TOOL,
    );
  });
});
