import {
  desktopProtectionGuardMessage,
  protectedComputerLifecycleRefusal,
} from "./desktop-command-guard.js";
import {
  type GoalCheck,
  goalAlreadyReachedError,
  goalReached,
  MAX_GOAL_CHECK_CHANGES,
  parseGoalCheckArgs,
  SET_GOAL_CHECK_TOOL,
} from "./goal-check.js";
import { loadGoalLedger, runGoalProbe, saveGoalLedger } from "./goal-gate.js";
import type { ToolHandlers } from "./run-tool-gate.js";

/** set_goal_check: registers the request's completion check after running it once. */
export const goalTools: ToolHandlers = {
  async [SET_GOAL_CHECK_TOOL](ctx, call) {
    const { run, runId } = ctx;
    if (!ctx.state.continuation.settings) {
      return call.finish({ error: "set_goal_check is not available in this run." });
    }
    const parsed = parseGoalCheckArgs(call.args);
    if (!parsed.ok) return call.finish({ error: parsed.error });
    const refusal = protectedComputerLifecycleRefusal(parsed.probe);
    if (refusal) return call.finish({ error: desktopProtectionGuardMessage(refusal) });
    const computer = await ctx.computer.get("tool", call.name);
    const probe = await runGoalProbe(ctx, parsed, computer);
    if (probe.value === undefined) {
      return call.finish({
        error: `The probe gave no usable value (exit code ${probe.code ?? "none"}${
          probe.error ? `, ${probe.error}` : ""
        }). Fix it: a read-only command that exits 0 and prints the current progress as one number${
          parsed.kind === "exit"
            ? " (or, with kind=exit, exits 0 only when everything is done)"
            : ""
        }. Nothing was registered.`,
      });
    }
    if (goalReached(parsed, probe.value)) {
      return call.finish({ error: goalAlreadyReachedError(probe.value, parsed.target) });
    }
    const ledger = await loadGoalLedger(ctx);
    const same = ledger.goal?.probe === parsed.probe && ledger.goal.kind === parsed.kind;
    const changes = (ledger.goal?.changes ?? 0) + (ledger.goal && !same ? 1 : 0);
    if (changes > MAX_GOAL_CHECK_CHANGES) {
      return call.finish({
        error: `The completion check of this request was already replaced ${MAX_GOAL_CHECK_CHANGES} times; keep the current one (\`${ledger.goal?.probe}\`) and work on the task.`,
      });
    }
    const now = new Date().toISOString();
    const goal: GoalCheck = {
      description: parsed.description,
      probe: parsed.probe,
      kind: parsed.kind,
      target: parsed.target,
      ...(parsed.unit ? { unit: parsed.unit } : {}),
      registeredRunId: runId,
      registeredAt: now,
      ...(changes ? { changes } : {}),
      // The same probe keeps its history, so re-registering it never resets the stall check.
      readings: [
        ...(same ? (ledger.goal?.readings ?? []) : []),
        { runId, index: run.continuationIndex, value: probe.value, at: now, gate: false },
      ].slice(-80),
    };
    await saveGoalLedger(ctx, { ...ledger, goal });
    return call.finish({
      ok: true,
      registered: goal.description,
      value: probe.value,
      target: goal.kind === "exit" ? "exit code 0" : goal.target,
      reached: goalReached(goal, probe.value),
      note: "After every part the platform runs this check itself: the request continues while it is below the target and moving, and ends when it reaches the target or stops moving. Keep working on the next unfinished part.",
    });
  },
};
