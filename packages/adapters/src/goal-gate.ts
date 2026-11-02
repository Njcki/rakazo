/**
 * Wiring of the objective ledger (goal-check.ts): load and save it on the chain's root run,
 * run the probe on the bot's computer, ask the fallback judge, and turn all of it into one
 * decision for the completion gate. Never throws to the caller's gate: errors fall back to the
 * plan-based gate ("legacy").
 */
import type { ComputerRef } from "@rakazo/adapter-kit";
import type { Prisma } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { resolveBotWorkspaceCwd } from "./computer-support.js";
import {
  buildJudgePrompt,
  decideGoalGate,
  decideJudgeGate,
  GOAL_CHECK_NUDGE,
  GOAL_PROBE_TIMEOUT_MS,
  type GoalCheck,
  type GoalLedger,
  goalContinuationNote,
  goalDisputedNote,
  goalPercent,
  goalProgressLine,
  goalStalledNotice,
  JUDGE_TIMEOUT_MS,
  type JudgeVerdict,
  parseGoalLedger,
  parseJudgeVerdict,
  parseProbeOutput,
  previousGateReading,
  SET_GOAL_CHECK_TOOL,
  withReading,
} from "./goal-check.js";
import { nativeShellCommandArgv, usesNativeShell } from "./native-shell.js";
import type { RunContext } from "./run-context.js";
import { looksLikeLongTask, looksLikeWholeJobGoal } from "./user-intent.js";

const PROBE_OUTPUT_MAX = 4_000;
const PROBE_COMPUTER_START_MS = 60_000;

export function chainRootRunId(ctx: Pick<RunContext, "run" | "runId">): string {
  return ctx.run.continuationRootRunId ?? ctx.runId;
}

export async function loadGoalLedger(
  ctx: Pick<RunContext, "deps" | "run" | "runId">,
): Promise<GoalLedger> {
  const row = await ctx.deps.prisma.run.findUnique({
    where: { id: chainRootRunId(ctx) },
    select: { continuationGoal: true },
  });
  return parseGoalLedger(row?.continuationGoal);
}

export async function saveGoalLedger(
  ctx: Pick<RunContext, "deps" | "run" | "runId">,
  ledger: GoalLedger,
): Promise<void> {
  await ctx.deps.prisma.run.update({
    where: { id: chainRootRunId(ctx) },
    data: { continuationGoal: ledger as unknown as Prisma.InputJsonValue },
  });
}

export type ProbeResult = {
  value: number | undefined;
  code: number | null;
  output: string;
  error?: string;
};

/**
 * Runs the probe on the bot's computer like the shell tool does, without the bot's secrets in
 * its environment and with a short timeout. The output is only parsed for a number.
 */
export async function runGoalProbe(
  ctx: RunContext,
  goal: Pick<GoalCheck, "probe" | "kind">,
  computer: ComputerRef,
): Promise<ProbeResult> {
  const { deps, bot, context } = ctx;
  const cwd = resolveBotWorkspaceCwd(ctx.computer.mode, bot.id, undefined);
  const environment =
    ctx.computer.hostEnvironment ??
    (usesNativeShell(computer.kind)
      ? await deps.sandbox.environment?.(computer, context)
      : undefined);
  const argv = environment
    ? nativeShellCommandArgv(goal.probe, environment)
    : ["bash", "-c", goal.probe];
  let stdout = "";
  let code: number | null = null;
  const run = async () => {
    for await (const event of deps.sandbox.execute(
      computer,
      { argv, cwd, timeoutMs: GOAL_PROBE_TIMEOUT_MS },
      context,
    )) {
      if (event.type === "stdout" && stdout.length < PROBE_OUTPUT_MAX) stdout += event.data;
      if (event.type === "exit") code = event.code;
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("probe timed out")),
          GOAL_PROBE_TIMEOUT_MS + 5_000,
        );
      }),
    ]);
  } catch (error) {
    return {
      value: undefined,
      code,
      output: stdout.slice(-PROBE_OUTPUT_MAX),
      error: error instanceof Error ? error.message : "probe failed",
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
  return {
    value: parseProbeOutput(goal.kind, stdout, code),
    code,
    output: stdout.slice(-PROBE_OUTPUT_MAX),
  };
}

/** The gate measures even after a part that never touched the computer (bounded wait). */
async function startComputerForProbe(ctx: RunContext): Promise<ComputerRef | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      ctx.computer.get("tool", SET_GOAL_CHECK_TOOL),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), PROBE_COMPUTER_START_MS);
      }),
    ]);
  } catch {
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runJudge(
  ctx: RunContext,
  input: { goalTexts: string[]; replyText: string; planLines: string[]; checkLine?: string },
): Promise<JudgeVerdict | undefined> {
  const judge = ctx.completionJudge;
  if (!judge) return undefined;
  try {
    const signal = AbortSignal.any([
      ctx.abortController.signal,
      AbortSignal.timeout(JUDGE_TIMEOUT_MS),
    ]);
    return parseJudgeVerdict(await judge(buildJudgePrompt(input), signal));
  } catch {
    return undefined;
  }
}

/** A long request in the sense of the ledger: "go all the way" wording plus real work. */
export function isLongRequest(input: {
  goalTexts: readonly string[];
  workToolCalls: number;
  continuationIndex: number;
  planToolUsedThisRun: boolean;
}): boolean {
  const worded = input.goalTexts.some((t) => looksLikeLongTask(t) || looksLikeWholeJobGoal(t));
  return (
    worded && (input.workToolCalls >= 3 || input.continuationIndex > 0 || input.planToolUsedThisRun)
  );
}

export type GoalGateResult = {
  mode: "legacy" | "probe" | "nudge" | "judge";
  /** Continue the request with this automatic reason; undefined ends it. */
  continueReason?: "goal_probe" | "goal_check_missing" | "judge_unfinished";
  /** Why the request ends under this gate (logged). */
  stop?: "reached" | "stalled" | "stop_asked" | "judge_complete" | "judge_no_work";
  /** Line added to the progress summary (changes with the value, so the digest guard sees progress). */
  progressLine?: string;
  /** Note for the next part's prompt. */
  note?: string;
  percent?: number | null;
  /** Shown to the user when the request stops without reaching the goal. */
  notice?: string;
  log: Record<string, unknown>;
};

/**
 * The ledger's decision for this part. With a probe it alone decides (plan and wording are
 * advisory); without one on a long request it asks for one once, then asks the judge.
 * "legacy" leaves the decision to the plan-based gate (simple requests, judge unavailable).
 */
export async function evaluateGoalGate(
  ctx: RunContext,
  input: {
    goalTexts: string[];
    replyText: string;
    replyClaimsDone: boolean;
    replyUnfinished: boolean;
    stopAsked: boolean;
    planLines: string[];
    language: "it" | "en";
    /** Decide only from a registered check; anything else is left to the caller. */
    probeOnly?: boolean;
  },
): Promise<GoalGateResult> {
  const { run, runId } = ctx;
  const workToolCalls = ctx.state.continuation.workToolCalls;
  let ledger: GoalLedger;
  try {
    ledger = await loadGoalLedger(ctx);
  } catch (error) {
    getLogger().warn("run.goal_gate ledger unavailable", { runId, error: String(error) });
    return { mode: "legacy", log: { goalGate: "ledger_error" } };
  }
  const goal = ledger.goal;
  if (goal) {
    const computer = ctx.computer.lazy.ready ?? (await startComputerForProbe(ctx));
    const probe = computer
      ? await runGoalProbe(ctx, goal, computer)
      : ({ value: undefined, code: null, output: "", error: "computer not started" } as const);
    const previous = previousGateReading(goal, runId)?.value;
    const action = decideGoalGate({
      goal,
      value: probe.value,
      previous,
      workToolCalls,
      continuationIndex: run.continuationIndex,
      stopAsked: input.stopAsked,
    });
    const log = {
      goalGate: "probe",
      goalAction: action,
      probeBefore: previous,
      probeAfter: probe.value,
      probeTarget: goal.target,
      probeKind: goal.kind,
      probeCode: probe.code,
      probeError: probe.error,
    };
    if (probe.value !== undefined) {
      ledger.goal = withReading(goal, {
        runId,
        index: run.continuationIndex,
        value: probe.value,
        at: new Date().toISOString(),
        gate: true,
      });
      await saveGoalLedger(ctx, ledger).catch(() => undefined);
    }
    if (action === "unmeasured") {
      if (input.probeOnly) return { mode: "legacy", log };
      // Without a reading the probe cannot decide: the judge (or the plan gate) does.
      const judged = await judgeOrLegacy(ctx, input, workToolCalls);
      return { ...judged, log: { ...log, ...judged.log } };
    }
    const value = probe.value!;
    if (action === "reached" && ledger.disputed !== goal.registeredAt) {
      // The bot picks its own target: a "done" reading is confirmed once by the completion
      // review against the user's request before it may end the chain.
      const verdict = await runJudge(ctx, {
        ...input,
        checkLine: goalProgressLine(goal, value),
      });
      const reviewLog = { ...log, judgeComplete: verdict?.complete, judgeReason: verdict?.reason };
      if (verdict && !verdict.complete) {
        ledger.disputed = goal.registeredAt;
        await saveGoalLedger(ctx, ledger).catch(() => undefined);
        return {
          mode: "probe",
          continueReason: "goal_probe",
          progressLine: goalProgressLine(goal, value),
          note: goalDisputedNote(goal, value, verdict.reason),
          percent: null,
          log: { ...reviewLog, goalAction: "reached_disputed" },
        };
      }
      return { mode: "probe", stop: "reached", percent: goalPercent(goal, value), log: reviewLog };
    }
    if (action === "continue") {
      return {
        mode: "probe",
        continueReason: "goal_probe",
        progressLine: goalProgressLine(goal, value),
        note: goalContinuationNote(goal, value),
        percent: goalPercent(goal, value),
        log,
      };
    }
    return {
      mode: "probe",
      stop: action,
      percent: goalPercent(goal, value),
      ...(action === "stalled" ? { notice: goalStalledNotice(goal, value, input.language) } : {}),
      log,
    };
  }
  if (input.probeOnly) return { mode: "legacy", log: { goalGate: "no_check" } };
  const long = isLongRequest({
    goalTexts: input.goalTexts,
    workToolCalls,
    continuationIndex: run.continuationIndex,
    planToolUsedThisRun: ctx.state.planReminder.planToolUsedThisRun,
  });
  if (!long || input.stopAsked)
    return { mode: "legacy", log: { goalGate: long ? "stop_asked" : "simple" } };
  // A reply that says the whole request is done goes to the judge first: no extra part for it.
  const finishedWording = input.replyClaimsDone && !input.replyUnfinished;
  if (!ledger.nudgedRunId && !finishedWording && workToolCalls > 0) {
    ledger.nudgedRunId = runId;
    try {
      await saveGoalLedger(ctx, ledger);
    } catch {
      return { mode: "legacy", log: { goalGate: "ledger_error" } };
    }
    return {
      mode: "nudge",
      continueReason: "goal_check_missing",
      note: GOAL_CHECK_NUDGE,
      log: { goalGate: "nudge" },
    };
  }
  return judgeOrLegacy(ctx, input, workToolCalls);
}

async function judgeOrLegacy(
  ctx: RunContext,
  input: { goalTexts: string[]; replyText: string; planLines: string[]; stopAsked: boolean },
  workToolCalls: number,
): Promise<GoalGateResult> {
  const verdict = await runJudge(ctx, input);
  const action = decideJudgeGate({ verdict, workToolCalls, stopAsked: input.stopAsked });
  const log = {
    goalGate: "judge",
    judgeComplete: verdict?.complete,
    judgeReason: verdict?.reason,
    judgeAction: action,
  };
  if (action === "unavailable") return { mode: "legacy", log };
  if (action === "continue") {
    return {
      mode: "judge",
      continueReason: "judge_unfinished",
      note: verdict?.reason ? `Still missing (completion review): ${verdict.reason}` : undefined,
      log,
    };
  }
  return { mode: "judge", stop: verdict?.complete ? "judge_complete" : "judge_no_work", log };
}

/**
 * The model called continue_later itself: with a registered check, the check still decides.
 * Below target and moving: the request goes on with the goal note. Reached or not moving: it
 * ends. Without a check (or unmeasured), the model's request stands as before.
 */
export async function evaluateRequestedContinuation(
  ctx: RunContext,
  input: {
    stopAsked: boolean;
    language: "it" | "en";
    goalTexts?: string[];
    replyText?: string;
  },
): Promise<GoalGateResult> {
  let ledger: GoalLedger;
  try {
    ledger = await loadGoalLedger(ctx);
  } catch {
    return { mode: "legacy", log: { goalGate: "ledger_error" } };
  }
  if (!ledger.goal) return { mode: "legacy", log: { goalGate: "no_check" } };
  const result = await evaluateGoalGate(ctx, {
    goalTexts: input.goalTexts ?? [],
    replyText: input.replyText ?? "",
    replyClaimsDone: false,
    replyUnfinished: true,
    stopAsked: input.stopAsked,
    planLines: [],
    language: input.language,
    probeOnly: true,
  });
  return result;
}
