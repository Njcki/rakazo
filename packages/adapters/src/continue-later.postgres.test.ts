import { randomUUID } from "node:crypto";
import type { BackgroundJobHandlers, JobPublisher } from "@rakazo/adapter-kit";
import { runContinueJob } from "@rakazo/adapter-kit";
import type { MessageBlock } from "@rakazo/contracts";
import { ACTIVE_RUN_STATUSES } from "@rakazo/core";
import type { ExplicitContinuationRequest, PrismaClient } from "@rakazo/db";
import {
  asSystem,
  createDb,
  createThreadMessage,
  finalizeRun,
  provisionMessagingIdentity,
  runAsSystem,
  runAsTenant,
  sendUserMessage,
} from "@rakazo/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { continuationMetaText, continuationPrompt, decideContinuation } from "./continue-later.js";
import { InMemoryRealtimeFanout } from "./realtime.js";
import { RunJobPublisher, RunStarter, RunWorkerHost } from "./run-wakeup.js";

const url = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE === "1" && url ? describe.sequential : describe.skip;

describePostgres("continue_later chains (PostgreSQL)", () => {
  let db: ReturnType<typeof createDb>;
  let system: PrismaClient;
  let identity: { userId: string; spaceId: string; botId: string; threadId: string };
  const address = `continue-${randomUUID()}@rakazo.test`;

  beforeAll(async () => {
    db = createDb(url!);
    system = asSystem(db.prisma);
    identity = await runAsSystem("continue_later fixture", () =>
      provisionMessagingIdentity(
        db.prisma,
        { provider: "email", address },
        { signupsEnabled: undefined, signupAllowlist: undefined },
      ),
    );
  });

  afterAll(async () => {
    if (identity) {
      await system.messagingIdentity.deleteMany({ where: { address } });
      await system.organization.deleteMany({ where: { id: identity.spaceId } });
      await system.user.deleteMany({ where: { id: identity.userId } });
    }
    if (db) {
      await db.prisma.$disconnect();
      await db.pool.end();
    }
  });

  async function clearThread() {
    await system.run.updateMany({
      where: {
        threadId: identity.threadId,
        status: { notIn: ["completed", "failed", "cancelled"] },
      },
      data: { status: "cancelled" },
    });
    await system.steeringMessage.deleteMany({ where: { botId: identity.botId } });
  }

  async function runningRun(
    data: {
      trigger?: string;
      prompt?: string;
      sourceBlocks?: MessageBlock[];
      continuation?: { index: number; rootRunId: string; ofRunId?: string };
    } = {},
  ) {
    const { userId, spaceId, botId, threadId } = identity;
    const source = data.sourceBlocks
      ? await createThreadMessage(system, { threadId, role: "user", blocks: data.sourceBlocks })
      : null;
    const task = await system.task.create({
      data: {
        userId,
        spaceId,
        botId,
        threadId,
        prompt: data.prompt ?? "do the batch",
        status: "running",
      },
    });
    const run = await system.run.create({
      data: {
        userId,
        spaceId,
        botId,
        threadId,
        taskId: task.id,
        trigger: data.trigger ?? "user",
        status: "running",
        startedAt: new Date(),
        leaseOwner: "worker-1",
        leaseFence: 1,
        sourceMessageId: source?.id,
        ...(data.continuation
          ? {
              continuationIndex: data.continuation.index,
              continuationRootRunId: data.continuation.rootRunId,
              continuationOfRunId: data.continuation.ofRunId,
            }
          : {}),
      },
    });
    const attempt = await system.attempt.create({
      data: { runId: run.id, fence: 1, status: "running" },
    });
    return { run, task, attempt, source };
  }

  function request(
    run: { id: string; continuationIndex: number; continuationRootRunId: string | null },
    overrides: Partial<ExplicitContinuationRequest> = {},
    max = 50,
  ): ExplicitContinuationRequest {
    const decision = decideContinuation({
      runId: run.id,
      chain: {
        ...run,
        continuationDigest: null,
        continuationRepeats: 0,
        continuationPercent: null,
      },
      summary: `progress ${randomUUID()}`,
      percent: 30,
      workToolCalls: 3,
      settings: { maxContinuations: max, maxRepeats: 3 },
    });
    if (!decision.ok) throw new Error("fixture decision refused");
    return {
      index: decision.index,
      max: decision.max,
      rootRunId: decision.rootRunId,
      digest: decision.digest,
      repeats: decision.repeats,
      percent: decision.percent,
      tainted: false,
      delayMs: 60_000,
      prompt: continuationPrompt(decision),
      metaText: {
        scheduled: continuationMetaText({ state: "scheduled", index: decision.index, max }),
        superseded: continuationMetaText({ state: "superseded", index: decision.index, max }),
      },
      ...overrides,
    };
  }

  async function finalize(
    fixture: Awaited<ReturnType<typeof runningRun>>,
    outcome: "completed" | "failed",
    continuation?: ExplicitContinuationRequest,
  ) {
    const base = {
      spaceId: identity.spaceId,
      threadId: identity.threadId,
      botId: identity.botId,
      runId: fixture.run.id,
      taskId: fixture.task.id,
      attemptId: fixture.attempt.id,
      leaseOwner: "worker-1",
      leaseFence: 1,
    };
    const result = await runAsTenant(identity, () =>
      outcome === "completed"
        ? finalizeRun(db.prisma, {
            ...base,
            outcome,
            blocks: [{ kind: "text", text: "Fatti 3 file su 10." }],
            ...(continuation ? { continuation } : {}),
          })
        : finalizeRun(db.prisma, { ...base, outcome, error: "boom" }),
    );
    if (!result) throw new Error("fixture run was not finalized");
    return result;
  }

  it("queues the next link with the original trigger, person and source, delayed and durable", async () => {
    await clearThread();
    const fixture = await runningRun({ sourceBlocks: [{ kind: "text", text: "doppia tutto" }] });
    const before = Date.now();
    const result = await finalize(fixture, "completed", request(fixture.run, { tainted: true }));
    expect(result.explicitContinuation?.runId).toEqual(expect.any(String));
    const next = await system.run.findUniqueOrThrow({
      where: { id: result.explicitContinuation!.runId },
      include: { task: true },
    });
    expect(next).toMatchObject({
      status: "queued",
      trigger: "user",
      userId: identity.userId,
      sourceMessageId: fixture.source!.id,
      continuationOfRunId: fixture.run.id,
      continuationRootRunId: fixture.run.id,
      continuationIndex: 1,
      continuationPercent: 30,
      continuationTainted: true,
    });
    expect(next.task.prompt).toContain("[Continuation 1 of max 50");
    expect(next.task.prompt).not.toContain("Fatti 3 file");
    expect(next.wakeAt!.getTime()).toBeGreaterThanOrEqual(before + 59_000);
    const reply = await system.message.findFirstOrThrow({
      where: { runId: fixture.run.id, role: "bot" },
      orderBy: { seq: "desc" },
    });
    expect(reply.blocks).toContainEqual(
      expect.objectContaining({
        kind: "meta",
        continuation: { state: "scheduled", index: 1, max: 50, percent: 30 },
      }),
    );

    // A fresh worker (after a restart) leaves it alone until it is due, then starts it.
    const realtime = new InMemoryRealtimeFanout();
    const starter = new RunStarter(realtime);
    const host = new RunWorkerHost(db.prisma, realtime, starter, { intervalMs: 25 });
    const entered: string[] = [];
    try {
      await host.start({
        "run.continue": async ({ runId }) => {
          entered.push(runId);
          await system.run.update({ where: { id: runId }, data: { status: "completed" } });
        },
      } as BackgroundJobHandlers);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(entered).not.toContain(next.id);
      await system.run.update({
        where: { id: next.id },
        data: { wakeAt: new Date(Date.now() - 1) },
      });
      await vi.waitFor(() => expect(entered).toContain(next.id), { timeout: 5_000, interval: 20 });
    } finally {
      await host.stop();
    }
  });

  it("is idempotent per run: one continuation per finished run", async () => {
    await clearThread();
    const fixture = await runningRun();
    const result = await finalize(fixture, "completed", request(fixture.run));
    await expect(
      system.run.create({
        data: {
          ...identity,
          taskId: fixture.task.id,
          trigger: "user",
          status: "queued",
          continuationOfRunId: fixture.run.id,
        },
      }),
    ).rejects.toThrow();
    expect(await system.run.count({ where: { continuationOfRunId: fixture.run.id } })).toBe(1);
    await system.run.update({
      where: { id: result.explicitContinuation!.runId },
      data: { status: "cancelled" },
    });
  });

  it("never continues a failed run", async () => {
    await clearThread();
    const fixture = await runningRun();
    const result = await finalize(fixture, "failed");
    expect(result.explicitContinuation).toBeUndefined();
    expect(await system.run.count({ where: { continuationOfRunId: fixture.run.id } })).toBe(0);
  });

  it("stop cancels the pending continuation before it starts", async () => {
    await clearThread();
    const fixture = await runningRun();
    const result = await finalize(fixture, "completed", request(fixture.run));
    // The same statuses the thread Stop cancels (stopThreadRuns).
    await system.run.updateMany({
      where: { threadId: identity.threadId, status: { in: [...ACTIVE_RUN_STATUSES] } },
      data: { status: "cancelled", completedAt: new Date() },
    });
    const next = await system.run.findUniqueOrThrow({
      where: { id: result.explicitContinuation!.runId },
    });
    expect(next.status).toBe("cancelled");
    // A cancelled link is not resumable: waking it is a no-op.
    const publisher = new RunJobPublisher(
      db.prisma,
      { enqueue: vi.fn(), cancel: vi.fn(), close: vi.fn() } as unknown as JobPublisher,
      new RunStarter(new InMemoryRealtimeFanout()),
    );
    await runAsTenant(identity, () => publisher.enqueue(runContinueJob(next.id)));
    expect((await system.run.findUniqueOrThrow({ where: { id: next.id } })).status).toBe(
      "cancelled",
    );
  });

  it("a new user message joins the waiting continuation and starts it now (no second run)", async () => {
    await clearThread();
    const fixture = await runningRun();
    const result = await finalize(fixture, "completed", request(fixture.run));
    const sent = await runAsTenant(identity, () =>
      sendUserMessage(db.prisma, {
        ...identity,
        blocks: [{ kind: "text", text: "a che punto sei?" }],
        prompt: "a che punto sei?",
        trigger: "user",
      }),
    );
    expect(sent.runId).toBe(result.explicitContinuation!.runId);
    expect(sent.taskId).toBeNull();
    const next = await system.run.findUniqueOrThrow({
      where: { id: result.explicitContinuation!.runId },
    });
    expect(next.wakeAt!.getTime()).toBeLessThanOrEqual(Date.now());
    expect(
      await system.run.count({
        where: { threadId: identity.threadId, status: "queued" },
      }),
    ).toBe(1);
    expect(
      await system.steeringMessage.count({ where: { runId: next.id, messageId: sent.messageId } }),
    ).toBe(1);
  });

  it("merges into steering that arrived during the run, in the same conversation", async () => {
    await clearThread();
    const fixture = await runningRun();
    const steering = await createThreadMessage(system, {
      threadId: identity.threadId,
      role: "user",
      blocks: [{ kind: "text", text: "anche questo" }],
    });
    await system.steeringMessage.create({
      data: {
        messageId: steering.id,
        botId: identity.botId,
        userId: identity.userId,
        runId: fixture.run.id,
      },
    });
    const result = await finalize(fixture, "completed", request(fixture.run));
    expect(result.continuationRunId).toEqual(expect.any(String));
    expect(result.explicitContinuation).toEqual({ runId: result.continuationRunId, wakeAt: null });
    const merged = await system.run.findUniqueOrThrow({
      where: { id: result.continuationRunId! },
      include: { task: true },
    });
    expect(merged).toMatchObject({ continuationOfRunId: fixture.run.id, continuationIndex: 1 });
    expect(merged.task.prompt).toContain("[Continuation 1 of max 50");
    expect(
      await system.run.count({ where: { threadId: identity.threadId, status: "queued" } }),
    ).toBe(1);
  });

  it("is superseded by other live work instead of queueing beside it", async () => {
    await clearThread();
    const fixture = await runningRun();
    const other = await runningRun();
    const result = await finalize(fixture, "completed", request(fixture.run));
    expect(result.explicitContinuation).toBeUndefined();
    const reply = await system.message.findFirstOrThrow({
      where: { runId: fixture.run.id, role: "bot" },
      orderBy: { seq: "desc" },
    });
    expect(reply.blocks).toContainEqual(
      expect.objectContaining({ continuation: expect.objectContaining({ state: "superseded" }) }),
    );
    await system.run.update({ where: { id: other.run.id }, data: { status: "cancelled" } });
  });

  it("a channel run continues in the same channel with the same source", async () => {
    await clearThread();
    const channelId = randomUUID();
    const fixture = await runningRun({
      trigger: "messaging",
      sourceBlocks: [
        {
          kind: "channel_message",
          provider: "telegram",
          channelId,
          fromAddress: "@someone",
          fromLabel: "Someone",
          text: "traduci il libro",
        },
      ],
    });
    const result = await finalize(fixture, "completed", request(fixture.run));
    const next = await system.run.findUniqueOrThrow({
      where: { id: result.explicitContinuation!.runId },
      include: { sourceMessage: true },
    });
    expect(next.trigger).toBe("messaging");
    expect(next.sourceMessageId).toBe(fixture.source!.id);
    expect(next.sourceMessage?.blocks).toContainEqual(expect.objectContaining({ channelId }));
    await system.run.update({ where: { id: next.id }, data: { status: "cancelled" } });
  });

  it("a routine link carries the original task (routines read no history)", async () => {
    await clearThread();
    const fixture = await runningRun({ trigger: "routine", prompt: "Daily: dub chapter list" });
    const first = await finalize(fixture, "completed", request(fixture.run));
    const next = await system.run.findUniqueOrThrow({
      where: { id: first.explicitContinuation!.runId },
      include: { task: true },
    });
    expect(next.trigger).toBe("routine");
    expect(next.task.prompt).toContain("Original task:\nDaily: dub chapter list");
    await system.run.update({ where: { id: next.id }, data: { status: "cancelled" } });
  });

  it("owner origin is inherited exactly (owner run stays owner, member run stays member)", async () => {
    await clearThread();
    const fixture = await runningRun({ sourceBlocks: [{ kind: "text", text: "usa il mio pc" }] });
    const result = await finalize(fixture, "completed", request(fixture.run));
    const [original, next] = await Promise.all([
      system.run.findUniqueOrThrow({
        where: { id: fixture.run.id },
        include: { sourceMessage: true },
      }),
      system.run.findUniqueOrThrow({
        where: { id: result.explicitContinuation!.runId },
        include: { sourceMessage: true },
      }),
    ]);
    for (const key of ["trigger", "userId", "sourceMessageId", "spaceId", "botId"] as const) {
      expect(next[key]).toBe(original[key]);
    }
    expect(next.sourceMessage?.role).toBe(original.sourceMessage?.role);
    await system.run.update({ where: { id: next.id }, data: { status: "cancelled" } });
  });

  it("the cap is enforced across a real chain", async () => {
    await clearThread();
    let fixture = await runningRun();
    let chain = {
      id: fixture.run.id,
      continuationIndex: 0,
      continuationRootRunId: null as string | null,
    };
    for (let i = 0; i < 2; i++) {
      const result = await finalize(fixture, "completed", request(chain, { delayMs: 0 }, 2));
      const next = await system.run.update({
        where: { id: result.explicitContinuation!.runId },
        data: { status: "running", startedAt: new Date(), leaseOwner: "worker-1", leaseFence: 1 },
      });
      const attempt = await system.attempt.create({
        data: { runId: next.id, fence: 1, status: "running" },
      });
      fixture = {
        ...fixture,
        run: next,
        task: await system.task.findUniqueOrThrow({ where: { id: next.taskId } }),
        attempt,
      };
      chain = {
        id: next.id,
        continuationIndex: next.continuationIndex,
        continuationRootRunId: next.continuationRootRunId,
      };
    }
    expect(chain.continuationIndex).toBe(2);
    expect(chain.continuationRootRunId).not.toBeNull();
    const decision = decideContinuation({
      runId: chain.id,
      chain: {
        ...chain,
        continuationDigest: null,
        continuationRepeats: 0,
        continuationPercent: null,
      },
      summary: "more",
      workToolCalls: 1,
      settings: { maxContinuations: 2, maxRepeats: 3 },
    });
    expect(decision).toEqual({ ok: false, reason: "limit", index: 3, max: 2 });
    await system.run.update({ where: { id: chain.id }, data: { status: "cancelled" } });
  });
});
