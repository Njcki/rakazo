import { describe, expect, it } from "vitest";
import { continuationPrompt } from "./continue-later.js";
import {
  decideGoalGate,
  decideJudgeGate,
  type GoalCheck,
  type GoalLedger,
  goalStalledNotice,
  parseGoalCheckArgs,
  parseGoalLedger,
  parseJudgeVerdict,
  parseProbeOutput,
  withReading,
} from "./goal-check.js";
import { evaluateGoalGate, evaluateRequestedContinuation, isLongRequest } from "./goal-gate.js";
import type { RunContext } from "./run-context.js";

// Neutral fixtures: a batch job over 40 items, a simple question, a research task.
const BATCH_REQUEST = "Converti tutti i file della cartella input e continua fino al 100%";
const SIMPLE_REQUEST = "Che ore sono a Tokyo adesso?";
const RESEARCH_REQUEST = "Fai una ricerca completa sulle librerie di grafici e confrontale tutte";

type Fake = {
  ctx: RunContext;
  ledger: { value: unknown };
  probeOutputs: Array<{ stdout: string; code: number }>;
  probeCalls: string[][];
  judgeCalls: number;
};

function fakeContext(input: {
  runId: string;
  index: number;
  workToolCalls: number;
  ledger?: GoalLedger;
  probeOutputs?: Array<{ stdout: string; code: number }>;
  judge?: string | undefined | (() => Promise<string | undefined>);
  computerReady?: boolean;
}): Fake {
  const fake: Fake = {
    ledger: { value: input.ledger ?? null },
    probeOutputs: [...(input.probeOutputs ?? [])],
    probeCalls: [],
    judgeCalls: 0,
    ctx: undefined as unknown as RunContext,
  };
  const computer = { id: "c1", kind: "linux" };
  const ctx = {
    runId: input.runId,
    run: {
      id: input.runId,
      continuationRootRunId: input.index > 0 ? "root" : null,
      continuationIndex: input.index,
    },
    bot: { id: "bot" },
    context: {},
    deps: {
      prisma: {
        run: {
          findUnique: async () => ({ continuationGoal: fake.ledger.value }),
          update: async ({ data }: { data: { continuationGoal: unknown } }) => {
            fake.ledger.value = JSON.parse(JSON.stringify(data.continuationGoal));
            return {};
          },
        },
      },
      sandbox: {
        async *execute(_computer: unknown, request: { argv: string[] }) {
          fake.probeCalls.push(request.argv);
          const next = fake.probeOutputs.shift() ?? { stdout: "", code: 1 };
          yield { type: "stdout", data: next.stdout };
          yield { type: "exit", code: next.code };
        },
      },
    },
    computer: {
      mode: "bot",
      lazy: { ready: input.computerReady === false ? undefined : computer },
      get: async () => computer,
    },
    state: {
      continuation: { workToolCalls: input.workToolCalls, settings: { maxContinuations: 20 } },
      planReminder: { planToolUsedThisRun: false },
    },
    abortController: new AbortController(),
    completionJudge:
      input.judge === undefined
        ? undefined
        : async () => {
            fake.judgeCalls++;
            return typeof input.judge === "function" ? input.judge() : input.judge;
          },
  };
  fake.ctx = ctx as unknown as RunContext;
  return fake;
}

const goal = (readings: GoalCheck["readings"] = []): GoalCheck => ({
  description: "Convert all 40 input files",
  probe: "ls output | wc -l",
  kind: "number",
  target: 40,
  registeredRunId: "root",
  registeredAt: "2026-03-02T10:00:00.000Z",
  readings,
});

const reading = (runId: string, index: number, value: number, gate = true) => ({
  runId,
  index,
  value,
  at: "2026-03-02T10:00:00.000Z",
  gate,
});

const gateInput = (overrides: Partial<Parameters<typeof evaluateGoalGate>[1]> = {}) => ({
  goalTexts: [BATCH_REQUEST],
  replyText: "Gruppo completato: piano chiuso.",
  replyClaimsDone: false,
  replyUnfinished: false,
  stopAsked: false,
  planLines: ["1. [done] Converti il primo gruppo"],
  language: "it" as const,
  ...overrides,
});

describe("goal check parsing", () => {
  it("validates the tool arguments", () => {
    expect(parseGoalCheckArgs({ description: "x", probe: "", target: 3 }).ok).toBe(false);
    expect(parseGoalCheckArgs({ description: "x", probe: "echo 1", target: 0 }).ok).toBe(false);
    expect(parseGoalCheckArgs({ description: "x", probe: "echo 1", target: "12,5" })).toMatchObject(
      { ok: true, target: 12.5, kind: "number" },
    );
    expect(
      parseGoalCheckArgs({ description: "x", probe: "test -f done", kind: "exit" }),
    ).toMatchObject({ ok: true, target: 1, kind: "exit" });
  });

  it("reads the last number of a successful probe and the exit code of a boolean one", () => {
    expect(parseProbeOutput("number", "files: 12\ntotal 17\n", 0)).toBe(17);
    expect(parseProbeOutput("number", "17", 2)).toBeUndefined();
    expect(parseProbeOutput("number", "none", 0)).toBeUndefined();
    expect(parseProbeOutput("exit", "", 0)).toBe(1);
    expect(parseProbeOutput("exit", "", 1)).toBe(0);
  });

  it("parses a stored ledger and ignores garbage", () => {
    expect(parseGoalLedger(null)).toEqual({ v: 1 });
    expect(parseGoalLedger({ goal: { probe: 1 } })).toEqual({ v: 1 });
    expect(parseGoalLedger({ v: 1, goal: goal(), nudgedRunId: "r" }).goal?.target).toBe(40);
  });

  it("keeps one gate reading per run", () => {
    const g = withReading(withReading(goal(), reading("r1", 0, 3)), reading("r1", 0, 5));
    expect(g.readings).toEqual([reading("r1", 0, 5)]);
  });

  it("parses the judge's JSON, also inside prose", () => {
    expect(parseJudgeVerdict('ok {"complete": false, "reason": "3 of 9"}')).toEqual({
      complete: false,
      reason: "3 of 9",
    });
    expect(parseJudgeVerdict("not json")).toBeUndefined();
    expect(parseJudgeVerdict('{"complete": "yes"}')).toBeUndefined();
  });
});

describe("goal decisions", () => {
  const base = { workToolCalls: 5, continuationIndex: 1, stopAsked: false };
  it("continues below target while the value moves, stops when reached or flat", () => {
    expect(decideGoalGate({ ...base, goal: goal(), value: 10, previous: 6 })).toBe("continue");
    expect(decideGoalGate({ ...base, goal: goal(), value: 10, previous: undefined })).toBe(
      "continue",
    );
    expect(decideGoalGate({ ...base, goal: goal(), value: 40, previous: 30 })).toBe("reached");
    expect(decideGoalGate({ ...base, goal: goal(), value: 10, previous: 10 })).toBe("stalled");
    expect(decideGoalGate({ ...base, goal: goal(), value: 9, previous: 10 })).toBe("stalled");
    expect(decideGoalGate({ ...base, goal: goal(), value: 10, previous: 6, stopAsked: true })).toBe(
      "stop_asked",
    );
    expect(decideGoalGate({ ...base, goal: goal(), value: undefined, previous: 6 })).toBe(
      "unmeasured",
    );
  });

  it("judge: continues only when unfinished and the part worked", () => {
    const unfinished = { complete: false, reason: "half" };
    expect(decideJudgeGate({ verdict: unfinished, workToolCalls: 4, stopAsked: false })).toBe(
      "continue",
    );
    expect(decideJudgeGate({ verdict: unfinished, workToolCalls: 0, stopAsked: false })).toBe(
      "end",
    );
    expect(
      decideJudgeGate({
        verdict: { complete: true, reason: "" },
        workToolCalls: 4,
        stopAsked: false,
      }),
    ).toBe("end");
    expect(decideJudgeGate({ verdict: undefined, workToolCalls: 4, stopAsked: false })).toBe(
      "unavailable",
    );
  });

  it("tells the user honestly where it stopped, in their language", () => {
    expect(goalStalledNotice(goal(), 12, "it")).toContain("12 / 40");
    expect(goalStalledNotice(goal(), 12, "it")).toMatch(/^Mi fermo qui/);
    expect(goalStalledNotice(goal(), 12, "en")).toMatch(/^I am stopping here/);
  });

  it("a long request needs the wording and real work; a simple question never is one", () => {
    const work = { workToolCalls: 6, continuationIndex: 0, planToolUsedThisRun: false };
    expect(isLongRequest({ goalTexts: [BATCH_REQUEST], ...work })).toBe(true);
    expect(isLongRequest({ goalTexts: [SIMPLE_REQUEST], ...work })).toBe(false);
    expect(isLongRequest({ goalTexts: [BATCH_REQUEST], ...work, workToolCalls: 1 })).toBe(false);
  });
});

describe("measurable batch job", () => {
  it("continues until the target and stops at the target", async () => {
    const part1 = fakeContext({
      runId: "r1",
      index: 1,
      workToolCalls: 8,
      ledger: { v: 1, goal: goal([reading("root", 0, 4)]) },
      probeOutputs: [{ stdout: "12\n", code: 0 }],
    });
    const first = await evaluateGoalGate(part1.ctx, gateInput());
    expect(first).toMatchObject({ mode: "probe", continueReason: "goal_probe", percent: 30 });
    expect(first.log).toMatchObject({ probeBefore: 4, probeAfter: 12, probeTarget: 40 });
    expect(first.note).toContain("ls output | wc -l");
    expect(first.progressLine).toContain("12 of 40");
    const prompt = continuationPrompt({
      index: 2,
      max: 20,
      auto: "goal_probe",
      goalNote: first.note,
    });
    expect(prompt).toContain("Convert all 40 input files");

    const part2 = fakeContext({
      runId: "r2",
      index: 2,
      workToolCalls: 8,
      ledger: part1.ledger.value as GoalLedger,
      probeOutputs: [{ stdout: "40\n", code: 0 }],
    });
    const done = await evaluateGoalGate(part2.ctx, gateInput({ replyClaimsDone: true }));
    expect(done).toMatchObject({ mode: "probe", stop: "reached" });
    expect(done.continueReason).toBeUndefined();
  });

  it("stops at the first part after which the value did not move", async () => {
    const fake = fakeContext({
      runId: "r3",
      index: 3,
      workToolCalls: 6,
      ledger: { v: 1, goal: goal([reading("r2", 2, 20)]) },
      probeOutputs: [{ stdout: "20", code: 0 }],
    });
    const result = await evaluateGoalGate(fake.ctx, gateInput());
    expect(result).toMatchObject({ mode: "probe", stop: "stalled" });
    expect(result.notice).toContain("20 / 40");
  });

  it("does not end when the bot plans and closes only a sub-batch while the probe is below target", async () => {
    // The plan of this part is fully done and the reply sounds final: the probe still decides.
    const fake = fakeContext({
      runId: "r1",
      index: 1,
      workToolCalls: 9,
      ledger: { v: 1, goal: goal([reading("root", 0, 3)]) },
      probeOutputs: [{ stdout: "6", code: 0 }],
    });
    const result = await evaluateGoalGate(
      fake.ctx,
      gateInput({
        replyText: "Gruppo 4–6 completato. Tutti gli step del piano sono chiusi.",
        replyClaimsDone: true,
        planLines: ["1. [done] Converti 4", "2. [done] Converti 5", "3. [done] Converti 6"],
      }),
    );
    expect(result.continueReason).toBe("goal_probe");
  });

  it("a redo loop (flat probe across parts) stops, even when the model asks to continue", async () => {
    const fake = fakeContext({
      runId: "r5",
      index: 5,
      workToolCalls: 12,
      ledger: { v: 1, goal: goal([reading("r4", 4, 17)]) },
      probeOutputs: [{ stdout: "17", code: 0 }],
    });
    const result = await evaluateRequestedContinuation(fake.ctx, {
      stopAsked: false,
      language: "en",
    });
    expect(result).toMatchObject({ mode: "probe", stop: "stalled" });
  });

  it("the gate starts the computer to measure when the part never touched it", async () => {
    const fake = fakeContext({
      runId: "r1",
      index: 1,
      workToolCalls: 0,
      computerReady: false,
      ledger: { v: 1, goal: goal([reading("root", 0, 5)]) },
      probeOutputs: [{ stdout: "5", code: 0 }],
    });
    const result = await evaluateGoalGate(fake.ctx, gateInput());
    expect(fake.probeCalls).toHaveLength(1);
    expect(result.stop).toBe("stalled");
  });

  it("stop words end it", async () => {
    const fake = fakeContext({
      runId: "r1",
      index: 1,
      workToolCalls: 4,
      ledger: { v: 1, goal: goal([reading("root", 0, 5)]) },
      probeOutputs: [{ stdout: "9", code: 0 }],
    });
    const result = await evaluateGoalGate(fake.ctx, gateInput({ stopAsked: true }));
    expect(result).toMatchObject({ mode: "probe", stop: "stop_asked" });
  });
});

describe("simple question", () => {
  it("ends right away: no probe, no judge, no nudge", async () => {
    const fake = fakeContext({
      runId: "r0",
      index: 0,
      workToolCalls: 2,
      judge: '{"complete":false}',
    });
    const result = await evaluateGoalGate(
      fake.ctx,
      gateInput({ goalTexts: [SIMPLE_REQUEST], replyText: "A Tokyo sono le 21:10." }),
    );
    expect(result.mode).toBe("legacy");
    expect(fake.judgeCalls).toBe(0);
    expect(fake.probeCalls).toHaveLength(0);
  });
});

describe("long request without a probe", () => {
  it("asks once for a completion check, then the judge decides", async () => {
    const first = fakeContext({
      runId: "r0",
      index: 0,
      workToolCalls: 7,
      judge: '{"complete":false}',
    });
    const nudge = await evaluateGoalGate(first.ctx, gateInput({ goalTexts: [RESEARCH_REQUEST] }));
    expect(nudge).toMatchObject({ mode: "nudge", continueReason: "goal_check_missing" });
    expect(nudge.note).toContain("set_goal_check");

    const second = fakeContext({
      runId: "r1",
      index: 1,
      workToolCalls: 5,
      ledger: first.ledger.value as GoalLedger,
      judge: '{"complete": false, "reason": "only 2 of 6 libraries compared"}',
    });
    const judged = await evaluateGoalGate(second.ctx, gateInput({ goalTexts: [RESEARCH_REQUEST] }));
    expect(judged).toMatchObject({ mode: "judge", continueReason: "judge_unfinished" });
    expect(judged.note).toContain("2 of 6");
    expect(judged.log).toMatchObject({ judgeComplete: false });
  });

  it("ends when the judge says complete", async () => {
    const fake = fakeContext({
      runId: "r2",
      index: 2,
      workToolCalls: 5,
      ledger: { v: 1, nudgedRunId: "r0" },
      judge: '{"complete": true, "reason": "all compared"}',
    });
    const result = await evaluateGoalGate(fake.ctx, gateInput({ goalTexts: [RESEARCH_REQUEST] }));
    expect(result).toMatchObject({ mode: "judge", stop: "judge_complete" });
  });

  it("ends at the first part without real work even if the judge says unfinished", async () => {
    const fake = fakeContext({
      runId: "r2",
      index: 2,
      workToolCalls: 0,
      ledger: { v: 1, nudgedRunId: "r0" },
      judge: '{"complete": false, "reason": "more to do"}',
    });
    const result = await evaluateGoalGate(fake.ctx, gateInput({ goalTexts: [RESEARCH_REQUEST] }));
    expect(result).toMatchObject({ mode: "judge", stop: "judge_no_work" });
  });

  it("falls back to the plan gate when the judge is unavailable", async () => {
    const fake = fakeContext({
      runId: "r2",
      index: 2,
      workToolCalls: 5,
      ledger: { v: 1, nudgedRunId: "r0" },
      judge: async () => {
        throw new Error("timeout");
      },
    });
    const result = await evaluateGoalGate(fake.ctx, gateInput({ goalTexts: [RESEARCH_REQUEST] }));
    expect(result.mode).toBe("legacy");
  });

  it("a model-requested continuation without a check is left as it is", async () => {
    const fake = fakeContext({ runId: "r1", index: 1, workToolCalls: 3 });
    const result = await evaluateRequestedContinuation(fake.ctx, {
      stopAsked: false,
      language: "it",
    });
    expect(result.mode).toBe("legacy");
  });
});
