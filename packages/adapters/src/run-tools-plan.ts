import {
  addPlanStepFromTool,
  cancelPlanFromTool,
  completePlanFromTool,
  createPlanFromTool,
  type OriginalRequest,
  planStatusFromTool,
  updatePlanStepFromTool,
} from "./plan-tools.js";
import type { RunContext } from "./run-context.js";
import type { ToolCall, ToolHandlers } from "./run-tool-gate.js";
import {
  messagesAskToStop,
  parseStopVerdict,
  STOP_CLASSIFIER_INSTRUCTIONS,
} from "./stop-intent.js";
import {
  asksToStopOrChange,
  isAsideMessage,
  isBareContinuation,
  isConstraintOnly,
} from "./user-intent.js";

/** User messages searched back for the goal of a bare "continua". */
export const STANDING_GOAL_LOOKBACK = 80;

export type StandingGoal = {
  /** The user's last message that gave the work a goal. */
  text: string;
  seq: number;
  /** Rules about how to work written after it ("non lavorare sul mio PC"), oldest first. */
  constraints: string[];
};

function channelOf(blocks: unknown): string | undefined {
  if (!Array.isArray(blocks)) return undefined;
  for (const block of blocks) {
    if (
      block &&
      typeof block === "object" &&
      (block as { kind?: unknown }).kind === "channel_message"
    )
      return String((block as { channelId?: unknown }).channelId ?? "");
  }
  return undefined;
}

/**
 * The goal a bare follow-up ("Continua", "prosegui") continues: the user's latest earlier
 * message that is not itself a bare follow-up, a side question or a rule about how to work.
 * A message asking to stop or change the work ends the search: there is no goal to resume.
 * Channel runs only read messages of their own channel.
 */
export async function findStandingGoal(
  prisma: RunContext["deps"]["prisma"],
  input: { threadId: string; beforeSeq: number; channelId?: string | undefined },
): Promise<StandingGoal | undefined> {
  const rows = await prisma.message.findMany({
    where: { threadId: input.threadId, role: "user", seq: { lt: input.beforeSeq } },
    orderBy: { seq: "desc" },
    take: STANDING_GOAL_LOOKBACK,
    select: { blocks: true, seq: true },
  });
  const constraints: string[] = [];
  for (const row of rows) {
    if (input.channelId && channelOf(row.blocks) !== input.channelId) continue;
    const text = blocksText(row.blocks);
    if (!text) continue;
    if (asksToStopOrChange(text) && !isBareContinuation(text)) return undefined;
    if (isBareContinuation(text) || isAsideMessage(text)) continue;
    if (isConstraintOnly(text)) {
      if (constraints.length < 5) constraints.unshift(text);
      continue;
    }
    return { text, seq: row.seq, constraints };
  }
  return undefined;
}

/**
 * The text of stored message blocks. Blocks are `{ kind: "text", text }`; reading `type` here
 * once made every request look empty, so the verification step never saw the original request.
 */
export function blocksText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return typeof blocks === "string" ? blocks : "";
  return blocks
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      const { kind, type, text } = block as { kind?: unknown; type?: unknown; text?: unknown };
      // Channel (Telegram, SMS…) messages carry the user's words in their own block kind.
      return kind === "text" || type === "text" || kind === "channel_message"
        ? String(text ?? "")
        : "";
    })
    .filter((text) => text.trim())
    .join("\n")
    .trim();
}

/**
 * The request the plan's final verification step is checked against: the message that started
 * the run (continuations keep it), with the user's previous messages when it is a short
 * follow-up like "keep going", or the routine's prompt.
 */
export async function loadOriginalRequest(ctx: RunContext): Promise<OriginalRequest | undefined> {
  const { deps, run } = ctx;
  try {
    if (run.sourceMessageId) {
      const source = await deps.prisma.message.findUnique({
        where: { id: run.sourceMessageId },
        select: { blocks: true, threadId: true, seq: true },
      });
      const text = source ? blocksText(source.blocks) : "";
      if (source && text && isBareContinuation(text)) {
        const standing = await findStandingGoal(deps.prisma, {
          threadId: source.threadId,
          beforeSeq: source.seq,
          channelId: ctx.source?.channelId,
        });
        if (standing) {
          const later = await currentRequestMessages(ctx);
          const asides = later
            .filter((m) => !m.source && !m.inherited && m.aside)
            .map((m) => m.text);
          const instructions = [
            ...standing.constraints,
            ...later.filter((m) => !m.source && !m.inherited && !m.aside).map((m) => m.text),
          ];
          return {
            text: standing.text,
            ...(instructions.length ? { instructions } : {}),
            ...(asides.length ? { asides } : {}),
            ...(run.continuationIndex > 0
              ? { continuation: { index: run.continuationIndex, percent: run.continuationPercent } }
              : {}),
          };
        }
      }
      if (source && text) {
        const earlier =
          text.length < 300
            ? (
                await deps.prisma.message.findMany({
                  where: { threadId: source.threadId, role: "user", seq: { lt: source.seq } },
                  orderBy: { seq: "desc" },
                  take: 2,
                  select: { blocks: true },
                })
              )
                .map((row) => blocksText(row.blocks))
                .filter(Boolean)
                .reverse()
            : [];
        const later = await currentRequestMessages(ctx);
        const asides = later.filter((m) => !m.source && !m.inherited && m.aside).map((m) => m.text);
        const instructions = later
          .filter((m) => !m.source && !m.inherited && !m.aside)
          .map((m) => m.text);
        return {
          text,
          earlier,
          ...(instructions.length ? { instructions } : {}),
          ...(asides.length ? { asides } : {}),
          ...(run.continuationIndex > 0
            ? { continuation: { index: run.continuationIndex, percent: run.continuationPercent } }
            : {}),
        };
      }
    }
    if (run.routineId) {
      const routine = await deps.prisma.routine.findUnique({
        where: { id: run.routineId },
        select: { prompt: true },
      });
      if (routine?.prompt.trim()) return { text: routine.prompt };
    }
  } catch {
    // The checklist falls back to "re-read the conversation".
  }
  return undefined;
}

/** When the current request (with its automatic continuations) started. */
export async function chainStartedAt(ctx: RunContext): Promise<Date> {
  const { deps, run } = ctx;
  if (!run.continuationRootRunId) return run.createdAt;
  const root = await deps.prisma.run
    .findUnique({ where: { id: run.continuationRootRunId }, select: { createdAt: true } })
    .catch(() => null);
  return root?.createdAt ?? run.createdAt;
}

/**
 * The user's own words in the current request: the message that started it and every user
 * message written since (steering included), plus a routine's prompt.
 */
export async function currentRequestUserTexts(ctx: RunContext): Promise<string[]> {
  return (await currentRequestMessages(ctx)).map((message) => message.text);
}

export type RequestMessage = {
  text: string;
  /** The message that started the request (or the routine's prompt). */
  source: boolean;
  /** A side question or aside written during the work: answered, never the goal. */
  aside: boolean;
  /**
   * The request itself was a bare "continua": this is the earlier message whose goal it
   * continues (or a rule written after that message).
   */
  inherited?: boolean;
};

/**
 * The current request split into the goal (the starting message, plus instructions given while
 * it runs) and asides (questions written meanwhile, which do not replace or complete it).
 */
export async function currentRequestMessages(ctx: RunContext): Promise<RequestMessage[]> {
  const { deps, run } = ctx;
  const out: RequestMessage[] = [];
  try {
    const since = await chainStartedAt(ctx);
    const source = run.sourceMessageId
      ? await deps.prisma.message.findUnique({
          where: { id: run.sourceMessageId },
          select: { blocks: true, role: true, seq: true },
        })
      : null;
    if (source?.role === "user")
      out.push({ text: blocksText(source.blocks), source: true, aside: false });
    const sourceSeq = source && "seq" in source ? (source as { seq?: number }).seq : undefined;
    const later = await deps.prisma.message.findMany({
      where: {
        threadId: run.threadId,
        role: "user",
        createdAt: { gte: since },
        ...(run.sourceMessageId ? { id: { not: run.sourceMessageId } } : {}),
      },
      orderBy: { seq: "asc" },
      take: 20,
      select: { blocks: true },
    });
    for (const row of later) {
      const text = blocksText(row.blocks);
      out.push({ text, source: false, aside: isAsideMessage(text) });
    }
    // "Continua" alone has no goal: it continues the user's earlier one ("fino al 100%").
    const goals = out.filter((message) => !message.aside && message.text.trim());
    if (
      typeof sourceSeq === "number" &&
      goals.some((message) => isBareContinuation(message.text)) &&
      goals.every((message) => isBareContinuation(message.text) || isConstraintOnly(message.text))
    ) {
      const standing = await findStandingGoal(deps.prisma, {
        threadId: run.threadId,
        beforeSeq: sourceSeq,
        channelId: ctx.source?.channelId,
      });
      if (standing) {
        out.unshift(
          { text: standing.text, source: false, aside: false, inherited: true },
          ...standing.constraints.map((text) => ({
            text,
            source: false,
            aside: false,
            inherited: true,
          })),
        );
      }
    }
    if (run.routineId) {
      const routine = await deps.prisma.routine.findUnique({
        where: { id: run.routineId },
        select: { prompt: true },
      });
      if (routine?.prompt) out.push({ text: routine.prompt, source: true, aside: false });
    }
  } catch {
    // Unknown wording counts as "not asked".
  }
  return out.filter((message) => message.text.trim());
}

/**
 * Whether the user asked to stop, cancel or change the work: in their messages of this request,
 * or by pressing Stop on the run just before it.
 */
export async function userAskedToStopOrChange(ctx: RunContext): Promise<boolean> {
  const { deps, run } = ctx;
  const texts = (await currentRequestMessages(ctx))
    .filter((message) => !message.inherited)
    .map((message) => message.text);
  if (texts.some((text) => asksToStopOrChange(text))) return true;
  try {
    const since = await chainStartedAt(ctx);
    const previous = await deps.prisma.run.findFirst({
      where: { threadId: run.threadId, botId: run.botId, createdAt: { lt: since } },
      orderBy: { createdAt: "desc" },
      select: { status: true },
    });
    return previous?.status === "cancelled";
  } catch {
    return false;
  }
}

/**
 * Whether the user asked to stop the current long chain: only a message written AFTER the
 * chain started (never the request itself) with an explicit, non-negated stop command, or
 * ambiguous stop wording the quick classifier reads as "stop now". The Stop button cancels
 * the run directly and never gets here.
 */
export async function userAskedToStopChain(ctx: RunContext): Promise<boolean> {
  const texts = (await currentRequestMessages(ctx))
    .filter((message) => !message.source && !message.inherited)
    .map((message) => message.text);
  if (!texts.length) return false;
  const judge = ctx.completionJudge;
  const result = await messagesAskToStop(
    texts,
    judge
      ? async (text) =>
          parseStopVerdict(
            await judge(
              { instructions: STOP_CLASSIFIER_INSTRUCTIONS, prompt: text.slice(0, 2000) },
              AbortSignal.any([ctx.abortController.signal, AbortSignal.timeout(10_000)]),
            ),
          )
      : undefined,
  );
  return result.stop;
}

/** Piano / plan_* tools (NK 0013/0017/0028). */
export const planTools: ToolHandlers = {
  async plan_create(ctx: RunContext, call: ToolCall) {
    const { deps, run, bot } = ctx;
    const { args } = call;
    const stepsRaw = Array.isArray(args.steps) ? args.steps : [];
    return call.finish(
      await createPlanFromTool(deps, {
        spaceId: run.spaceId,
        botId: bot.id,
        userId: run.userId,
        title: String(args.title ?? ""),
        summary: args.summary !== undefined ? String(args.summary) : undefined,
        replaceActive: Boolean(args.replaceActive),
        steps: stepsRaw.map((step: unknown) => {
          const row = (step && typeof step === "object" ? step : {}) as Record<string, unknown>;
          return {
            title: String(row.title ?? ""),
            blockedBy: Array.isArray(row.blockedBy) ? row.blockedBy.map(Number) : undefined,
            notes: row.notes !== undefined ? String(row.notes) : undefined,
          };
        }),
      }),
    );
  },

  async plan_status(ctx: RunContext, call: ToolCall) {
    const { deps, run, bot } = ctx;
    return call.finish(await planStatusFromTool(deps, { spaceId: run.spaceId, botId: bot.id }));
  },

  async plan_update_step(ctx: RunContext, call: ToolCall) {
    const { deps, run, bot } = ctx;
    const { args } = call;
    const status = args.status !== undefined ? String(args.status) : undefined;
    const originalRequest =
      status === "in_progress" || status === "done" ? await loadOriginalRequest(ctx) : undefined;
    return call.finish(
      await updatePlanStepFromTool(deps, {
        spaceId: run.spaceId,
        botId: bot.id,
        stepId: args.stepId !== undefined ? String(args.stepId) : undefined,
        index: args.index !== undefined ? Number(args.index) : undefined,
        status,
        title: args.title !== undefined ? String(args.title) : undefined,
        notes: args.notes !== undefined ? String(args.notes) : undefined,
        verified: args.verified === true || args.verified === "true",
        originalRequest,
      }),
    );
  },

  async plan_add_step(ctx: RunContext, call: ToolCall) {
    const { deps, run, bot } = ctx;
    const { args } = call;
    return call.finish(
      await addPlanStepFromTool(deps, {
        spaceId: run.spaceId,
        botId: bot.id,
        title: String(args.title ?? ""),
        afterIndex: args.afterIndex !== undefined ? Number(args.afterIndex) : undefined,
        blockedBy: Array.isArray(args.blockedBy) ? args.blockedBy.map(Number) : undefined,
        notes: args.notes !== undefined ? String(args.notes) : undefined,
      }),
    );
  },

  async plan_complete(ctx: RunContext, call: ToolCall) {
    const { deps, run, bot } = ctx;
    const { args } = call;
    return call.finish(
      await completePlanFromTool(deps, {
        spaceId: run.spaceId,
        botId: bot.id,
        force: Boolean(args.force),
        reason: args.reason !== undefined ? String(args.reason) : undefined,
        mayAbandon: () => userAskedToStopOrChange(ctx),
      }),
    );
  },

  async plan_cancel(ctx: RunContext, call: ToolCall) {
    const { deps, run, bot } = ctx;
    const { args } = call;
    return call.finish(
      await cancelPlanFromTool(deps, {
        spaceId: run.spaceId,
        botId: bot.id,
        reason: args.reason !== undefined ? String(args.reason) : undefined,
        mayAbandon: () => userAskedToStopOrChange(ctx),
      }),
    );
  },
};
