/**
 * Progress cadence for long tool runs (self-host patch 0028).
 *
 * Gemini behind the OpenAI-compatible proxy picks a style in the first few
 * tool rounds and keeps it for the whole run: either a sentence of narration
 * before every tool call (about one chat message every 4 s) or pure tool calls
 * with nothing visible for 5-25 minutes. This module holds the env-configurable
 * thresholds and the pure bookkeeping used by the runtime to even that out:
 * - a nudge when too many tool calls or minutes pass with nothing the user can see;
 * - a throttle so narration is not promoted to a chat message after every tool;
 * - a plan reminder when a long run works without a plan of its own.
 */

function envInt(env: NodeJS.ProcessEnv, name: string, fallback: number, max: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(max, Math.floor(parsed));
}

export interface ProgressCadenceConfig {
  /** Nudge after this many tool calls with no visible output. 0 disables the tool trigger. */
  nudgeTools: number;
  /** Nudge after this many seconds with no visible output (needs 2+ tools since). 0 disables. */
  nudgeSeconds: number;
  /** Maximum cadence nudges per run. 0 disables the nudge entirely. */
  maxNudges: number;
  /** Promoted narration closer than this to the previous chat message stays transient. 0 disables. */
  narrationMinGapSeconds: number;
}

/**
 * PROGRESS_NUDGE_TOOLS (default 8), PROGRESS_NUDGE_SECONDS (default 150),
 * PROGRESS_NUDGE_MAX (default 8, 0 = off), PROGRESS_NARRATION_MIN_GAP_S (default 40, 0 = off).
 */
export function progressCadenceConfig(env: NodeJS.ProcessEnv = process.env): ProgressCadenceConfig {
  return {
    nudgeTools: envInt(env, "PROGRESS_NUDGE_TOOLS", 8, 1000),
    nudgeSeconds: envInt(env, "PROGRESS_NUDGE_SECONDS", 150, 86_400),
    maxNudges: envInt(env, "PROGRESS_NUDGE_MAX", 8, 100),
    narrationMinGapSeconds: envInt(env, "PROGRESS_NARRATION_MIN_GAP_S", 40, 3600),
  };
}

export interface PlanReminderConfig {
  /** Remind about an open plan step every N non-plan tool calls. 0 disables. */
  every: number;
  /** Ask for a plan once after N tool calls in a run that has no active plan. 0 disables. */
  createAfter: number;
}

/** PLAN_REMINDER_EVERY (default 4, 0 = off), PLAN_CREATE_NUDGE_TOOLS (default 4, 0 = off). */
export function planReminderConfig(env: NodeJS.ProcessEnv = process.env): PlanReminderConfig {
  return {
    every: envInt(env, "PLAN_REMINDER_EVERY", 4, 1000),
    createAfter: envInt(env, "PLAN_CREATE_NUDGE_TOOLS", 4, 1000),
  };
}

const PLAN_TOOL_PREFIX = "plan_";

/** Tools whose call is itself visible to the user (chat message or the Piano panel). */
export function isVisibleProgressTool(name: string): boolean {
  return name === "message_user" || name.startsWith(PLAN_TOOL_PREFIX);
}

/**
 * Per-run bookkeeping of "the user saw something". Visible: a message_user
 * call, narration text alongside a tool call, a plan update, or a reply to a
 * mid-run user message. Pure; time is passed in.
 */
export class ProgressCadenceTracker {
  private toolsSinceVisible = 0;
  private lastVisibleAt: number;
  private nudges = 0;
  private nudgePending = false;

  constructor(
    private readonly config: ProgressCadenceConfig,
    now: number,
  ) {
    this.lastVisibleAt = now;
  }

  onToolStart(name: string, now: number): void {
    if (isVisibleProgressTool(name)) {
      this.markVisible(now);
      return;
    }
    this.toolsSinceVisible += 1;
  }

  /** Narration or a text answer the user can read. */
  onVisibleText(now: number): void {
    this.markVisible(now);
  }

  /** A mid-run user message resets the clock: the steering note already asks for a reply. */
  onSteering(now: number): void {
    this.markVisible(now);
  }

  /** True once after a nudge until the model shows something again. */
  get pending(): boolean {
    return this.nudgePending;
  }

  get stats(): { toolsSinceVisible: number; nudges: number } {
    return { toolsSinceVisible: this.toolsSinceVisible, nudges: this.nudges };
  }

  /** Returns the nudge text when one is due, and counts it. */
  takeNudge(now: number): string | undefined {
    const { nudgeTools, nudgeSeconds, maxNudges } = this.config;
    if (maxNudges <= 0 || this.nudges >= maxNudges) return undefined;
    const silentMs = now - this.lastVisibleAt;
    const byTools = nudgeTools > 0 && this.toolsSinceVisible >= nudgeTools;
    const byTime =
      nudgeSeconds > 0 && this.toolsSinceVisible >= 2 && silentMs >= nudgeSeconds * 1000;
    if (!byTools && !byTime) return undefined;
    this.nudges += 1;
    this.nudgePending = true;
    const prompt = progressNudgePrompt(this.toolsSinceVisible, Math.round(silentMs / 60_000));
    // Re-arm: if the model ignores the note, the next one waits a full interval.
    this.toolsSinceVisible = 0;
    this.lastVisibleAt = now;
    return prompt;
  }

  /** The turn after a nudge called tools: the nudge is no longer awaiting a reply. */
  onToolTurnEnd(): void {
    this.nudgePending = false;
  }

  private markVisible(now: number): void {
    this.toolsSinceVisible = 0;
    this.lastVisibleAt = now;
    this.nudgePending = false;
  }
}

export function progressNudgePrompt(tools: number, minutes: number): string {
  const span = minutes >= 1 ? `${tools} tool calls (about ${minutes} min)` : `${tools} tool calls`;
  return (
    `[Runtime note, not from the user: ${span} have passed with nothing the user can see. ` +
    "Together with your next tool call, send ONE short progress line with message_user in the user's language " +
    "(one or two sentences: what is done, what comes next). If there is an active plan, also mark the finished or current step with plan_update_step. " +
    "Then keep working with tools: this note is not a reason to stop, summarize, or ask anything. Do not mention this note.]"
  );
}

/** Text-only reply right after a cadence nudge: it was a status line, not the end of the task. */
export function progressNudgeContinuePrompt(allowSilentEmpty?: boolean): string {
  return (
    "That was a progress update, but no tool was called, so the task is paused. " +
    "Continue the original task now with native tool calls; do not repeat the update. " +
    "If the task is actually complete, write the final answer to the user instead, as a conclusion." +
    (allowSilentEmpty
      ? " If you were instructed to stay silent when there is nothing to report, follow that instruction for the entire final assistant reply."
      : "")
  );
}

/**
 * Whether promoted narration should become a durable chat message. Narration
 * that follows the previous chat message by less than the gap stays a live,
 * transient progress line instead (the user still sees it while it streams).
 */
export function shouldPromoteNarration(input: {
  now: number;
  lastDurableAt: number | undefined;
  minGapSeconds: number;
  steeringSinceDurable: boolean;
}): boolean {
  if (input.minGapSeconds <= 0) return true;
  if (input.steeringSinceDurable) return true;
  if (input.lastDurableAt === undefined) return true;
  return input.now - input.lastDurableAt >= input.minGapSeconds * 1000;
}

export const PLAN_CREATE_REMINDER =
  "PLAN REMINDER: this run has no active plan (a completed plan in context belongs to an earlier request and does not cover this one). " +
  "If this request needs 3 or more further steps, call plan_create now with ordered steps (a follow-up, a format conversion, or a fix counts as new work), " +
  "then keep steps updated with plan_update_step. If it is nearly done, just finish.";
