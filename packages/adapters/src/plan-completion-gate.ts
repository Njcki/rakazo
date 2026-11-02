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
  AUTO_PLAN_STEP_TITLE,
  completePlanFromTool,
  createPlanFromTool,
  ensureVerifyStep,
  getActivePlan,
  isVerifyStepTitle,
  type PlanDto,
  type PlanStepDto,
  type PlanToolDeps,
} from "./plan-tools.js";
import type { ContinueLaterRequest } from "./run-context.js";
import {
  AUTO_PLAN_MIN_TOOLS_FOR_LONG_REQUEST,
  autoPlanMinTools,
  claimsWholeTaskDone,
  closesWholeJob,
  isStandbyClose,
} from "./user-intent.js";

export type AutoContinuationReason =
  | "plan_open"
  | "verification_pending"
  | "tool_budget"
  | "plan_created"
  /** A part of a long task ended with a stand-by line, or only answered a side question. */
  | "close_attempt"
  /**
   * The user asked for the whole job ("fino al 100%"), the bot closed its plan for one batch
   * and the reply does not say the whole job is done.
   */
  | "goal_unfinished"
  /** The request's completion check (set_goal_check) is below its target and still moving. */
  | "goal_probe"
  /** A long request has no completion check: one part to register it. */
  | "goal_check_missing"
  /** No usable check: the completion review found the request unfinished. */
  | "judge_unfinished";

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

/** Summary of the plans the platform writes itself (see autoPlanInput). */
export const AUTO_PLAN_SUMMARY = "Created automatically: long task without a plan.";

export function isAutoPlan(plan: Pick<PlanDto, "summary"> | null | undefined): boolean {
  return Boolean(plan?.summary?.startsWith("Created automatically"));
}

/**
 * Whether the run's final answer already delivers the request although a plan is still open:
 * the reply says the whole task is done (without an unfinished count) and the open part is only
 * an automatic plan or the final verification. Then the request ends and the plan is closed.
 */
export function answeredInFull(input: {
  verdict: PlanGateVerdict;
  plan: PlanDto | null;
  replyText: string;
}): boolean {
  if (!input.verdict.open || !input.plan) return false;
  if (!closesWholeJob(input.replyText)) return false;
  if (isAutoPlan(input.plan)) return true;
  return input.verdict.openSteps.every((step) => isVerifyStepTitle(step.title));
}

/** Closes the plan a complete final answer satisfied (never throws). */
export async function closeAnsweredPlan(
  deps: PlanToolDeps,
  input: { spaceId: string; botId: string },
): Promise<boolean> {
  const closed = await completePlanFromTool(deps, {
    ...input,
    force: true,
    reason: "final answer delivered the request / risposta finale completa",
  }).catch(() => undefined);
  return Boolean(closed && "plan" in closed && !("error" in closed));
}

/**
 * An automatic part that did no real work (no tool besides plan/message tools) ends the chain
 * at once: another part would only repeat it. A part recovered after a restart (fence > 1)
 * starts from zero and is exempt, as is the tool-call limit.
 */
export function isNoProgressPart(input: {
  reason: AutoContinuationReason | undefined;
  continuationIndex: number;
  workToolCalls: number;
  fence: number;
  /** The part used the plan tools. */
  planToolUsedThisRun?: boolean;
  /** Work steps this part finished that no earlier part of the chain had finished. */
  freshDoneSteps?: number;
}): boolean {
  if (!input.reason || input.reason === "tool_budget") return false;
  if (input.continuationIndex <= 0 || input.fence > 1) return false;
  if (input.workToolCalls === 0) return true;
  // Progress is real state, not new wording: a part that worked on the plan but only closed
  // steps already done earlier in the chain (or only the automatic/verification step) redid
  // finished work.
  return Boolean(input.planToolUsedThisRun) && (input.freshDoneSteps ?? 0) === 0;
}

/** A plan step title compared across plans: case, spacing and punctuation do not matter. */
export function stepKey(title: string): string {
  return title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}]+/gu, " ")
    .trim();
}

const DONE = new Set(["done", "skipped"]);

export type ChainStepProgress = {
  /** Work steps finished in this part that no earlier part had finished. */
  fresh: string[];
  /** Work steps finished in this part that an earlier part had already finished. */
  redone: string[];
  /** Work steps finished before this part (newest first, unique). */
  doneBefore: string[];
};

/**
 * What the plans of this request say was really finished, per part: steps closed in this run
 * versus steps closed earlier in the chain. Automatic and verification steps never count.
 */
export function chainStepProgressOf(
  plans: readonly { steps: readonly { title: string; status: string; updatedAt: Date }[] }[],
  runStartedAt: Date,
): ChainStepProgress {
  const before = new Map<string, string>();
  const now = new Map<string, string>();
  for (const plan of plans) {
    for (const step of plan.steps) {
      if (!DONE.has(step.status)) continue;
      if (step.title === AUTO_PLAN_STEP_TITLE || isVerifyStepTitle(step.title)) continue;
      const key = stepKey(step.title);
      if (!key) continue;
      const target = step.updatedAt.getTime() >= runStartedAt.getTime() ? now : before;
      if (!target.has(key)) target.set(key, step.title);
    }
  }
  const fresh: string[] = [];
  const redone: string[] = [];
  for (const [key, title] of now) (before.has(key) ? redone : fresh).push(title);
  return { fresh, redone, doneBefore: [...before.values()] };
}

/** Loads the plans of this request (bot-wide, newest first) for chainStepProgressOf. */
export async function loadChainStepProgress(
  deps: PlanToolDeps,
  input: { spaceId: string; botId: string; chainStartedAt: Date; runStartedAt: Date },
): Promise<ChainStepProgress> {
  const plans = await deps.prisma.agentPlan.findMany({
    where: { spaceId: input.spaceId, botId: input.botId, updatedAt: { gte: input.chainStartedAt } },
    orderBy: { updatedAt: "desc" },
    take: 60,
    select: { steps: { select: { title: true, status: true, updatedAt: true } } },
  });
  return chainStepProgressOf(plans, input.runStartedAt);
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

/** The plan the platform writes for a long task the model did not plan. */
export function autoPlanInput(
  requestTexts: readonly string[],
  asides: readonly string[] = [],
): {
  title: string;
  summary: string;
  steps: { title: string; notes: string }[];
} {
  const request = requestTexts.join("\n").replace(/\s+/g, " ").trim();
  const side = asides.join(" | ").replace(/\s+/g, " ").trim();
  const title = request
    ? request.slice(0, 80) + (request.length > 80 ? "…" : "")
    : AUTO_PLAN_STEP_TITLE;
  return {
    title,
    summary: AUTO_PLAN_SUMMARY,
    steps: [
      {
        title: AUTO_PLAN_STEP_TITLE,
        notes: `Created automatically. The user's request: ${request.slice(0, 600) || "(see the conversation)"}${
          side
            ? `. Side questions asked during the work (answer them; they are not the goal): ${side.slice(0, 300)}`
            : ""
        }`,
      },
    ],
  };
}

/** Writes the automatic plan (replacing a stale one) and returns it with its verdict. */
export async function createAutoPlan(
  deps: PlanToolDeps,
  input: {
    spaceId: string;
    botId: string;
    userId: string;
    requestTexts: readonly string[];
    asides?: readonly string[];
    replaceActive: boolean;
    chainStartedAt: Date;
  },
): Promise<{ plan: PlanDto | null; verdict: PlanGateVerdict }> {
  const created = await createPlanFromTool(deps, {
    spaceId: input.spaceId,
    botId: input.botId,
    userId: input.userId,
    replaceActive: input.replaceActive,
    ...autoPlanInput(input.requestTexts, input.asides),
  });
  if ("error" in created) return { plan: null, verdict: { open: false, why: "no_plan" } };
  return {
    plan: created.plan,
    verdict: planGateVerdict({
      plan: created.plan,
      chainStartedAt: input.chainStartedAt,
      planToolUsedThisRun: true,
    }),
  };
}

/**
 * Whether a part of a long task (an automatic continuation) is closing the task without
 * finishing it: it ends with a stand-by line ("sono a disposizione per le prossime istruzioni")
 * or, right after a side question, it did almost no work, and it does not claim the whole job
 * done. The user asking to stop or change the work always lets it end.
 */
export function isCloseAttempt(input: {
  continuationIndex: number;
  /** Index 0 counts too when the request is a long task whose plan this run worked on. */
  longTaskPlanned?: boolean;
  replyText: string;
  workToolCalls: number;
  /** The latest user message of this request is a side question. */
  lastUserMessageIsAside: boolean;
  userAskedToStopOrChange: boolean;
}): boolean {
  if (input.continuationIndex <= 0 && !input.longTaskPlanned) return false;
  if (input.userAskedToStopOrChange) return false;
  const text = input.replyText.trim();
  if (claimsWholeTaskDone(text)) return false;
  if (text && isStandbyClose(text)) return true;
  return input.lastUserMessageIsAside && input.workToolCalls < AUTO_PLAN_MIN_TOOLS_FOR_LONG_REQUEST;
}

/**
 * Whether a "fino al 100%"-style request ends after one part of the job: the plan is closed
 * (finished batch, or no plan), real long-task work happened in this request, the user did not
 * ask to stop, and neither the reply nor the plan's verification notes say the whole job is
 * done ("completato al 100%") without an unfinished count ("337 su 4363").
 */
export function isGoalUnfinished(input: {
  wholeJobGoal: boolean;
  verdict: PlanGateVerdict;
  continuationIndex: number;
  planToolUsedThisRun: boolean;
  workToolCalls: number;
  replyText: string;
  verifyNotes?: string;
  userAskedToStopOrChange: boolean;
  minTools?: number;
}): boolean {
  if (!input.wholeJobGoal || input.userAskedToStopOrChange) return false;
  if (input.verdict.open || input.verdict.why === "all_blocked") return false;
  const worked =
    input.continuationIndex > 0 ||
    input.planToolUsedThisRun ||
    input.workToolCalls >= (input.minTools ?? autoPlanMinTools());
  if (!worked) return false;
  if (closesWholeJob(input.replyText)) return false;
  if (input.verifyNotes && closesWholeJob(input.verifyNotes)) return false;
  return true;
}

/** Notes of the verification step of the bot's latest plan (active or just closed). */
export async function latestVerifyNotes(
  deps: PlanToolDeps,
  input: { spaceId: string; botId: string; since: Date },
): Promise<string | undefined> {
  const row = await deps.prisma.agentPlan.findFirst({
    where: { spaceId: input.spaceId, botId: input.botId, updatedAt: { gte: input.since } },
    orderBy: { updatedAt: "desc" },
    select: { steps: { select: { title: true, notes: true, status: true } } },
  });
  const verify = row?.steps.find((step) => isVerifyStepTitle(step.title));
  return verify?.status === "done" ? verify.notes : undefined;
}
