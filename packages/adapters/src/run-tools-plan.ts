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
import { asksToStopOrChange, isAsideMessage } from "./user-intent.js";

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
      return kind === "text" || type === "text" ? String(text ?? "") : "";
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
        const asides = later.filter((m) => !m.source && m.aside).map((m) => m.text);
        const instructions = later.filter((m) => !m.source && !m.aside).map((m) => m.text);
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
          select: { blocks: true, role: true },
        })
      : null;
    if (source?.role === "user")
      out.push({ text: blocksText(source.blocks), source: true, aside: false });
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
  const texts = await currentRequestUserTexts(ctx);
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
