import { describe, expect, it } from "vitest";
import { continuationPrompt } from "./continue-later.js";
import {
  decideGoalGate,
  decideJudgeGate,
  displayPercent,
  type GoalCheck,
  type GoalLedger,
  goalMeasure,
  goalStalledNotice,
  parseGoalCheckArgs,
  parseGoalLedger,
  parseJudgeVerdict,
  parseProbeOutput,
  withReading,
} from "./goal-check.js";
import { evaluateGoalGate, evaluateRequestedContinuation, isLongRequest } from "./goal-gate.js";
import type { RunContext } from "./run-context.js";
import { goalTools } from "./run-tools-goal.js";

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
      reply: { narrationSoFar: "Stato: 52 di 4000 elementi elaborati. ", assembled: "" },
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
    expect(first.statusLine).toBe(
      "Stato del lavoro: 12/40 (30%). Proseguo con la parte successiva.",
    );
    expect(first.progressLine).toContain("12 of 40");
    expect(first.measure).toEqual({ value: 12, target: 40 });
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

describe("a check whose target the bot sets to what is already done", () => {
  it("is refused at registration", async () => {
    const fake = fakeContext({
      runId: "r1",
      index: 1,
      workToolCalls: 3,
      probeOutputs: [{ stdout: "88\n", code: 0 }],
    });
    let result: Record<string, unknown> = {};
    await goalTools.set_goal_check!(fake.ctx, {
      name: "set_goal_check",
      args: { description: "All items of the batch", probe: "ls out | wc -l", target: 88 },
      finish: (value: Record<string, unknown>) => {
        result = value;
      },
    } as never);
    expect(String(result.error)).toContain("would end the request right now");
    expect(fake.ledger.value).toBeNull();
  });

  it("is refused when the review says it measures only part of the job, at most twice", async () => {
    const register = async (fake: Fake) => {
      let result: Record<string, unknown> = {};
      await goalTools.set_goal_check!(fake.ctx, {
        name: "set_goal_check",
        args: { description: "All files", probe: "ls out | wc -l", target: 40 },
        finish: (value: Record<string, unknown>) => {
          result = value;
        },
      } as never);
      return result;
    };
    const partial = '{"whole": false, "reason": "counts files, the job is 4000 lines"}';
    const first = fakeContext({
      runId: "r1",
      index: 1,
      workToolCalls: 3,
      probeOutputs: [{ stdout: "20\n", code: 0 }],
      judge: partial,
    });
    const refused = await register(first);
    expect(String(refused.error)).toContain("only part of the request");
    expect((first.ledger.value as GoalLedger).goal).toBeUndefined();
    expect((first.ledger.value as GoalLedger).partialRefusals).toBe(1);

    const second = fakeContext({
      runId: "r1",
      index: 1,
      workToolCalls: 3,
      ledger: { v: 1, partialRefusals: 2 },
      probeOutputs: [{ stdout: "20\n", code: 0 }],
      judge: partial,
    });
    expect(await register(second)).toMatchObject({ ok: true, value: 20, target: 40 });
    expect(second.judgeCalls).toBe(0);

    const whole = fakeContext({
      runId: "r1",
      index: 1,
      workToolCalls: 3,
      probeOutputs: [{ stdout: "52\n", code: 0 }],
      judge: '{"whole": true}',
    });
    let result: Record<string, unknown> = {};
    await goalTools.set_goal_check!(whole.ctx, {
      name: "set_goal_check",
      args: { description: "All 4000 lines", probe: "cat out/* | wc -l", target: 4000 },
      finish: (value: Record<string, unknown>) => {
        result = value;
      },
    } as never);
    expect(result).toMatchObject({ ok: true, value: 52, target: 4000 });
  });

  it("registers a check below its target", async () => {
    const fake = fakeContext({
      runId: "r1",
      index: 1,
      workToolCalls: 3,
      probeOutputs: [{ stdout: "88\n", code: 0 }],
    });
    let result: Record<string, unknown> = {};
    await goalTools.set_goal_check!(fake.ctx, {
      name: "set_goal_check",
      args: { description: "All 400 items", probe: "ls out | wc -l", target: 400 },
      finish: (value: Record<string, unknown>) => {
        result = value;
      },
    } as never);
    expect(result).toMatchObject({ ok: true, value: 88, target: 400, reached: false });
    expect((fake.ledger.value as GoalLedger).goal?.readings).toHaveLength(1);
  });

  it("a reached reading is disputed once by the review when the request is not complete", async () => {
    const reachedGoal = { ...goal([reading("r1", 1, 30)]), target: 40 };
    const first = fakeContext({
      runId: "r2",
      index: 2,
      workToolCalls: 6,
      ledger: { v: 1, goal: reachedGoal },
      probeOutputs: [{ stdout: "40", code: 0 }],
      judge: '{"complete": false, "reason": "coverage is 10% of the whole request"}',
    });
    const disputed = await evaluateGoalGate(
      first.ctx,
      gateInput({ replyText: "Batch done. Total coverage 10%.", replyClaimsDone: true }),
    );
    expect(disputed).toMatchObject({ mode: "probe", continueReason: "goal_probe" });
    expect(disputed.note).toContain("set_goal_check again");
    expect(disputed.log).toMatchObject({ goalAction: "reached_disputed", judgeComplete: false });

    const second = fakeContext({
      runId: "r3",
      index: 3,
      workToolCalls: 6,
      ledger: first.ledger.value as GoalLedger,
      probeOutputs: [{ stdout: "40", code: 0 }],
      judge: '{"complete": false, "reason": "still 10%"}',
    });
    // Still unfinished and the part worked: it keeps going (the review, not the check, decides).
    const again = await evaluateGoalGate(second.ctx, gateInput());
    expect(again).toMatchObject({ mode: "probe", continueReason: "goal_probe" });
    expect(second.judgeCalls).toBe(1);

    // Unfinished but a part without real work: the no-progress rule ends it honestly.
    const third = fakeContext({
      runId: "r4",
      index: 4,
      workToolCalls: 0,
      ledger: second.ledger.value as GoalLedger,
      probeOutputs: [{ stdout: "40", code: 0 }],
      judge: '{"complete": false, "reason": "still 10%"}',
    });
    const ended = await evaluateGoalGate(third.ctx, gateInput());
    expect(ended).toMatchObject({ mode: "probe", stop: "stalled" });
    expect(ended.notice).toBeTruthy();
  });

  it("once the check can no longer be replaced, the note says to keep working", async () => {
    const fake = fakeContext({
      runId: "r2",
      index: 2,
      workToolCalls: 5,
      ledger: { v: 1, goal: { ...goal([reading("r1", 1, 30)]), changes: 3 } },
      probeOutputs: [{ stdout: "40", code: 0 }],
      judge: '{"complete": false, "reason": "half of the items are missing"}',
    });
    const result = await evaluateGoalGate(fake.ctx, gateInput());
    expect(result).toMatchObject({ continueReason: "goal_probe" });
    expect(result.note).toContain("can no longer be replaced");
    expect(result.note).not.toContain("set_goal_check again");
  });

  it("without a review, a reached check whose reply says more remains continues once", async () => {
    const first = fakeContext({
      runId: "r2",
      index: 2,
      workToolCalls: 5,
      ledger: { v: 1, goal: goal([reading("r1", 1, 30)]) },
      probeOutputs: [{ stdout: "40", code: 0 }],
    });
    const nudged = await evaluateGoalGate(
      first.ctx,
      gateInput({ replyText: "Primo gruppo fatto, ne restano altri.", moreRemains: true }),
    );
    expect(nudged).toMatchObject({ continueReason: "goal_probe" });
    expect(nudged.log).toMatchObject({ goalAction: "reached_unreviewed" });
    expect(nudged.note).toContain("set_goal_check again");

    const second = fakeContext({
      runId: "r3",
      index: 3,
      workToolCalls: 5,
      ledger: first.ledger.value as GoalLedger,
      probeOutputs: [{ stdout: "40", code: 0 }],
    });
    const ended = await evaluateGoalGate(second.ctx, gateInput({ moreRemains: true }));
    expect(ended).toMatchObject({ stop: "reached" });
  });

  it("without a review and nothing left in the reply or plan, a reached check ends", async () => {
    const fake = fakeContext({
      runId: "r2",
      index: 2,
      workToolCalls: 5,
      ledger: { v: 1, goal: goal([reading("r1", 1, 30)]) },
      probeOutputs: [{ stdout: "40", code: 0 }],
    });
    const result = await evaluateGoalGate(fake.ctx, gateInput({ moreRemains: false }));
    expect(result).toMatchObject({ stop: "reached" });
  });

  it("the model's continue_later with a reached check is reviewed too", async () => {
    const fake = fakeContext({
      runId: "r2",
      index: 2,
      workToolCalls: 5,
      ledger: { v: 1, goal: goal([reading("r1", 1, 30)]) },
      probeOutputs: [{ stdout: "40", code: 0 }],
      judge: '{"complete": false, "reason": "only the first part is done"}',
    });
    const result = await evaluateRequestedContinuation(fake.ctx, {
      stopAsked: false,
      language: "it",
      goalTexts: [BATCH_REQUEST],
      replyText: "Continuo con il prossimo gruppo.",
      moreRemains: true,
    });
    expect(result).toMatchObject({ continueReason: "goal_probe" });
    expect(fake.judgeCalls).toBe(1);
  });

  it("a reached reading confirmed by the review ends the request", async () => {
    const fake = fakeContext({
      runId: "r2",
      index: 2,
      workToolCalls: 6,
      ledger: { v: 1, goal: goal([reading("r1", 1, 30)]) },
      probeOutputs: [{ stdout: "40", code: 0 }],
      judge: '{"complete": true, "reason": "all 40 converted"}',
    });
    const result = await evaluateGoalGate(fake.ctx, gateInput({ replyClaimsDone: true }));
    expect(result).toMatchObject({ mode: "probe", stop: "reached" });
    expect(result.log).toMatchObject({ judgeComplete: true });
  });
});

describe("the percent shown to the user", () => {
  it("carries the measured value, target and the check's own unit", () => {
    const check = {
      description: "all items",
      probe: "ls out | wc -l",
      kind: "number" as const,
      target: 300,
      unit: " file ",
      readings: [],
      registeredRunId: "run-1",
      registeredAt: "2026-01-01T00:00:00.000Z",
    };
    const { unit: _unit, ...noUnit } = check;
    expect(goalMeasure(check, 45)).toEqual({ value: 45, target: 300, unit: "file" });
    expect(goalMeasure(noUnit, 5)).toEqual({ value: 5, target: 300 });
    expect(goalMeasure({ ...check, kind: "exit", target: 1 }, 1)).toBeUndefined();
  });
  it("is the lowest of the measured and the reported one, none without either", () => {
    expect(displayPercent(53, 10)).toBe(10);
    expect(displayPercent(12, undefined)).toBe(12);
    expect(displayPercent(null, 40)).toBe(40);
    expect(displayPercent(null, null)).toBeUndefined();
  });
});
