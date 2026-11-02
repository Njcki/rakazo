import { createHash } from "node:crypto";
import type { MessageBlock } from "@rakazo/contracts";
import type { ExecutorDeps } from "./executor-deps.js";

/**
 * Explicit continuation (`continue_later`): the model ends this run with a short progress
 * summary and the platform queues the next part of the same request as a new run. The chain is
 * durable (a queued run with `wakeAt`), bounded (a hard cap per original request and a loop
 * guard) and stops with the user's Stop, an error or a cancellation.
 */
export const CONTINUE_LATER_TOOL = "continue_later";

/** Triggers whose runs may continue themselves. The continuation keeps the same trigger. */
export const CONTINUE_LATER_TRIGGERS: ReadonlySet<string> = new Set([
  "user",
  "follow_up",
  "messaging",
  "webhook",
  "routine",
]);

export const CONTINUE_LATER_SUMMARY_MAX_CHARS = 2_000;
export const CONTINUE_LATER_REASON_MAX_CHARS = 300;

const DEFAULT_MAX_CONTINUATIONS = 50;
const MAX_MAX_CONTINUATIONS = 500;
const DEFAULT_DELAY_MS = 5_000;
const MAX_DELAY_MS = 60 * 60 * 1000;
const DEFAULT_MAX_REPEATS = 3;

export interface ContinueLaterSettings {
  enabled: boolean;
  /** Continuations allowed per original request (not counting the original run). */
  maxContinuations: number;
  /** Delay before a continuation may start. */
  delayMs: number;
  /** Consecutive continuations without progress before the chain stops. */
  maxRepeats: number;
}

function envInt(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function envFlag(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (["0", "false", "off", "no"].includes(raw)) return false;
  if (["1", "true", "on", "yes"].includes(raw)) return true;
  return fallback;
}

/**
 * Per-bot cap override: `CONTINUE_LATER_MAX_BY_BOT="<botId>=<n>,<botId>=<n>"`. 0 turns the tool
 * off for that bot. Malformed entries are ignored.
 */
export function perBotMaxContinuations(
  env: NodeJS.ProcessEnv,
  botId: string | undefined,
): number | undefined {
  const raw = env.CONTINUE_LATER_MAX_BY_BOT?.trim();
  if (!raw || !botId) return undefined;
  for (const entry of raw.split(/[,;\s]+/)) {
    const [id, value] = entry.split(/[=:]/);
    if (id?.trim() !== botId || value === undefined) continue;
    const parsed = Number(value.trim());
    if (!Number.isFinite(parsed) || parsed < 0) return undefined;
    return Math.min(MAX_MAX_CONTINUATIONS, Math.floor(parsed));
  }
  return undefined;
}

export function continueLaterSettings(
  env: NodeJS.ProcessEnv = process.env,
  botId?: string,
): ContinueLaterSettings {
  const max =
    perBotMaxContinuations(env, botId) ??
    envInt(env, "CONTINUE_LATER_MAX", DEFAULT_MAX_CONTINUATIONS, 0, MAX_MAX_CONTINUATIONS);
  return {
    enabled: envFlag(env, "CONTINUE_LATER_ENABLED", true) && max > 0,
    maxContinuations: max,
    delayMs: envInt(env, "CONTINUE_LATER_DELAY_MS", DEFAULT_DELAY_MS, 0, MAX_DELAY_MS),
    maxRepeats: envInt(env, "CONTINUE_LATER_MAX_REPEATS", DEFAULT_MAX_REPEATS, 1, 20),
  };
}

/** Whether a run of this shape may offer continue_later at all. */
export function continueLaterEligible(input: {
  settings: ContinueLaterSettings;
  trigger: string;
  voiceCall: boolean;
  /** A delegated bot-to-bot request answers its sender, not the owner. */
  peerMessage: boolean;
}): boolean {
  return (
    input.settings.enabled &&
    CONTINUE_LATER_TRIGGERS.has(input.trigger) &&
    !input.voiceCall &&
    !input.peerMessage
  );
}

/** Hash of a normalized summary. Only the hash is stored, never the text. */
export function continuationDigest(summary: string): string {
  const normalized = summary
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}]+/gu, " ")
    .trim();
  return createHash("sha256").update(normalized).digest("hex").slice(0, 32);
}

export interface ContinuationChain {
  continuationIndex: number;
  continuationRootRunId: string | null;
  continuationDigest: string | null;
  continuationRepeats: number;
  continuationPercent: number | null;
}

export type ContinuationDecision =
  | {
      ok: true;
      index: number;
      max: number;
      rootRunId: string;
      digest: string;
      repeats: number;
      percent: number | null;
    }
  | { ok: false; reason: "limit"; index: number; max: number }
  | { ok: false; reason: "no_progress"; index: number; max: number; repeats: number };

/**
 * The next link of a chain, or why there is none. A link without progress repeats the last
 * summary, lowers or keeps the reported percent, or did no work besides reporting; after
 * `maxRepeats` such links in a row the chain stops.
 */
export function decideContinuation(input: {
  runId: string;
  chain: ContinuationChain;
  summary: string;
  percent?: number | null;
  workToolCalls: number;
  settings: Pick<ContinueLaterSettings, "maxContinuations" | "maxRepeats">;
}): ContinuationDecision {
  const { chain, settings } = input;
  const index = chain.continuationIndex + 1;
  const max = settings.maxContinuations;
  if (index > max) return { ok: false, reason: "limit", index, max };
  const digest = continuationDigest(input.summary);
  const percent = normalizePercent(input.percent);
  const previousPercent = chain.continuationPercent;
  const noProgress =
    chain.continuationIndex > 0 &&
    (digest === chain.continuationDigest ||
      input.workToolCalls === 0 ||
      (percent !== null && previousPercent !== null && percent <= previousPercent));
  const repeats = noProgress ? chain.continuationRepeats + 1 : 0;
  if (repeats >= settings.maxRepeats) {
    return { ok: false, reason: "no_progress", index, max, repeats };
  }
  return {
    ok: true,
    index,
    max,
    rootRunId: chain.continuationRootRunId ?? input.runId,
    digest,
    repeats,
    percent,
  };
}

export function normalizePercent(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).replace("%", ""));
  if (!Number.isFinite(parsed)) return null;
  return Math.min(100, Math.max(0, Math.round(parsed)));
}

/** The note a continuation run starts from. It carries no user content. */
export function continuationPrompt(input: {
  index: number;
  max: number;
  auto?:
    | "plan_open"
    | "verification_pending"
    | "tool_budget"
    | "plan_created"
    | "close_attempt"
    | "goal_unfinished";
  /** Plan steps already finished in this request (model-written titles). */
  doneSteps?: readonly string[];
}): string {
  const done = (input.doneSteps ?? [])
    .map((title) => title.replace(/\s+/g, " ").trim().slice(0, 100))
    .filter(Boolean)
    .slice(0, 30);
  return [
    `[Continuation ${input.index} of max ${input.max}: resume the task from where you left off.]`,
    ...(input.auto ? [AUTO_CONTINUATION_NOTES[input.auto]] : []),
    ...(done.length
      ? [
          `These plan steps are already DONE in this task. Do not redo, re-verify or re-report them; move to the next unfinished part of the work: ${done
            .map((title) => `«${title}»`)
            .join("; ")}. A part that only repeats finished steps ends the task.`,
        ]
      : []),
    "This run continues your own earlier work on the user's request; nobody wrote a new message. " +
      "Use the conversation, your plan (if any) and the progress summary you left to pick up the next unfinished step. " +
      "Do not redo finished steps and do not re-announce the task. " +
      "If more work still remains after this part, call continue_later again with a fresh summary; " +
      "when everything is done, reply with the final result and say clearly that the whole task is complete (e.g. 'Lavoro completato al 100%').",
  ].join("\n");
}

const AUTO_CONTINUATION_NOTES = {
  plan_open:
    "The previous part ended while your plan still had open steps, so the platform continued it automatically. Call plan_status, then keep working on the next open step. The task is finished only when every step is closed and the final verification step is ticked after checking the user's original request. If you truly need the user, use ask_user; if the user cancelled the rest, close the plan with plan_complete force=true and their reason.",
  verification_pending:
    "The previous part ended before the plan's final verification step was ticked, so the platform continued it automatically. Set that step in_progress to get the user's original request, check every requested goal against the real result, and either tick it (verified=true, with evidence) or add and do the missing work.",
  plan_created:
    "The previous part did multi-step work without a plan and ended, so the platform created a plan for it and continued automatically. Call plan_status. Replace the generic plan with the real remaining steps (plan_create with replaceActive=true), or, if the work is truly finished, tick its step and then the final verification step after checking the user's original request. Do not stop before that.",
  tool_budget:
    "The previous part stopped at the tool-call limit for one turn, so the platform continued it automatically. Pick up exactly where it stopped.",
  close_attempt:
    "The previous part ended the long task without finishing it: it only answered a side question, or closed with a stand-by line (e.g. 'sono a disposizione per le prossime istruzioni'). A question the user asks during the work is answered on the way; it never completes or replaces the original request. Call plan_status, then resume the original request from its next unfinished part (make a plan of the remaining work if there is none). If the whole original request is really finished, tick the verification step with evidence against it and say clearly that the whole task is complete.",
  goal_unfinished:
    "The previous part finished one batch and closed its plan, but the user asked for the whole job (e.g. 'fino al 100%'), and the reply did not say the whole job is done, so the platform continued it automatically. A finished batch, chunk or plan is not the end of the job. Call plan_status: the platform's plan quotes the user's request. Replace it with the real next part of the remaining work (plan_create replaceActive=true) and keep the final verification step. Only when the whole job is done (every item, 100%), tick the verification step with evidence against the original request and say clearly 'Lavoro completato al 100%' (or 'The whole task is complete'). If something needs the user, use ask_user.",
} as const;

/**
 * For runs that do not read the thread (routines) or only see their own channel replies, the
 * previous part's summary goes into the prompt instead.
 */
export function continuationProgressContext(summary: string): string {
  return `Progress summary you left at the end of the previous part:\n<<<\n${summary.trim()}\n>>>`;
}

export const CONTINUE_LATER_GUIDANCE =
  "Long tasks: if real work remains that you will not finish in this turn (for example a long batch, many files, or a multi-step plan), call continue_later with a short progress summary (and percent if known) instead of writing a final answer: the platform ends this turn and starts the next part automatically. " +
  "Never promise in a final answer that you will continue, proceed, or keep working later (e.g. 'continuo…', 'proseguo…', 'I'll continue…'): a final answer ends the task and nothing runs afterwards. " +
  "Without continue_later, your final answer must say clearly that the task is done, or that it stopped and why (and what is left). " +
  "A question or aside the user sends while you work is answered briefly and the task goes on: it never completes or replaces the original request. While work remains, never end with a stand-by line such as 'sono a disposizione per le prossime istruzioni' or 'let me know how to proceed'.";

export const CONTINUE_LATER_UNAVAILABLE_GUIDANCE =
  "Never promise in a final answer that you will continue, proceed, or keep working later (e.g. 'continuo…', 'proseguo…', 'I'll continue…'): a final answer ends the task and nothing runs afterwards. " +
  "Say clearly that the task is done, or that it stopped and why (and what is left), so the user can ask you to go on.";

/** Fallback text of the status line under the summary; the web app shows a translated one. */
export function continuationMetaText(meta: ContinuationMeta): string {
  const percent = meta.percent === undefined ? "" : ` · ${meta.percent}%`;
  switch (meta.state) {
    case "scheduled":
      return `Continuing automatically (${meta.index}/${meta.max})${percent}`;
    case "limit":
      return `Automatic continuation stopped: limit reached (${meta.max})`;
    case "no_progress":
      return "Automatic continuation stopped: no progress";
    case "superseded":
      return "Automatic continuation skipped: other work is in progress";
  }
}

export interface ContinuationMeta {
  state: "scheduled" | "limit" | "no_progress" | "superseded";
  index: number;
  max: number;
  percent?: number;
}

/** The text of the last reply of the run being continued (its progress summary). */
export async function loadContinuationProgress(
  deps: Pick<ExecutorDeps, "prisma">,
  threadId: string,
  previousRunId: string,
): Promise<string | undefined> {
  const messages = await deps.prisma.message.findMany({
    where: { threadId, runId: previousRunId, role: "bot" },
    orderBy: { seq: "desc" },
    take: 3,
    select: { blocks: true },
  });
  for (const message of messages) {
    const text = (message.blocks as MessageBlock[])
      .flatMap((block) => (block.kind === "text" ? [block.text] : []))
      .join("\n\n")
      .trim();
    if (text) return text.slice(0, 4 * CONTINUE_LATER_SUMMARY_MAX_CHARS);
  }
  return undefined;
}
