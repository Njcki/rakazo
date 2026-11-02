/**
 * Completion gate: a run that is about to end while the bot's plan still has open work, or while
 * the plan's final verification step is not ticked, does not just end. It schedules the next
 * part through the same chain as continue_later, with the same max length and no-progress guard.
 * A run that stopped at the per-turn tool-call limit continues the same way, plan or not.
 *
 * Only completed runs reach the gate: failed, cancelled (Stop) and handed-off runs never
 * continue, and Stop on a queued continuation cancels the chain as before.
 */
import {
  type ContinuationChain,
  type ContinueLaterSettings,
  decideContinuation,
} from "./continue-later.js";
import {
  ensureVerifyStep,
  getActivePlan,
  isVerifyStepTitle,
  type PlanDto,
  type PlanStepDto,
  type PlanToolDeps,
} from "./plan-tools.js";
import type { ContinueLaterRequest } from "./run-context.js";

export type AutoContinuationReason = "plan_open" | "verification_pending" | "tool_budget";

export type PlanGateVerdict =
  | { open: true; reason: "plan_open" | "verification_pending"; openSteps: PlanStepDto[] }
  | { open: false; why: "no_plan" | "not_active" | "stale" | "all_closed" | "all_blocked" };

const OPEN = new Set(["todo", "in_progress", "blocked"]);

/**
 * Whether the plan keeps the task going. A plan nobody touched since this request started (an
 * old plan, or one from another conversation of the same bot) never does, and neither does one
 * whose open steps are all blocked: that needs the user, not another run.
 */
export function planGateVerdict(input: {
  plan: PlanDto | null;
  chainStartedAt: Date;
  planToolUsedThisRun: boolean;
}): PlanGateVerdict {
  const { plan } = input;
  if (!plan) return { open: false, why: "no_plan" };
  if (plan.status !== "active") return { open: false, why: "not_active" };
  const touchedAt = Math.max(
    Date.parse(plan.updatedAt),
    ...plan.steps.map((step) => Date.parse(step.updatedAt)),
  );
  if (!input.planToolUsedThisRun && !(touchedAt >= input.chainStartedAt.getTime())) {
    return { open: false, why: "stale" };
  }
  const openSteps = plan.steps.filter((step) => OPEN.has(step.status));
  const verify = plan.steps.find((step) => isVerifyStepTitle(step.title));
  if (openSteps.length === 0 && verify) return { open: false, why: "all_closed" };
  const work = openSteps.filter((step) => !isVerifyStepTitle(step.title));
  // The verification step waits on the others by design; only explicit "blocked" stops the gate.
  if (work.length > 0 && work.every((step) => step.status === "blocked")) {
    return { open: false, why: "all_blocked" };
  }
  if (work.length === 0 && verify?.status === "blocked") return { open: false, why: "all_blocked" };
  return {
    open: true,
    reason: work.length > 0 ? "plan_open" : "verification_pending",
    openSteps,
  };
}

/** One line of plan progress for the next part's summary (and the loop guard's digest). */
export function planProgressLine(plan: PlanDto): string {
  const open = plan.steps.filter((step) => OPEN.has(step.status));
  return `Plan «${plan.title}»: ${plan.progress.done}/${plan.progress.total} steps closed; open: ${open
    .map((step) => `${step.index}. ${step.title} (${step.status})`)
    .join("; ")
    .slice(0, 600)}`;
}

/** Whether the reply carries the runtime's "stopped at the tool-call limit" note. */
export function hitToolCallBudget(
  replyText: string,
  limit: number,
  budgetMessage: string,
): boolean {
  return limit > 0 && replyText.includes(budgetMessage);
}

export type GateDecision =
  | { kind: "none" }
  | { kind: "continue"; request: ContinueLaterRequest }
  | { kind: "refused"; refused: { state: "limit" | "no_progress"; index: number; max: number } };

/** Pure: given what ended, schedule the next part or say why the chain stops. */
export function decideAutoContinuation(input: {
  runId: string;
  chain: ContinuationChain;
  settings: Pick<ContinueLaterSettings, "maxContinuations" | "maxRepeats">;
  workToolCalls: number;
  reason: AutoContinuationReason | undefined;
  replyText: string;
  progressLine: string | undefined;
  maxSummaryChars: number;
}): GateDecision {
  if (!input.reason) return { kind: "none" };
  const text = input.replyText.trim();
  const summary = [text.slice(0, Math.max(0, input.maxSummaryChars - 700)), input.progressLine]
    .filter((part): part is string => Boolean(part?.trim()))
    .join("\n\n")
    .slice(0, input.maxSummaryChars);
  const decision = decideContinuation({
    runId: input.runId,
    chain: input.chain,
    summary: summary || `Stopped: ${input.reason}`,
    percent: null,
    workToolCalls: input.workToolCalls,
    settings: input.settings,
  });
  if (!decision.ok) {
    return {
      kind: "refused",
      refused: { state: decision.reason, index: decision.index, max: decision.max },
    };
  }
  return {
    kind: "continue",
    request: {
      summary: summary || `Stopped: ${input.reason}`,
      reason: input.reason,
      index: decision.index,
      max: decision.max,
      rootRunId: decision.rootRunId,
      digest: decision.digest,
      repeats: decision.repeats,
      percent: decision.percent,
      auto: input.reason,
    },
  };
}

/** The bot's active plan, with its verification step, and the verdict for this chain. */
export async function loadPlanGate(
  deps: PlanToolDeps,
  input: {
    spaceId: string;
    botId: string;
    chainStartedAt: Date;
    planToolUsedThisRun: boolean;
  },
): Promise<{ plan: PlanDto | null; verdict: PlanGateVerdict }> {
  const stored = await getActivePlan(deps, { spaceId: input.spaceId, botId: input.botId });
  const first = planGateVerdict({ ...input, plan: stored });
  // Old plans get their verification step only when they matter for this request.
  if (!stored || !first.open) return { plan: stored, verdict: first };
  const plan = await ensureVerifyStep(deps, input, stored);
  return { plan, verdict: planGateVerdict({ ...input, plan }) };
}
