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

function blocksText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return typeof blocks === "string" ? blocks : "";
  return blocks
    .map((block) =>
      block && typeof block === "object" && (block as { type?: unknown }).type === "text"
        ? String((block as { text?: unknown }).text ?? "")
        : "",
    )
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
        return { text, earlier };
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
      }),
    );
  },
};
