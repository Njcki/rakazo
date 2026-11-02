/**
 * Regression: a long job ("Prosegui fino al 100%") was resumed hours later with a bare
 * "Continua". The bot planned one batch, finished it, ticked the verification step against
 * "Continua" (the only request it saw) and closed the plan; the automatic continuation that a
 * deploy restarted mid-run only called plan_complete and ended with "Il piano di lavoro è stato
 * completato", which counted as "whole task done". Nothing continued at 8% of the job.
 */
import { describe, expect, it, vi } from "vitest";
import { continuationPrompt } from "./continue-later.js";
import {
  decideAutoContinuation,
  isGoalUnfinished,
  type PlanGateVerdict,
} from "./plan-completion-gate.js";
import { verificationChecklist } from "./plan-tools.js";
import type { RunContext } from "./run-context.js";
import { currentRequestMessages, findStandingGoal, loadOriginalRequest } from "./run-tools-plan.js";
import {
  claimsWholeTaskDone,
  closesWholeJob,
  isBareContinuation,
  isConstraintOnly,
  looksLikeWholeJobGoal,
  reportsPartialProgress,
} from "./user-intent.js";

const text = (value: string) => [{ kind: "text", text: value }];

/** Older first, like the thread: goal, then follow-ups, rules and side questions. */
const THREAD = [
  { seq: 10, text: "Procedi con il lavoro descritto nei file che ti ho dato" },
  { seq: 20, text: "Prosegui fino al 100%" },
  { seq: 30, text: "Continua" },
  { seq: 40, text: "non lavorare sul mio PC, lavora sul tuo!!" },
  { seq: 41, text: "e non fare confusione tra i file miei e tuoi" },
  { seq: 50, text: "stai lavorando anche sul lip-sync?" },
  { seq: 51, text: "si potrà fare in seguito?" },
  { seq: 60, text: "Continua" },
];

function prismaFor(thread: { seq: number; text: string; channelId?: string }[]) {
  const blocksOf = (row: { text: string; channelId?: string }) =>
    row.channelId
      ? [{ kind: "channel_message", channelId: row.channelId, text: row.text }]
      : text(row.text);
  return {
    message: {
      findUnique: vi.fn(async (args: { where: { id: string } }) => {
        const row = thread.find((r) => `m-${r.seq}` === args.where.id)!;
        return { blocks: blocksOf(row), role: "user", threadId: "t-1", seq: row.seq };
      }),
      findMany: vi.fn(
        async (args: { where: { seq?: { lt: number }; createdAt?: unknown }; take?: number }) => {
          if (args.where.seq) {
            return thread
              .filter((r) => r.seq < args.where.seq!.lt)
              .reverse()
              .slice(0, args.take)
              .map((r) => ({ blocks: blocksOf(r), seq: r.seq }));
          }
          return []; // nothing written since this request started
        },
      ),
    },
    run: {
      findUnique: vi.fn(async () => ({ createdAt: new Date("2026-01-01T10:00:00Z") })),
      findFirst: vi.fn(async () => ({ status: "completed" })),
    },
    routine: { findUnique: vi.fn(async () => null) },
  };
}

function ctx(overrides: { index?: number; channelId?: string; thread?: typeof THREAD } = {}) {
  return {
    deps: { prisma: prismaFor(overrides.thread ?? THREAD) },
    source: { channelId: overrides.channelId },
    run: {
      id: "run-1",
      threadId: "t-1",
      botId: "b-1",
      sourceMessageId: "m-60",
      routineId: null,
      createdAt: new Date("2026-01-01T10:06:00Z"),
      continuationIndex: overrides.index ?? 1,
      continuationRootRunId: "run-0",
      continuationPercent: null,
    },
  } as unknown as RunContext;
}

const BATCH_REPLY = [
  "### Avanzamento completato (lotto 47, 48 e 49)",
  "- Nuove battute: +12 (da 325 a 337).",
  "Conteggio: 337 battute scritte su 4363 totali (7,72% del totale).",
].join("\n");

const CLOSE_REPLY = [
  "Il piano di lavoro è stato completato e archiviato con successo.",
  "",
  "Tutte le attività previste per il lotto 47, 48 e 49 risultano pienamente concluse e verificate:",
  "- Copioni redatti.",
  "- Registri allineati.",
].join("\n");

const CLOSED: PlanGateVerdict = { open: false, why: "not_active" };

describe("whole-job goal resumed with a bare 'Continua'", () => {
  it("recognises bare follow-ups, rules and whole-job goals", () => {
    for (const value of ["Continua", "continua", "prosegui pure", "Ok, vai avanti", "keep going"])
      expect(isBareContinuation(value)).toBe(true);
    expect(isBareContinuation("Prosegui fino al 100%")).toBe(false);
    expect(isBareContinuation("continua a tradurre il capitolo 3")).toBe(false);
    expect(isConstraintOnly("non lavorare sul mio PC, lavora sul tuo!!")).toBe(true);
    expect(isConstraintOnly("e non fare confusione tra i file miei e tuoi")).toBe(true);
    expect(looksLikeWholeJobGoal("Prosegui fino al 100%")).toBe(true);
    expect(looksLikeWholeJobGoal("devi proseguire ricorsivamente fino alla fine")).toBe(true);
    expect(looksLikeWholeJobGoal("Continua")).toBe(false);
  });

  it("finds the goal a bare 'Continua' continues, skipping asides and keeping rules", async () => {
    const goal = await findStandingGoal(ctx().deps.prisma, { threadId: "t-1", beforeSeq: 60 });
    expect(goal).toEqual({
      text: "Prosegui fino al 100%",
      seq: 20,
      constraints: [
        "non lavorare sul mio PC, lavora sul tuo!!",
        "e non fare confusione tra i file miei e tuoi",
      ],
    });
  });

  it("stops at a stop/change request: there is no goal to resume", async () => {
    const thread = [...THREAD.slice(0, 2), { seq: 25, text: "basta, fermati qui" }, THREAD[7]!];
    expect(
      await findStandingGoal(prismaFor(thread) as never, { threadId: "t-1", beforeSeq: 60 }),
    ).toBeUndefined();
  });

  it("only reads the run's own channel in channel conversations", async () => {
    const thread = [
      { seq: 5, text: "Prosegui fino al 100%", channelId: "ch-a" },
      { seq: 6, text: "traduci solo il titolo", channelId: "ch-b" },
      { seq: 60, text: "Continua", channelId: "ch-a" },
    ];
    const goal = await findStandingGoal(prismaFor(thread) as never, {
      threadId: "t-1",
      beforeSeq: 60,
      channelId: "ch-a",
    });
    expect(goal?.text).toBe("Prosegui fino al 100%");
  });

  it("puts the inherited goal into the request and the verification step", async () => {
    const messages = await currentRequestMessages(ctx());
    expect(messages[0]).toMatchObject({ text: "Prosegui fino al 100%", inherited: true });
    expect(messages.at(-1)).toMatchObject({ text: "Continua", source: true });
    const request = await loadOriginalRequest(ctx());
    expect(request?.text).toBe("Prosegui fino al 100%");
    expect(request?.instructions).toContain("non lavorare sul mio PC, lavora sul tuo!!");
    const checklist = verificationChecklist(request);
    expect(checklist).toContain("<<<\nProsegui fino al 100%\n>>>");
    expect(checklist).toContain("not the current chunk");
  });

  it("does not take a closed plan or a finished batch for the whole job", () => {
    expect(claimsWholeTaskDone(CLOSE_REPLY)).toBe(false);
    expect(closesWholeJob(BATCH_REPLY)).toBe(false);
    expect(reportsPartialProgress("337 battute scritte su 4363 totali")).toBe(true);
    expect(reportsPartialProgress("avanzamento: 40%")).toBe(true);
    expect(reportsPartialProgress("4363 su 4363 battute, completato al 100%")).toBe(false);
    expect(closesWholeJob("Lavoro completato al 100%: 4363 su 4363 battute.")).toBe(true);
    expect(
      closesWholeJob("Tutto il lavoro è completato, ultimo lotto incluso: completato al 100%."),
    ).toBe(true);
  });

  it("continues the part a deploy restarted (no work, plan_complete only)", () => {
    const base = {
      wholeJobGoal: true,
      verdict: CLOSED,
      continuationIndex: 1,
      planToolUsedThisRun: true,
      workToolCalls: 0,
      replyText: CLOSE_REPLY,
      verifyNotes: "Tutti gli obiettivi del lotto sono soddisfatti: copioni, backup, registri.",
      userAskedToStopOrChange: false,
      minTools: 12,
    };
    expect(isGoalUnfinished(base)).toBe(true);
    // The first part (index 0) that planned and closed one batch continues too.
    expect(isGoalUnfinished({ ...base, continuationIndex: 0, replyText: BATCH_REPLY })).toBe(true);
    // The loop guard still bounds it: a part without work counts as no progress.
    const decision = decideAutoContinuation({
      runId: "run-1",
      chain: {
        continuationIndex: 1,
        continuationRootRunId: "run-0",
        continuationDigest: null,
        continuationRepeats: 0,
        continuationPercent: null,
      },
      settings: { maxContinuations: 50, maxRepeats: 3 },
      workToolCalls: 0,
      reason: "goal_unfinished",
      replyText: CLOSE_REPLY,
      progressLine: undefined,
      maxSummaryChars: 2000,
    });
    expect(decision).toMatchObject({ kind: "continue", request: { index: 2, repeats: 1 } });
    expect(continuationPrompt({ index: 2, max: 50, auto: "goal_unfinished" })).toContain(
      "A finished batch, chunk or plan is not the end of the job",
    );
  });

  it("lets the job end when it is really done, stopped, blocked or just a short chat", () => {
    const base = {
      wholeJobGoal: true,
      verdict: CLOSED,
      continuationIndex: 3,
      planToolUsedThisRun: true,
      workToolCalls: 20,
      replyText: "Lavoro completato al 100%: 4363 su 4363 battute.",
      userAskedToStopOrChange: false,
      minTools: 12,
    };
    expect(isGoalUnfinished(base)).toBe(false);
    expect(
      isGoalUnfinished({
        ...base,
        replyText: CLOSE_REPLY,
        verifyNotes: "Tutto il lavoro è completato al 100%: 4363 su 4363.",
      }),
    ).toBe(false);
    expect(
      isGoalUnfinished({ ...base, replyText: CLOSE_REPLY, userAskedToStopOrChange: true }),
    ).toBe(false);
    expect(
      isGoalUnfinished({
        ...base,
        replyText: CLOSE_REPLY,
        verdict: { open: false, why: "all_blocked" },
      }),
    ).toBe(false);
    expect(isGoalUnfinished({ ...base, replyText: CLOSE_REPLY, wholeJobGoal: false })).toBe(false);
    // A short chat ("traduci tutto il paragrafo", two tool calls, no plan) is left alone.
    expect(
      isGoalUnfinished({
        ...base,
        replyText: "Ecco la traduzione.",
        continuationIndex: 0,
        planToolUsedThisRun: false,
        workToolCalls: 2,
      }),
    ).toBe(false);
  });
});
