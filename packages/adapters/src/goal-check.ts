/**
 * Objective ledger of a long request: the bot registers a machine-checkable completion probe
 * (`set_goal_check`) and the completion gate measures it itself after every part. The probe is
 * the source of truth for "is the whole request done?"; plan state and reply wording are only
 * advisory. Without a probe the gate asks for one once, then falls back to a short judge.
 * Pure logic only (no database, no computer); see goal-gate.ts for the wiring.
 */

export const SET_GOAL_CHECK_TOOL = "set_goal_check";
/** Wall-clock cap for one probe run, at registration and in the gate. */
export const GOAL_PROBE_TIMEOUT_MS = 20_000;
const MAX_READINGS = 80;
const MAX_DESCRIPTION = 300;
const MAX_PROBE = 1_000;

export type GoalProbeKind = "number" | "exit";

export interface GoalReading {
  runId: string;
  index: number;
  value: number;
  at: string;
  /** Measured by the gate after the part (true) or by the tool at registration (false). */
  gate: boolean;
}

export interface GoalCheck {
  description: string;
  probe: string;
  kind: GoalProbeKind;
  target: number;
  unit?: string;
  registeredRunId: string;
  registeredAt: string;
  /** How many times the check was replaced by a different probe in this request. */
  changes?: number;
  readings: GoalReading[];
}

/** A request may replace its check a few times; endless swaps would dodge the stall check. */
export const MAX_GOAL_CHECK_CHANGES = 3;

/** Stored as JSON on the root run of the chain (runs.continuationGoal). */
export interface GoalLedger {
  v: 1;
  goal?: GoalCheck;
  /** The run whose gate asked the bot to register a probe (asked once per request). */
  nudgedRunId?: string;
  /** registeredAt of the check whose "reached" the completion review disputed (once per check). */
  disputed?: string;
}

export function parseGoalLedger(raw: unknown): GoalLedger {
  if (!raw || typeof raw !== "object") return { v: 1 };
  const value = raw as Partial<GoalLedger>;
  const goal = value.goal;
  const valid =
    goal &&
    typeof goal.probe === "string" &&
    typeof goal.target === "number" &&
    Number.isFinite(goal.target) &&
    (goal.kind === "number" || goal.kind === "exit");
  return {
    v: 1,
    ...(valid
      ? { goal: { ...goal, readings: Array.isArray(goal.readings) ? goal.readings : [] } }
      : {}),
    ...(typeof value.nudgedRunId === "string" ? { nudgedRunId: value.nudgedRunId } : {}),
    ...(typeof value.disputed === "string" ? { disputed: value.disputed } : {}),
  };
}

export type GoalCheckArgs =
  | {
      ok: true;
      description: string;
      probe: string;
      kind: GoalProbeKind;
      target: number;
      unit?: string;
    }
  | { ok: false; error: string };

export function parseGoalCheckArgs(args: Record<string, unknown>): GoalCheckArgs {
  const description = String(args.description ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_DESCRIPTION);
  const probe = String(args.probe ?? "").trim();
  const kind: GoalProbeKind = args.kind === "exit" ? "exit" : "number";
  const unit = String(args.unit ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
  if (!description) return { ok: false, error: "description is required" };
  if (!probe) return { ok: false, error: "probe is required: a read-only shell command" };
  if (probe.length > MAX_PROBE)
    return { ok: false, error: `probe is longer than ${MAX_PROBE} characters` };
  let target = 1;
  if (kind === "number") {
    target =
      typeof args.target === "number"
        ? args.target
        : Number(String(args.target ?? "").replace(",", "."));
    if (!Number.isFinite(target) || target <= 0) {
      return {
        ok: false,
        error: "target must be a positive number (the value that means the whole task is done)",
      };
    }
  }
  return { ok: true, description, probe, kind, target, ...(unit ? { unit } : {}) };
}

/**
 * The probe's value: for a number probe the last number it printed (exit code 0 only); for an
 * exit probe 1 when it exited 0, else 0. Undefined when nothing usable came out.
 */
export function parseProbeOutput(
  kind: GoalProbeKind,
  stdout: string,
  code: number | null,
): number | undefined {
  if (kind === "exit") return code === null ? undefined : code === 0 ? 1 : 0;
  if (code !== 0) return undefined;
  const numbers = stdout.match(/-?\d+(?:[.,]\d+)?/g);
  const last = numbers?.at(-1);
  if (!last) return undefined;
  const value = Number(last.replace(",", "."));
  return Number.isFinite(value) ? value : undefined;
}

export function goalReached(goal: Pick<GoalCheck, "target">, value: number): boolean {
  return value >= goal.target;
}

/** The last value the gate measured after an earlier part of this request. */
export function previousGateReading(goal: GoalCheck, runId: string): GoalReading | undefined {
  return goal.readings.filter((reading) => reading.gate && reading.runId !== runId).at(-1);
}

export function withReading(goal: GoalCheck, reading: GoalReading): GoalCheck {
  const readings = [
    ...goal.readings.filter((r) => !(r.gate && r.runId === reading.runId && reading.gate)),
    reading,
  ];
  return { ...goal, readings: readings.slice(-MAX_READINGS) };
}

export type GoalGateAction =
  /** Below target and moving (or first measurement): the request continues. */
  | "continue"
  /** Target reached: the request ends with the final answer. */
  | "reached"
  /** The value did not increase since the previous part: stop and say where it stands. */
  | "stalled"
  /** The user asked to stop or change the work. */
  | "stop_asked"
  /** The probe could not be measured: the gate falls back to the judge. */
  | "unmeasured";

/**
 * What the probe says about this part. A number probe must grow from one part to the next;
 * an exit probe cannot grow before it passes, so it stalls only on a part with no real work.
 */
export function decideGoalGate(input: {
  goal: GoalCheck;
  value: number | undefined;
  previous: number | undefined;
  workToolCalls: number;
  continuationIndex: number;
  stopAsked: boolean;
}): GoalGateAction {
  if (input.stopAsked) return "stop_asked";
  if (input.value === undefined) return "unmeasured";
  if (goalReached(input.goal, input.value)) return "reached";
  if (input.goal.kind === "number") {
    if (input.previous !== undefined && input.value <= input.previous) return "stalled";
  } else if (input.continuationIndex > 0 && input.workToolCalls === 0) {
    return "stalled";
  }
  return "continue";
}

export function goalPercent(goal: GoalCheck, value: number): number | null {
  if (goal.kind !== "number" || goal.target <= 0) return null;
  return Math.max(0, Math.min(100, Math.floor((value / goal.target) * 100)));
}

function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

/** One line for the progress summary and the next part: goal, probe, value and target. */
export function goalProgressLine(goal: GoalCheck, value: number | undefined): string {
  const unit = goal.unit ? ` ${goal.unit}` : "";
  const now =
    value === undefined
      ? "could not be measured"
      : goal.kind === "exit"
        ? value >= 1
          ? "passes"
          : "does not pass yet"
        : `${formatValue(value)} of ${formatValue(goal.target)}${unit}`;
  return `Completion check: ${goal.description} — now ${now}.`;
}

/** What the next part reads about the goal: it ends only when the probe reaches the target. */
export function goalContinuationNote(goal: GoalCheck, value: number | undefined): string {
  return [
    `Goal of this request: ${goal.description}`,
    `Completion check (run by the platform after every part): \`${goal.probe}\` → ${
      value === undefined ? "not measured" : formatValue(value)
    }; the request is complete only at ${goal.kind === "exit" ? "exit code 0" : `>= ${formatValue(goal.target)}`}.`,
    "Work on the next unfinished part so the check moves forward. Redoing or re-verifying finished parts does not move it, and a part after which the check has not moved ends the request. Closing a plan or saying it is done does not end it either: only the check does. Fix the check with set_goal_check only if it measures the wrong thing.",
  ].join("\n");
}

/** The one-time request to register a probe on a long task that has none. */
export const GOAL_CHECK_NUDGE =
  "This is a long request and it has no completion check yet. First call set_goal_check: a short description of the whole goal, a read-only shell command (probe) that prints the current progress of the WHOLE request as one number (for example how many items are finished, by counting files or lines), and the target number that means everything is done — the total of the ENTIRE request, never the current batch. If no number fits, use kind=exit with a command that exits 0 only when everything is done. Then continue the work.";

/** Guidance in the system prompt next to continue_later. */
export const GOAL_CHECK_GUIDANCE =
  "For a long request (many items, batches, 'fino al 100%', work over several parts) call set_goal_check early with a read-only probe that measures progress of the WHOLE request and its target: after every part the platform runs it, continues while it is below the target and moving, and stops when it reaches the target or stops moving. A finished batch, sub-plan or closed plan does not end the request. The target is the TOTAL of the entire request the user asked for (all items of the whole job, e.g. every line or file to finish), never the current batch, step or what is already done: a check whose value already equals its target is refused. Reaching the target alone does not end the request: the completion review and the plan must agree. Simple questions need no check.";

/** Bilingual notice appended when the probe did not move: honest status, no promise. */
export function goalStalledNotice(goal: GoalCheck, value: number, language: "it" | "en"): string {
  const unit = goal.unit ? ` ${goal.unit}` : "";
  const where =
    goal.kind === "exit"
      ? language === "it"
        ? "il controllo di completamento non è ancora superato"
        : "the completion check does not pass yet"
      : `${formatValue(value)} / ${formatValue(goal.target)}${unit}`;
  return language === "it"
    ? `Mi fermo qui: in quest'ultima parte il lavoro non è avanzato (${where}). Scrivimi se devo riprendere o cambiare approccio.`
    : `I am stopping here: this last part made no progress (${where}). Tell me if I should resume or change approach.`;
}

// ---------------------------------------------------------------------------
// Fallback judge for a long request without a usable probe.

export interface JudgeVerdict {
  complete: boolean;
  reason: string;
}

export const JUDGE_TIMEOUT_MS = 10_000;

export function buildJudgePrompt(input: {
  goalTexts: readonly string[];
  replyText: string;
  planLines: readonly string[];
  /** The bot's own completion check and its reading, when it claims the target is reached. */
  checkLine?: string;
}): { instructions: string; prompt: string } {
  const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);
  return {
    instructions:
      'You check whether an assistant has completed the WHOLE request of its user. Answer with JSON only: {"complete": true|false, "reason": "<short reason>"}. complete=true only when the final reply delivers everything the user asked (every item, the whole scope, "fino al 100%" means all of it). A finished batch, sub-task or plan of part of the work is not complete. A clear final answer to a simple question is complete. If the reply says work remains, is partial, or gives a fraction below the whole, it is not complete.',
    prompt: [
      "User request (oldest first):",
      ...input.goalTexts.slice(-6).map((text) => `<<<\n${clip(text.trim(), 1500)}\n>>>`),
      input.planLines.length ? `Plan:\n${input.planLines.slice(0, 20).join("\n")}` : "Plan: none",
      ...(input.checkLine
        ? [
            `The assistant's own completion check says its target is reached: ${input.checkLine} The assistant chose this check and target itself; judge against the user's request, not against the check.`,
          ]
        : []),
      `Final reply of this part:\n<<<\n${clip(input.replyText.trim(), 3000)}\n>>>`,
    ].join("\n\n"),
  };
}

export function parseJudgeVerdict(text: string | undefined): JudgeVerdict | undefined {
  if (!text) return undefined;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(match[0]) as { complete?: unknown; reason?: unknown };
    if (typeof parsed.complete !== "boolean") return undefined;
    return { complete: parsed.complete, reason: String(parsed.reason ?? "").slice(0, 200) };
  } catch {
    return undefined;
  }
}

/** Without a probe: continue only when the judge says unfinished and the part did real work. */
export function decideJudgeGate(input: {
  verdict: JudgeVerdict | undefined;
  workToolCalls: number;
  stopAsked: boolean;
}): "continue" | "end" | "unavailable" {
  if (input.stopAsked) return "end";
  if (!input.verdict) return "unavailable";
  if (input.verdict.complete) return "end";
  return input.workToolCalls > 0 ? "continue" : "end";
}

/** set_goal_check refuses a check that already reads "done": it would end the request at once. */
export function goalAlreadyReachedError(value: number, target: number): string {
  return `The check already reads ${formatValue(value)} with target ${formatValue(target)}, so it would end the request right now. A completion check must measure what is still left of the WHOLE request the user asked for (for example the total number of items in the request, not the batch just finished). Nothing was registered. If the whole request really is complete, do not register a check: give the final answer.`;
}

/** Next part's note when the review disputed a reached check. */
export function goalDisputedNote(
  goal: GoalCheck,
  value: number,
  reason: string,
  changesLeft = true,
): string {
  return [
    `Your completion check (\`${goal.probe}\` → ${formatValue(value)}, target ${formatValue(goal.target)}) covers only part of the request: it says done, but the completion review of the WHOLE original request says it is not${reason ? `: ${reason}` : "."}`,
    changesLeft
      ? "Call set_goal_check again with a probe and a target that is the total of the ENTIRE request the user asked for (not the current batch or step), then continue the work."
      : "The check can no longer be replaced: continue the work on the rest of the request; the review decides when it is complete.",
    "If the request truly is complete, say so plainly with the evidence.",
  ].join("\n");
}
