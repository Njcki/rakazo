import type { AgentRuntimeEvent } from "@rakazo/adapter-kit";
import {
  DEFAULT_CONTEXT_STRATEGY,
  historyCompactJob,
  ModelAccountError,
  ModelOutputError,
  runContinueJob,
  SandboxAllowanceUsedError,
  SandboxRateLimitError,
  TransientModelError,
} from "@rakazo/adapter-kit";
import {
  containsSecret,
  displayName,
  humanizeToolName,
  isBackgroundRunTrigger,
  redactSecrets,
  TAKEOVER_COMPUTER_PENDING_STATE,
  userRunError,
  withoutLastToolStepNotes,
} from "@rakazo/core";
import { RunHistoryWriteError, recordUsage } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { sanitizedError } from "@rakazo/logging/monitoring";
import { isToolPauseResult } from "./approval-effect.js";
import { returnBotMessageOutcome } from "./bot-messages.js";
import { scheduleComputerSleep } from "./computer-idle.js";
import { holdComputerExecutionLeaseForTakeover } from "./computer-lifecycle.js";
import { resolveBotWorkspacePath } from "./computer-support.js";
import {
  CONTINUE_LATER_SUMMARY_MAX_CHARS,
  CONTINUE_LATER_TOOL,
  continuationMetaText,
  continuationPrompt,
} from "./continue-later.js";
import { looksLikeDanglingNarration } from "./final-answer-guard.js";
import {
  COMPACTION_BATCH_SIZE,
  HISTORY_WINDOW_SIZE,
  shouldEnqueueCompaction,
} from "./history-compaction.js";
import { maxToolCallsPerTurn, toolCallBudgetExceededMessage } from "./pi-runtime-tools.js";
import {
  type AutoContinuationReason,
  answeredInFull,
  closeAnsweredPlan,
  createAutoPlan,
  decideAutoContinuation,
  hitToolCallBudget,
  isCloseAttempt,
  isGoalUnfinished,
  isNoProgressPart,
  latestVerifyNotes,
  loadPlanGate,
  planProgressLine,
} from "./plan-completion-gate.js";
import {
  backOffRoutineAfterAccountError,
  clearRoutineBackoff,
  modelAccountRefusal,
} from "./routine-backoff.js";
import type { ReplyState, RunContext } from "./run-context.js";
import { isRunTainted, persistTurnCheckpoint } from "./run-context.js";
import { renewRunLease, requeueComputerRun } from "./run-lifecycle.js";
import { publishMessage, redactBlocks } from "./run-messages.js";
import {
  completionMarksUnread,
  completionNotificationBody,
  completionNotificationPreview,
  notifyRun,
  runSendsFinishNotification,
  subagentMarksUnread,
} from "./run-notifications.js";
import {
  canPublishDurableNarration,
  flushPendingTools,
  flushProgress,
  nextProgressNonce,
  publishMidTurnNarration,
  recordExplicitNoResponse,
  showNarrationStatus,
  tryFlushPendingTools,
} from "./run-progress.js";
import {
  completionMessageSegments,
  emptyDelegatedToolTurnShouldFail,
  runAllowsSilentEmpty,
  runPromotesMidTurnNarration,
  TOOL_STEPS_WITHOUT_RESPONSE,
} from "./run-replies.js";
import { scheduleRoutineRetry } from "./run-routines.js";
import { applyTool } from "./run-tools.js";
import {
  currentRequestMessages,
  chainStartedAt as requestStartedAt,
  userAskedToStopOrChange,
} from "./run-tools-plan.js";
import { withRuntimeCleanup } from "./runtime-stream.js";
import {
  peerReplyWithoutSentinel,
  stripNoResponseReply,
  stripStrayNoResponse,
} from "./silent-reply.js";
import { takeoverCheckpointOf } from "./takeover-resume.js";
import { appendToolCompletionAudit, toolCompletionFromResult } from "./tool-completion-audit.js";
import { advanceToolCallLoopGuard, loopGuardStopText } from "./tool-loop.js";
import {
  replyMentionsComputerFallback,
  userComputerFallbackNotice,
} from "./user-computer-fallback.js";
import {
  claimsWholeTaskDone,
  closesWholeJob,
  isStandbyClose,
  looksLikeLongTask,
  looksLikeWholeJobGoal,
  needsAutoPlan,
  reportsPartialProgress,
  stripStandbyClose,
} from "./user-intent.js";
import {
  assistantTurnSeparator,
  botMessageOutcomeFromMidTurn,
  clampUserProgressMessage,
  extractNarrationText,
  finalBlocksAfterMidTurnProgress,
  STEERING_RESET_MIN_GAP_MS,
  STEERING_RESETS_MAX_PER_RUN,
} from "./user-progress.js";

type RuntimeEvent<T extends AgentRuntimeEvent["type"]> = Extract<AgentRuntimeEvent, { type: T }>;

/**
 * Stream the runtime's events into the thread. Returns true when the attempt stopped before
 * the turn ended: it paused for an answer, approval or takeover, lost its lease, or was
 * stopped by the tool loop guard.
 */
export async function consumeRunEvents(
  ctx: RunContext,
  events: AsyncIterable<AgentRuntimeEvent>,
): Promise<boolean> {
  const { deps, run, runId, bot } = ctx;
  const { reply } = ctx.state;
  let thinking = false;
  const publishThinking = async (active: boolean) => {
    if (thinking === active) return;
    thinking = active;
    if (ctx.scripted || isBackgroundRunTrigger(run.trigger)) return;
    try {
      await deps.events.append({
        spaceId: run.spaceId,
        threadId: run.threadId,
        botId: bot.id,
        runId,
        type: "thread.meta",
        lease: { owner: ctx.workerId, fence: ctx.fence },
        payload: { activity: { thinking: active } },
      });
    } catch (error) {
      // Cancellation and a superseded attempt own their subsequent lifecycle.
      // A stale marker must never override the current worker's state.
      if (!(error instanceof RunHistoryWriteError)) throw error;
    }
  };
  try {
    for await (const event of withRuntimeCleanup(events, ctx.abortController)) {
      if (ctx.state.approval.pausePending) return true;
      if (!ctx.state.lease.valid) return true;
      if (await runLeaseLost(ctx)) return true;

      if (event.type === "thinking") {
        await publishThinking(event.active);
        continue;
      }
      if (
        (event.type === "text" && event.text.length > 0) ||
        event.type === "tool" ||
        event.type === "progress" ||
        event.type === "ask" ||
        event.type === "takeover" ||
        event.type === "turn" ||
        event.type === "done"
      )
        await publishThinking(false);

      // Check complete assistant turns so split sentinel chunks are recognized
      // without treating a partial identifier (NO_RESPONSE_POLICY) as silence.
      if (event.type === "tool" || event.type === "takeover") {
        recordExplicitNoResponse(reply, reply.assistantTurnText);
        reply.assistantTurnText = "";
      }
      if (event.type === "text") {
        await streamText(ctx, event);
      } else if (event.type === "turn") {
        reply.assistantTurnBreakPending = true;
      } else if (event.type === "steered") {
        await onSteered(ctx, event);
      } else if (event.type === "progress") {
        await streamProgress(ctx, event);
      } else if (event.type === "ask") {
        await pauseForAnswer(ctx, event);
        return true;
      } else if (event.type === "takeover") {
        await pauseForTakeover(ctx, event);
        return true;
      } else if (event.type === "tool") {
        if (await onToolCalled(ctx, event)) return true;
      } else if (event.type === "subagent") {
        await publishSubagent(ctx, event);
      } else if (event.type === "usage" && !event.accounted) {
        await recordUsage(deps.prisma, event, {
          spaceId: run.spaceId,
          botId: bot.id,
          userId: run.userId,
          runId,
          parentRunId: runId,
          operationId: runId,
        });
      } else if (event.type === "done") {
        recordExplicitNoResponse(reply, event.text ?? "");
        if (!reply.assembled && event.text) {
          if (reply.publishedMidTurnUserMessage || reply.discardedMidTurnNarration) {
            // Mid-turn narration was already published or discarded (routines).
            // Post-tool finals are streamed into assembled; do not restore
            // cumulative done.text (clamp/redaction make substring stripping brittle).
          } else {
            reply.assembled = event.text;
            reply.currentTextSegment += event.text;
          }
        }
      }
    }
    return false;
  } finally {
    // Run completion clears thinking too; never let this replace the turn's own outcome.
    await publishThinking(false).catch(() => {});
  }
}

/** At most once a second, check the run is still this attempt's and not cancelled or released. */
async function runLeaseLost(ctx: RunContext) {
  const { deps, runId, workerId, fence } = ctx;
  const { lease } = ctx.state;
  const now = Date.now();
  if (now - lease.lastCheckAt < 1_000) return false;
  lease.lastCheckAt = now;
  const still = await deps.prisma.run.findUnique({
    where: { id: runId },
    select: { status: true, leaseOwner: true, leaseFence: true, checkpoint: true },
  });
  if (
    !still ||
    still.status === "cancelled" ||
    still.leaseOwner !== workerId ||
    still.leaseFence !== fence
  ) {
    lease.valid = false;
    return true;
  }
  const releasedHold = takeoverCheckpointOf(still.checkpoint);
  if (ctx.computer.heldForTakeover && releasedHold) {
    await requeueComputerRun(deps, runId, workerId, fence, releasedHold, false);
    lease.valid = false;
    ctx.abortController.abort();
    return true;
  }
  return false;
}

async function streamText(ctx: RunContext, event: RuntimeEvent<"text">) {
  const { reply } = ctx.state;
  reply.assistantTurnText += event.text;
  if (event.text) reply.narrationStatusShowing = false;
  reply.textSinceLastStep += event.text;
  if (reply.assistantTurnBreakPending && event.text) {
    reply.assistantTurnBreakPending = false;
    const separator = assistantTurnSeparator(reply.assembled, event.text);
    if (separator) {
      reply.assembled += separator;
      reply.currentTextSegment += separator;
      reply.pendingProgress += reply.redactor.push(separator);
    }
  }
  reply.assembled += event.text;
  reply.currentTextSegment += event.text;
  ctx.state.toolCallStreak = { key: undefined, count: 0 };
  tryFlushPendingTools(reply);
  reply.pendingProgress += reply.redactor.push(event.text);
  const now = Date.now();
  if (!ctx.scripted && reply.pendingProgress && now - reply.lastProgressAt >= 250) {
    await flushProgress(ctx);
  }
}

async function streamProgress(ctx: RunContext, event: RuntimeEvent<"progress">) {
  const { deps, run, runId, bot, thread } = ctx;
  const { reply } = ctx.state;
  ctx.state.toolCallStreak = { key: undefined, count: 0 };
  if (run.trigger === "routine" || isBackgroundRunTrigger(run.trigger)) return;
  // The bot's own note stays the working line until it writes again.
  if (event.activity && reply.narrationStatusShowing) return;
  // Flush batched text deltas first so an activity line cannot land
  // ahead of text the model streamed before the tool call.
  if (reply.pendingProgress) {
    await deps.events.append({
      spaceId: run.spaceId,
      threadId: thread.id,
      botId: bot.id,
      type: "thread.progress",
      runId,
      payload: { delta: reply.pendingProgress, streaming: true },
    });
    reply.pendingProgress = "";
    reply.lastProgressAt = Date.now();
  }
  await deps.events.append({
    spaceId: run.spaceId,
    threadId: thread.id,
    botId: bot.id,
    type: "thread.progress",
    runId,
    payload: {
      text: redactSecrets(event.text, ctx.secrets),
      ...(event.activity ? { activity: true } : {}),
    },
  });
}

/**
 * The run's person wrote while the bot worked. What the bot wrote before that is posted as
 * its own message instead of running on into the reply to them, and the interim-message
 * budget starts again: the first note may answer them at once. Webhooks, external chats and
 * other members stay on the normal budget, and the restart is capped so a stream of messages
 * can't lift it.
 */
async function onSteered(ctx: RunContext, event: RuntimeEvent<"steered">) {
  const { deps, run } = ctx;
  const { reply } = ctx.state;
  reply.assistantTurnBreakPending = true;
  const now = Date.now();
  if (
    !event.fromRunUser ||
    reply.steeringResets >= STEERING_RESETS_MAX_PER_RUN ||
    now - reply.lastSteeringResetAt < STEERING_RESET_MIN_GAP_MS
  )
    return;
  reply.steeringResets += 1;
  reply.lastSteeringResetAt = now;
  await flushProgress(ctx);
  const before = extractNarrationText(reply.messageSegments, reply.currentTextSegment);
  const text = redactSecrets(before.text, ctx.secrets).trim();
  if (text && runPromotesMidTurnNarration(run.trigger)) {
    reply.messageSegments = before.remaining;
    reply.currentTextSegment = "";
    reply.workingNotes.length = 0;
    reply.assembled = "";
    reply.hasStreamedText = false;
    reply.pendingProgress = "";
    reply.redactor.skip();
    await publishMessage(
      deps,
      run,
      "bot",
      [{ kind: "text", text }],
      undefined,
      nextProgressNonce(ctx),
    );
    reply.midTurnUserTexts.push(text);
    reply.publishedMidTurnUserMessage = true;
  }
  reply.progressBudgetStart = reply.midTurnProgressCount;
  reply.turnStartedAtMs = now;
  reply.steeringReplyPending = true;
  reply.narrationStatusShowing = false;
}

async function pauseForAnswer(ctx: RunContext, event: RuntimeEvent<"ask">) {
  const { deps, run, runId, bot, thread, workerId, fence } = ctx;
  if (!(await renewRunLease(deps, runId, workerId, fence))) return;
  const safeText = redactSecrets(event.text, ctx.secrets);
  const safeDetail = event.detail ? redactSecrets(event.detail, ctx.secrets) : event.detail;
  const safeActions = event.actions?.map((action) => ({
    id: action.id,
    label: redactSecrets(action.label, ctx.secrets),
  }));
  await ctx.computer.checkpoint.flush();
  await persistTurnCheckpoint(ctx, event.executionId);
  await ctx.settleRunningHelpers();
  const paused = await deps.events.pauseRunForInput({
    spaceId: run.spaceId,
    threadId: run.threadId,
    botId: run.botId,
    runId,
    attemptId: ctx.attempt.id,
    leaseOwner: workerId,
    leaseFence: fence,
    blocks: [
      {
        kind: "ask",
        text: safeText,
        detail: safeDetail,
        status: "pending",
        actions: safeActions,
      },
    ],
    // Keep unredacted labels on the run for resume; message blocks stay redacted.
    offeredActions: event.actions,
  });
  if (!paused) return;
  if (paused.continuationRunId) {
    await deps.jobs
      .enqueue(runContinueJob(paused.continuationRunId))
      .catch((error) => getLogger().error("steering continuation enqueue", error));
  }
  await notifyRun(deps, run, {
    kind: "help",
    title: `${displayName(bot.name, "Bot")} needs an answer`,
    body: safeText,
    botId: bot.id,
    threadId: thread.id,
  });
}

async function pauseForTakeover(ctx: RunContext, event: RuntimeEvent<"takeover">) {
  const { deps, run, runId, bot, thread, workerId, fence } = ctx;
  const { reply } = ctx.state;
  if (!(await renewRunLease(deps, runId, workerId, fence))) return;
  // The user takes over the computer's screen, so it must be up before the run waits.
  await ctx.computer.get("takeover");
  const safeReason = redactSecrets(event.reason, ctx.secrets);
  // Publish pending narration as tagged mid-turn progress so reconciliation
  // does not treat pre-takeover text as the delegated final result.
  await publishMidTurnNarration(ctx);
  if (reply.assembled.trim()) {
    const narration = clampUserProgressMessage(redactSecrets(reply.assembled, ctx.secrets));
    if (narration && canPublishDurableNarration(ctx)) {
      await publishMessage(
        deps,
        run,
        "bot",
        [{ kind: "text", text: narration }],
        undefined,
        nextProgressNonce(ctx),
      );
      reply.midTurnUserTexts.push(narration);
      reply.publishedMidTurnUserMessage = true;
    } else if (narration) {
      reply.discardedMidTurnNarration = true;
      reply.lastDiscardedMidTurnNarration = narration;
    }
    reply.assembled = "";
    reply.hasStreamedText = false;
    reply.pendingProgress = "";
  }
  // Give the user a full idle period to answer before the computer may suspend.
  scheduleComputerSleep(deps.jobs, ctx.computer.stored.id);
  await publishMessage(
    deps,
    run,
    "bot",
    [{ kind: "computer", state: TAKEOVER_COMPUTER_PENDING_STATE, text: safeReason }],
    true,
  );
  await ctx.computer.checkpoint.flush();
  if (!(await holdComputerExecutionLeaseForTakeover(deps.prisma, ctx.computer.lease))) {
    throw new Error("Computer lease expired before takeover");
  }
  await persistTurnCheckpoint(ctx, event.executionId);
  await ctx.settleRunningHelpers();
  const paused = await deps.events.pauseRunForTakeover({
    spaceId: run.spaceId,
    threadId: run.threadId,
    botId: run.botId,
    runId,
    attemptId: ctx.attempt.id,
    leaseOwner: workerId,
    leaseFence: fence,
    reason: safeReason,
    computerId: ctx.computer.stored.id,
  });
  if (!paused) return;
  if (typeof paused === "object") {
    await deps.jobs
      .enqueue(runContinueJob(paused.continuationRunId))
      .catch((error) => getLogger().error("takeover continuation enqueue", error));
    return;
  }
  ctx.state.lease.retainComputer = true;
  await notifyRun(deps, run, {
    kind: "takeover",
    title: `${displayName(bot.name, "Bot")} needs you on the screen`,
    body: safeReason,
    botId: bot.id,
    threadId: thread.id,
  });
}

const QUICK_REPLY_ACTIVITY_LIMIT = 8;

/** Remembers the step for quick replies: tool name and the note the user already saw. */
export function recordToolActivity(
  reply: Pick<ReplyState, "toolActivity">,
  name: string,
  note: string | undefined,
  at = Date.now(),
): void {
  const text = note?.trim() ? `${name}: ${note.trim().replace(/\s+/g, " ").slice(0, 200)}` : name;
  reply.toolActivity ??= [];
  const list = reply.toolActivity;
  list.push({ text, at });
  if (list.length > QUICK_REPLY_ACTIVITY_LIMIT)
    list.splice(0, list.length - QUICK_REPLY_ACTIVITY_LIMIT);
}

/** Calls that only report, plan or continue are not progress for the continuation loop guard. */
function countsAsContinuationWork(name: string): boolean {
  return name !== CONTINUE_LATER_TOOL && name !== "message_user" && !name.startsWith("plan_");
}

/** Show the tool step, stop a repeating loop, and run the tool for scripted runtimes. */
async function onToolCalled(ctx: RunContext, event: RuntimeEvent<"tool">): Promise<boolean> {
  const { deps, run, runId, bot, thread } = ctx;
  const { reply } = ctx.state;
  // Preserve event ordering when the throttle still holds recent narration: the
  // client must see that text before the tool call it describes.
  await flushProgress(ctx);
  if (countsAsContinuationWork(event.name)) ctx.state.continuation.workToolCalls += 1;
  // Queued first so the text written before this call becomes its note.
  reply.pendingToolNames.push(event.name);
  const heldNote = event.name === "message_user" ? undefined : await publishMidTurnNarration(ctx);
  recordToolActivity(reply, event.name, heldNote);
  // A step without a note of its own replaces the earlier one in the live view, so its status
  // lines show again.
  if (!heldNote) reply.narrationStatusShowing = false;
  reply.textSinceLastStep = "";
  reply.assistantTurnBreakPending = true;
  await deps.events.append({
    spaceId: run.spaceId,
    threadId: thread.id,
    botId: bot.id,
    type: "agent.tool.called",
    runId,
    payload: { name: event.name, executionId: event.executionId },
  });
  await showNarrationStatus(ctx, heldNote);
  tryFlushPendingTools(reply);
  const loopGuard = advanceToolCallLoopGuard(ctx.state.toolCallStreak, event.name, event.args);
  ctx.state.toolCallStreak = loopGuard.streak;
  if (loopGuard.stuck) {
    await stopStuckToolLoop(ctx, event.name);
    return true;
  }
  if (!ctx.scripted) return false;
  const startedAt = Date.now();
  const audit = { spaceId: run.spaceId, threadId: thread.id, botId: bot.id, runId };
  try {
    const result = await applyTool(ctx, event.name, event.args, event.executionId);
    await appendToolCompletionAudit(
      deps,
      audit,
      toolCompletionFromResult(
        {
          name: event.name,
          executionId: event.executionId,
          durationMs: Date.now() - startedAt,
        },
        result,
      ),
      ctx.secrets,
    );
    return isToolPauseResult(result);
  } catch (error) {
    await appendToolCompletionAudit(
      deps,
      audit,
      {
        name: event.name,
        executionId: event.executionId,
        durationMs: Date.now() - startedAt,
        error,
      },
      ctx.secrets,
    );
    throw error;
  }
}

/** The model keeps repeating the same call: finish the run with what it has and say why. */
async function stopStuckToolLoop(ctx: RunContext, toolName: string) {
  const { deps, run, runId, bot, thread, workerId, fence } = ctx;
  const { reply } = ctx.state;
  ctx.tools.approvedReplays.assertDrained();
  flushPendingTools(reply);
  if (!(await renewRunLease(deps, runId, workerId, fence))) return;
  if (reply.messageSegments.length > 0) {
    await publishMessage(deps, run, "bot", redactBlocks(reply.messageSegments, ctx.secrets));
  }
  await ctx.computer.checkpoint.flush();
  ctx.state.terminalCheckpointComplete = true;
  const stuckText = loopGuardStopText(humanizeToolName(toolName), ctx.state.toolCallStreak.count);
  await ctx.settleRunningHelpers();
  const stopped = await deps.events.finalizeRun({
    spaceId: run.spaceId,
    threadId: thread.id,
    botId: bot.id,
    runId,
    taskId: run.taskId,
    attemptId: ctx.attempt.id,
    leaseOwner: workerId,
    leaseFence: fence,
    outcome: "completed",
    blocks: isBackgroundRunTrigger(run.trigger) ? [] : [{ kind: "text", text: stuckText }],
  });
  if (!stopped) return;
  ctx.stopHeartbeatAfterCompletion();
  if (run.trigger === "routine" && run.routineId) {
    await clearRoutineBackoff(deps, run.routineId);
  }
  if (stopped.continuationRunId) {
    await deps.jobs
      .enqueue(runContinueJob(stopped.continuationRunId))
      .catch((error) => getLogger().error("steering continuation enqueue", error));
  }
  if (run.trigger === "bot_message") {
    await returnBotMessageOutcome(
      deps,
      { ...run, sourceMessageId: run.sourceMessageId },
      { id: bot.id, name: bot.name },
      stuckText,
      "result",
      { forceUnread: true },
    ).catch((error) => getLogger().error("bot message loop-guard return", error));
  }
  ctx.abortController.abort();
}

async function publishSubagent(ctx: RunContext, event: RuntimeEvent<"subagent">) {
  const { deps, run, runId, bot, thread } = ctx;
  const { reply, runningHelpers } = ctx.state;
  const safeTask = redactSecrets(event.task, ctx.secrets);
  const safeProgress = event.progress ? redactSecrets(event.progress, ctx.secrets) : undefined;
  const safeResult = event.result ? redactSecrets(event.result, ctx.secrets) : undefined;
  await deps.events.append({
    spaceId: run.spaceId,
    threadId: thread.id,
    botId: bot.id,
    type: "thread.subagent",
    runId,
    payload: {
      agentId: event.agentId,
      name: event.name,
      task: safeTask,
      status: event.status,
      progress: safeProgress,
      result: safeResult,
    },
  });
  if (event.status === "running") {
    runningHelpers.set(event.agentId, {
      agentId: event.agentId,
      name: event.name,
      task: safeTask,
      status: event.status,
      progress: safeProgress,
    });
  } else {
    runningHelpers.delete(event.agentId);
  }
  if (event.status === "completed" || event.status === "failed") {
    const repliesToRequest = ctx.source.peerMessage?.repliesToRequest === true;
    reply.publishedTerminalSubagent ||= !subagentMarksUnread(
      run.trigger,
      event.status,
      repliesToRequest,
    );
    await publishMessage(
      deps,
      run,
      "bot",
      [
        {
          kind: "subagent",
          agentId: event.agentId,
          name: event.name,
          task: safeTask,
          status: event.status,
          progress: safeProgress,
          result: safeResult,
        },
      ],
      subagentMarksUnread(run.trigger, event.status, repliesToRequest),
    );
  }
}

/** The turn ended: apply a scripted runtime's files and memory, then finalize the reply. */
export async function completeRun(ctx: RunContext) {
  const { deps, run, runId, bot, thread, context } = ctx;
  const { reply } = ctx.state;
  recordExplicitNoResponse(reply, reply.assistantTurnText);
  ctx.computer.lazy.throwIfFailed();
  if (ctx.state.approval.pausePending || !ctx.state.lease.valid) return;
  ctx.tools.approvedReplays.assertDrained();
  reply.pendingProgress += reply.redactor.finish();
  await flushProgress(ctx);

  for (const turn of ctx.script ?? []) {
    for (const file of turn.files ?? []) {
      ctx.computer.checkpoint.markDirty();
      await deps.sandbox.writeFile(
        await ctx.computer.get("script"),
        {
          path: resolveBotWorkspacePath(ctx.computer.mode, bot.id, file.path),
          content: new TextEncoder().encode(file.content),
        },
        context,
      );
    }
    for (const mem of turn.memory ?? []) {
      await deps.memory.commit(
        {
          scope: mem.scope,
          botId: mem.scope === "bot" ? bot.id : undefined,
          path: mem.path,
          content: mem.content,
          sourceRunId: runId,
          sourceThreadId: thread.id,
        },
        context,
      );
      await deps.events.append({
        spaceId: run.spaceId,
        threadId: thread.id,
        botId: bot.id,
        type: "memory.revised",
        runId,
        payload: { path: mem.path, scope: mem.scope },
      });
    }
  }

  await ctx.computer.checkpoint.flush();
  ctx.state.terminalCheckpointComplete = true;

  // Preserve the last held-back preview as a normal final reply when the
  // model supplies none, unless it chose silence or already delivered that text.
  // Persisting peer results here also lets outcome delivery retry after completion.
  recordExplicitNoResponse(reply, reply.lastDiscardedMidTurnNarration);
  // When nothing follows the last step, the notes since the last interim message are the reply.
  if (
    !isBackgroundRunTrigger(run.trigger) &&
    !ctx.state.handedOff &&
    !reply.explicitNoResponse &&
    reply.workingNotes.length > 0 &&
    !reply.textSinceLastStep.trim()
  ) {
    flushPendingTools(reply);
    reply.messageSegments = withoutLastToolStepNotes(
      reply.messageSegments,
      reply.workingNotes.length,
    );
    const notes = reply.workingNotes.join("\n\n");
    const separator = assistantTurnSeparator(reply.assembled, notes);
    reply.assembled += separator + notes;
    reply.currentTextSegment += separator + notes;
  }
  // Runs that hold their narration back keep only the last held-back preview.
  if (
    !isBackgroundRunTrigger(run.trigger) &&
    !ctx.state.handedOff &&
    !reply.explicitNoResponse &&
    !reply.assembled.trim() &&
    reply.lastDiscardedMidTurnNarration &&
    !reply.midTurnUserTexts.includes(reply.lastDiscardedMidTurnNarration)
  ) {
    reply.assembled = reply.lastDiscardedMidTurnNarration;
    reply.currentTextSegment = reply.assembled;
  }
  flushPendingTools(reply);
  await applyCompletionGate(ctx);
  appendUserComputerFallbackNotice(ctx);
  const continuation = await continuationForCompletion(ctx);
  // The progress summary is the reply of a turn that continues; runtimes that do not end the
  // turn on continue_later (or a reply that dropped it) still show it.
  if (
    continuation &&
    !continuation.request.auto &&
    !reply.assembled.includes(continuation.request.summary)
  ) {
    const separator = assistantTurnSeparator(reply.assembled, continuation.request.summary);
    reply.assembled += separator + continuation.request.summary;
    reply.currentTextSegment += separator + continuation.request.summary;
  }
  // Silent-allowed runs can choose an explicit NO_RESPONSE or finish empty.
  // Other runs still drop a stray sentinel at the edges of a real reply.
  const silentReply = ctx.allowSilentEmptyRun
    ? stripNoResponseReply(reply.assembled, reply.messageSegments)
    : (ctx.source.peerMessage?.intent === "request" ||
          ctx.source.peerMessage?.intent === "question") &&
        !reply.publishedMidTurnUserMessage
      ? peerReplyWithoutSentinel(reply.assembled, reply.messageSegments)
      : stripStrayNoResponse(reply.assembled, reply.messageSegments);
  let completionBlocks = silentReply.blocks;
  if (!silentReply.assembled || isBackgroundRunTrigger(run.trigger)) {
    // Mid-turn progress already posted durable chat messages; skip the empty
    // "…" fallback so we do not add a junk final bubble.
    completionBlocks = completionMessageSegments(completionBlocks, {
      allowSilentEmpty: ctx.allowSilentEmptyRun || reply.publishedMidTurnUserMessage,
      emptyResponseText: ctx.emptyResponseText,
      suppressOutput: ctx.state.handedOff || isBackgroundRunTrigger(run.trigger),
      skipEmptyFallback: reply.publishedTerminalSubagent || reply.publishedMidTurnUserMessage,
    });
  }
  const finalBlocks = ctx.state.handedOff
    ? []
    : finalBlocksAfterMidTurnProgress(
        redactBlocks(completionBlocks, ctx.secrets),
        reply.publishedMidTurnUserMessage || runAllowsSilentEmpty(run.trigger),
      );
  // A refused continuation says why the work stopped, under the final answer.
  const refused = ctx.state.continuation.refused;
  const blocks =
    refused && !continuation && !ctx.state.handedOff
      ? [
          ...finalBlocks,
          {
            kind: "meta" as const,
            text: continuationMetaText(refused),
            continuation: refused,
          },
        ]
      : finalBlocks;
  const text = ctx.state.handedOff
    ? ""
    : redactSecrets(completionNotificationBody(silentReply.assembled, blocks), ctx.secrets);
  if (containsSecret(text, ctx.secrets)) {
    throw new Error("refusing to persist a secret in the thread");
  }
  // Tool steps succeeded and the only completion text is the synthetic
  // empty notice. That is a missed final answer or a swallowed provider
  // failure, not a successful delegated summary.
  if (
    !ctx.state.handedOff &&
    !silentReply.assembled.trim() &&
    emptyDelegatedToolTurnShouldFail(completionBlocks)
  ) {
    throw new Error(TOOL_STEPS_WITHOUT_RESPONSE);
  }
  if (!(await renewRunLease(deps, runId, ctx.workerId, ctx.fence))) return;
  const botMessageOutcome =
    run.trigger === "bot_message"
      ? botMessageOutcomeFromMidTurn(text, reply.midTurnUserTexts)
      : null;
  await ctx.settleRunningHelpers();
  const completed = await deps.events.finalizeRun({
    spaceId: run.spaceId,
    threadId: thread.id,
    botId: bot.id,
    runId,
    taskId: run.taskId,
    attemptId: ctx.attempt.id,
    leaseOwner: ctx.workerId,
    leaseFence: ctx.fence,
    outcome: "completed",
    blocks,
    markUnread: completionMarksUnread(
      run.trigger,
      text,
      ctx.source.peerMessage?.repliesToRequest === true,
    ),
    ...(continuation ? { continuation: continuation.finalize } : {}),
  });
  if (!completed) return;
  ctx.stopHeartbeatAfterCompletion();
  if (run.trigger === "routine" && run.routineId) {
    await clearRoutineBackoff(deps, run.routineId);
  }
  const { screenRelease } = ctx.state.computerUse;
  if (screenRelease) screenRelease.keepWarm = true;
  if (completed.continuationRunId) {
    await deps.jobs
      .enqueue(runContinueJob(completed.continuationRunId))
      .catch((error) => getLogger().error("steering continuation enqueue", error));
  }
  const explicit = completed.explicitContinuation;
  if (explicit && explicit.runId !== completed.continuationRunId) {
    // Durable either way: the queued run carries its wakeAt and the worker scan starts it.
    await deps.jobs
      .enqueue({
        ...runContinueJob(explicit.runId),
        ...(explicit.wakeAt ? { availableAt: explicit.wakeAt } : {}),
      })
      .catch((error) => getLogger().error("explicit continuation enqueue", error));
  }
  if (botMessageOutcome) {
    // Prefer the final reply. If the turn only posted mid-turn progress, return that
    // text explicitly as status. Delivery uses a stable auto-outcome key; mark
    // botOutcomeReturnedAt only after a successful (or intentionally skipped) return
    // so a crash or failed delivery stays visible to the reconciler.
    await returnBotMessageOutcome(
      deps,
      { ...run, sourceMessageId: run.sourceMessageId },
      { id: bot.id, name: bot.name },
      botMessageOutcome.text,
      botMessageOutcome.intent,
    ).catch((error) => getLogger().error("bot message result return", error));
  }
  const notifyBody = completionNotificationPreview(text);
  if (
    runSendsFinishNotification(run.trigger) &&
    notifyBody &&
    !completed.continuationRunId &&
    !explicit
  ) {
    await notifyRun(deps, run, {
      kind: "completion",
      title: `${displayName(bot.name, "Bot")} finished`,
      body: notifyBody,
      botId: bot.id,
      threadId: thread.id,
    });
  }
  // Last, and never fatal: the run is already finalized, so a failure here must not reach
  // the failure path, where a second finalizeRun would match no rows and silently
  // skip the completion notification.
  try {
    const updatedThread = await deps.prisma.thread.findUniqueOrThrow({
      where: { id: thread.id },
      select: {
        nextMessageSeq: true,
        historyCompactedUpToSeq: true,
      },
    });
    if (
      (deps.contextStrategy ?? DEFAULT_CONTEXT_STRATEGY) === "current" &&
      shouldEnqueueCompaction(
        updatedThread.nextMessageSeq,
        updatedThread.historyCompactedUpToSeq,
        HISTORY_WINDOW_SIZE,
        COMPACTION_BATCH_SIZE,
      )
    ) {
      await deps.jobs.enqueue(historyCompactJob(thread.id));
    }
  } catch (error) {
    getLogger().error("history.compact enqueue failed", error);
  }
}

/** The task goes on, so the reply loses its trailing "sono a disposizione…" lines. */
function dropStandbyClose(reply: ReplyState): void {
  const assembled = stripStandbyClose(reply.assembled);
  if (assembled === reply.assembled || !assembled.trim()) return;
  const removed = reply.assembled.slice(assembled.length);
  reply.assembled = assembled;
  if (reply.currentTextSegment.endsWith(removed)) {
    reply.currentTextSegment = reply.currentTextSegment.slice(0, -removed.length).trimEnd();
  } else {
    reply.currentTextSegment = stripStandbyClose(reply.currentTextSegment);
  }
  const last = reply.messageSegments.at(-1);
  if (last && last.kind === "text") {
    const text = stripStandbyClose(last.text);
    if (text.trim()) last.text = text;
  }
}

/**
 * The completion gate (plan-completion-gate.ts): a run that ends with the plan still open, its
 * verification unticked, or at the tool-call limit, continues as if it had called
 * continue_later. Never throws: on any error the run completes as before.
 */
async function applyCompletionGate(ctx: RunContext) {
  const { deps, run, runId, bot } = ctx;
  const continuation = ctx.state.continuation;
  const settings = continuation.settings;
  if (
    !settings ||
    continuation.requested ||
    continuation.refused ||
    ctx.state.handedOff ||
    ctx.scripted ||
    ctx.abortController.signal.aborted
  ) {
    return;
  }
  try {
    const replyText = ctx.state.reply.assembled;
    const limit = maxToolCallsPerTurn();
    let reason: AutoContinuationReason | undefined = hitToolCallBudget(
      replyText,
      limit,
      toolCallBudgetExceededMessage(limit),
    )
      ? "tool_budget"
      : undefined;
    const chainStartedAt = await requestStartedAt(ctx);
    let { plan, verdict } = await loadPlanGate(deps, {
      spaceId: run.spaceId,
      botId: bot.id,
      chainStartedAt,
      planToolUsedThisRun: ctx.state.planReminder.planToolUsedThisRun,
    });
    const messages = await currentRequestMessages(ctx);
    const goalTexts = messages.filter((m) => !m.aside).map((m) => m.text);
    const asides = messages.filter((m) => m.aside).map((m) => m.text);
    const inheritedGoal = messages.some((m) => m.inherited);
    const firstVerdict = verdict;
    const replyUnfinished = !replyText.trim() || looksLikeDanglingNarration(replyText);
    const replyClaimsDone = closesWholeJob(replyText);
    // A complete final answer delivers the request even with an automatic plan (or only its
    // verification) left open: the plan is closed and the request ends.
    let answered = false;
    if (!reason && answeredInFull({ verdict, plan, replyText })) {
      answered = true;
      await closeAnsweredPlan(deps, { spaceId: run.spaceId, botId: bot.id });
      verdict = { open: false, why: "all_closed" };
    }
    // Unfinished multi-step work without a plan of this request gets one, so the gate applies
    // to it too. A complete answer, a later part, or a plan the model closed itself never do.
    if (!reason && !verdict.open && (verdict.why === "no_plan" || verdict.why === "stale")) {
      if (
        needsAutoPlan({
          requestTexts: goalTexts,
          workToolCalls: continuation.workToolCalls,
          continuationIndex: run.continuationIndex,
          planToolUsedThisRun: ctx.state.planReminder.planToolUsedThisRun,
          replyUnfinished,
          replyClaimsDone,
        })
      ) {
        ({ plan, verdict } = await createAutoPlan(deps, {
          spaceId: run.spaceId,
          botId: bot.id,
          userId: run.userId,
          requestTexts: goalTexts,
          asides,
          replaceActive: verdict.why === "stale",
          chainStartedAt,
        }));
        if (verdict.open) reason = "plan_created";
      }
    }
    if (!reason && verdict.open) reason = verdict.reason;
    // A side question never ends a long task: a part that only answered it, or that closes
    // with a stand-by line, continues the original request.
    const stopAsked = await userAskedToStopOrChange(ctx);
    const standby = Boolean(replyText.trim()) && isStandbyClose(replyText);
    if (
      !reason &&
      isCloseAttempt({
        continuationIndex: run.continuationIndex,
        longTaskPlanned:
          ctx.state.planReminder.planToolUsedThisRun && goalTexts.some((t) => looksLikeLongTask(t)),
        replyText,
        workToolCalls: continuation.workToolCalls,
        lastUserMessageIsAside: messages.length > 1 && messages.at(-1)!.aside,
        userAskedToStopOrChange: stopAsked,
      })
    ) {
      reason = "close_attempt";
    }
    // "Fino al 100%" is the whole job: one finished batch with its plan closed is not the end.
    const wholeJobGoal = goalTexts.some((t) => looksLikeWholeJobGoal(t));
    const verifyNotes =
      !reason && wholeJobGoal
        ? await latestVerifyNotes(deps, {
            spaceId: run.spaceId,
            botId: bot.id,
            since: chainStartedAt,
          }).catch(() => undefined)
        : undefined;
    if (
      !reason &&
      isGoalUnfinished({
        wholeJobGoal,
        verdict,
        continuationIndex: run.continuationIndex,
        planToolUsedThisRun: ctx.state.planReminder.planToolUsedThisRun,
        workToolCalls: continuation.workToolCalls,
        replyText,
        verifyNotes,
        userAskedToStopOrChange: stopAsked,
      })
    ) {
      reason = "goal_unfinished";
      // The next part starts from a plan that quotes the request, with its verification step.
      const created = await createAutoPlan(deps, {
        spaceId: run.spaceId,
        botId: bot.id,
        userId: run.userId,
        requestTexts: goalTexts,
        asides,
        replaceActive: true,
        chainStartedAt,
      }).catch(() => undefined);
      if (created?.plan) ({ plan, verdict } = created);
    }
    // A part that did no real work ends the chain at once (not after three repeats).
    const noProgress = isNoProgressPart({
      reason,
      continuationIndex: run.continuationIndex,
      workToolCalls: continuation.workToolCalls,
      fence: ctx.fence,
    });
    const gateReason = reason;
    if (noProgress) reason = undefined;
    const decision = decideAutoContinuation({
      runId,
      chain: run,
      settings,
      workToolCalls: continuation.workToolCalls,
      reason,
      replyText: redactSecrets(replyText, ctx.secrets),
      progressLine: plan && verdict.open ? planProgressLine(plan) : undefined,
      maxSummaryChars: CONTINUE_LATER_SUMMARY_MAX_CHARS,
    });
    if (decision.kind === "continue") {
      continuation.requested = decision.request;
      if (reason === "close_attempt") dropStandbyClose(ctx.state.reply);
    } else if (decision.kind === "refused") continuation.refused = decision.refused;
    // One line per finished run, continued or not, so "why did it stop?" has an answer.
    getLogger().info("run.completion_gate", {
      runId,
      rootRunId: run.continuationRootRunId ?? runId,
      continuationIndex: run.continuationIndex,
      fence: ctx.fence,
      trigger: run.trigger,
      reason: gateReason ?? "none",
      outcome: noProgress
        ? "no_progress"
        : decision.kind === "continue"
          ? "scheduled"
          : decision.kind === "refused"
            ? decision.refused.state
            : "ended",
      answeredInFull: answered,
      replyUnfinished,
      nextIndex:
        decision.kind === "continue"
          ? decision.request.index
          : decision.kind === "refused"
            ? decision.refused.index
            : undefined,
      plan: firstVerdict.open ? firstVerdict.reason : firstVerdict.why,
      planStatus: plan?.status,
      planSteps: plan ? `${plan.progress.done}/${plan.progress.total}` : undefined,
      planToolUsedThisRun: ctx.state.planReminder.planToolUsedThisRun,
      workToolCalls: continuation.workToolCalls,
      goalMessages: goalTexts.length,
      inheritedGoal,
      wholeJobGoal,
      asides: asides.length,
      stopAsked,
      standby,
      claimsWholeDone: claimsWholeTaskDone(replyText),
      partialProgress: reportsPartialProgress(replyText),
      verifyNotesWholeDone: verifyNotes ? closesWholeJob(verifyNotes) : undefined,
    });
  } catch (error) {
    getLogger().warn("run.completion_gate failed", { runId, error: sanitizedError(error) });
  }
}

/**
 * The run worked on the bot's own computer because the user's was offline: the reply says so
 * once, in the reply's language, unless the model already did.
 */
function appendUserComputerFallbackNotice(ctx: RunContext) {
  const fallback = ctx.state.userComputerFallback;
  const { reply } = ctx.state;
  if (!fallback || ctx.state.handedOff || reply.explicitNoResponse) return;
  const used =
    fallback.triggeredThisRun ||
    (fallback.instructionsWantIt &&
      fallback.state !== "connected" &&
      ctx.run.continuationIndex === 0 &&
      ctx.state.continuation.workToolCalls > 0);
  if (!used || replyMentionsComputerFallback(reply.assembled)) return;
  const notice = userComputerFallbackNotice(reply.assembled);
  const separator = assistantTurnSeparator(reply.assembled, notice);
  reply.assembled += separator + notice;
  reply.currentTextSegment += separator + notice;
}

/** The accepted continue_later request of this run, ready for finalizeRun. */
async function continuationForCompletion(ctx: RunContext) {
  const request = ctx.state.continuation.requested;
  const settings = ctx.state.continuation.settings;
  if (!request || !settings || ctx.state.handedOff) return undefined;
  const percent = request.percent ?? undefined;
  const meta = {
    index: request.index,
    max: request.max,
    ...(percent === undefined ? {} : { percent }),
  };
  return {
    request,
    finalize: {
      index: request.index,
      max: request.max,
      rootRunId: request.rootRunId,
      digest: request.digest,
      repeats: request.repeats,
      percent: request.percent,
      // Whatever this run read from outside follows the task into the next run.
      tainted: await isRunTainted(ctx),
      delayMs: settings.delayMs,
      prompt: continuationPrompt({ index: request.index, max: request.max, auto: request.auto }),
      metaText: {
        scheduled: continuationMetaText({ state: "scheduled", ...meta }),
        superseded: continuationMetaText({ state: "superseded", ...meta }),
      },
    },
  };
}

/** The turn failed: keep the reply streamed so far, record the error, and retry or notify. */
export async function failRun(
  ctx: RunContext,
  caughtError: unknown,
  model: {
    /** The run used the deployment's own model key. */
    ownCredential: boolean | undefined;
    active: Record<"model.provider" | "model.id", string>;
  },
) {
  const { deps, run, runId, bot, thread } = ctx;
  const { reply } = ctx.state;
  let error = caughtError;
  // A refused account limit needs user/operator action, not setup-job retries.
  // Keep the provisioning error even if aborting the model masked it.
  try {
    ctx.computer.lazy.throwIfFailed();
  } catch (computerError) {
    if (
      !(computerError instanceof SandboxRateLimitError) &&
      !(computerError instanceof SandboxAllowanceUsedError)
    )
      throw computerError;
    error = computerError;
  }
  if (!ctx.state.terminalCheckpointComplete) {
    await ctx.computer.checkpoint.flush().catch(() => undefined);
  }
  const message = redactSecrets(userRunError(error), ctx.secrets);
  // Reply text the user watched stream in since the last saved message stays in the
  // thread, above the error, instead of vanishing with the live row.
  recordExplicitNoResponse(reply, reply.assistantTurnText);
  const partialText =
    ctx.scripted ||
    ctx.state.handedOff ||
    reply.explicitNoResponse ||
    !runPromotesMidTurnNarration(run.trigger)
      ? ""
      : redactSecrets(
          extractNarrationText(reply.messageSegments, reply.currentTextSegment).text,
          ctx.secrets,
        ).trim();
  const partialReply =
    partialText && !containsSecret(partialText, ctx.secrets)
      ? [{ kind: "text" as const, text: partialText }]
      : [];
  await ctx.settleRunningHelpers();
  const failed = await deps.events.finalizeRun({
    spaceId: run.spaceId,
    threadId: thread.id,
    botId: bot.id,
    runId,
    taskId: run.taskId,
    attemptId: ctx.attempt.id,
    leaseOwner: ctx.workerId,
    leaseFence: ctx.fence,
    outcome: "failed",
    error: message,
    ...(partialReply.length > 0 ? { partialReply } : {}),
  });
  if (!failed) return;
  if (
    error instanceof TransientModelError ||
    error instanceof ModelAccountError ||
    error instanceof ModelOutputError ||
    error instanceof SandboxRateLimitError ||
    error instanceof SandboxAllowanceUsedError
  ) {
    // Provider outages that outlasted retries, provider accounts, plans and model
    // choices the user fixes, unusable model output, the computer provider's own rate limit
    // and a spent computer allowance are not server faults; the run error tells the user.
    getLogger().warn("run.failed", {
      "run.outcome": "failed",
      "run.failure": error.name,
      reason: message,
      ...model.active,
    });
  } else {
    getLogger().error(
      "run.failed",
      sanitizedError(error, (text) => redactSecrets(text, ctx.secrets)),
      {
        "run.outcome": "failed",
        ...model.active,
      },
    );
  }
  if (failed.continuationRunId) {
    await deps.jobs
      .enqueue(runContinueJob(failed.continuationRunId))
      .catch((error) => getLogger().error("steering continuation enqueue", error));
  }
  if (run.trigger === "bot_message") {
    await returnBotMessageOutcome(
      deps,
      { ...run, sourceMessageId: run.sourceMessageId },
      { id: bot.id, name: bot.name },
      `Could not complete the delegated request: ${message}`,
      "status",
      { forceUnread: true },
    ).catch((returnError) => getLogger().error("bot message failure return", returnError));
  }
  // A refusal of the deployment's own key is the operator's problem, not the user's.
  const refusal =
    run.trigger === "routine" && model.ownCredential ? modelAccountRefusal(error) : undefined;
  if (run.routineId && refusal) {
    await backOffRoutineAfterAccountError(deps, run.routineId, new Date(), refusal.resetAt);
  }
  const retrying = !failed.continuationRunId && (await scheduleRoutineRetry(deps, run, error));
  if (runSendsFinishNotification(run.trigger) && !failed.continuationRunId && !retrying) {
    await notifyRun(deps, run, {
      kind: "failure",
      title: `${displayName(bot.name, "Bot")} failed`,
      body: message,
      botId: bot.id,
      threadId: thread.id,
    });
  }
}
