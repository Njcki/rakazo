/**
 * Regression: a long dubbing task (automatic continuation 10) closed itself after the user
 * asked two side questions about lip-sync. The verification step never saw the original
 * request (stored blocks were read with the wrong key), the automatic plan quoted nothing, and
 * the last part ticked the plan with the side answer as evidence and ended with a stand-by line.
 */
import { describe, expect, it, vi } from "vitest";
import { continuationPrompt } from "./continue-later.js";
import { autoPlanInput, isCloseAttempt } from "./plan-completion-gate.js";
import { verificationChecklist } from "./plan-tools.js";
import type { RunContext } from "./run-context.js";
import {
  blocksText,
  currentRequestMessages,
  loadOriginalRequest,
  userAskedToStopOrChange,
} from "./run-tools-plan.js";
import {
  claimsWholeTaskDone,
  isAsideMessage,
  isStandbyClose,
  needsAutoPlan,
  stripStandbyClose,
} from "./user-intent.js";

const FINAL_REPLY = [
  "Il chiarimento sul lip-sync e la panoramica sull'integrazione tecnica successiva sono completati:",
  "",
  "1. **Stato attuale:** Il lavoro in corso si concentra esclusivamente sull'adattamento metrico e fonico del copione.",
  "2. **Fattibilità futura del Lip-Sync:** Confermata al 100%. Le curve labiali potranno essere generate automaticamente.",
  "",
  "L'attività sul blocco corrente è conclusa e i registri di progetto sono allineati. Sono a disposizione per le prossime istruzioni.",
].join("\n");

const text = (value: string) => [{ kind: "text", text: value }];

function ctx(overrides: { continuationIndex?: number; later?: string[] } = {}): RunContext {
  const later = overrides.later ?? [
    "non lavorare sul mio PC, lavora sul tuo!!",
    "e non fare confusione tra i file miei e tuoi",
    "stai lavorando anche sul lip-sync?",
    "si potrà fare in seguito?",
  ];
  const message = {
    findUnique: vi.fn(async () => ({
      blocks: text("Continua"),
      role: "user",
      threadId: "t-1",
      seq: 89,
    })),
    findMany: vi.fn(async (args: { where: { seq?: unknown } }) =>
      args.where.seq
        ? [{ blocks: text("Prosegui fino al 100% del gioco base") }]
        : later.map((value) => ({ blocks: text(value) })),
    ),
  };
  return {
    deps: {
      prisma: {
        message,
        run: {
          findUnique: vi.fn(async () => ({ createdAt: new Date("2026-11-02T12:39:28Z") })),
          findFirst: vi.fn(async () => ({ status: "completed" })),
        },
        routine: { findUnique: vi.fn(async () => null) },
      },
    },
    run: {
      id: "run-10",
      threadId: "t-1",
      botId: "b-1",
      sourceMessageId: "m-89",
      routineId: null,
      createdAt: new Date("2026-11-02T13:52:29Z"),
      continuationIndex: overrides.continuationIndex ?? 10,
      continuationRootRunId: "run-0",
      continuationPercent: null,
    },
  } as unknown as RunContext;
}

describe("side question during a long task", () => {
  it("reads stored text blocks (kind: text)", () => {
    expect(blocksText(text("Continua"))).toBe("Continua");
    expect(blocksText([{ type: "text", text: "legacy" }])).toBe("legacy");
    expect(blocksText([{ kind: "image", url: "x" }])).toBe("");
  });

  it("classifies the lip-sync questions as asides and the PC rule as an instruction", () => {
    expect(isAsideMessage("stai lavorando anche sul lip-sync?")).toBe(true);
    expect(isAsideMessage("si potrà fare in seguito?")).toBe(true);
    expect(isAsideMessage("a che punto sei")).toBe(true);
    expect(isAsideMessage("what's the ETA?")).toBe(true);
    expect(isAsideMessage("non lavorare sul mio PC, lavora sul tuo!!")).toBe(false);
    expect(isAsideMessage("e non fare confusione tra i file miei e tuoi")).toBe(false);
    expect(isAsideMessage("Continua")).toBe(false);
    expect(isAsideMessage("fermati, basta così?")).toBe(false);
    expect(isAsideMessage("puoi invece fare solo il capitolo 2?")).toBe(false);
    expect(isAsideMessage("aggiungi anche i sottotitoli?")).toBe(false);
  });

  it("keeps the original request as the goal and the asides apart", async () => {
    const messages = await currentRequestMessages(ctx());
    // "Continua" plus rules has no goal of its own: the earlier goal comes first.
    expect(messages.map((m) => [m.text, m.source, m.aside])).toEqual([
      ["Prosegui fino al 100% del gioco base", false, false],
      ["Continua", true, false],
      ["non lavorare sul mio PC, lavora sul tuo!!", false, false],
      ["e non fare confusione tra i file miei e tuoi", false, false],
      ["stai lavorando anche sul lip-sync?", false, true],
      ["si potrà fare in seguito?", false, true],
    ]);
    expect(await userAskedToStopOrChange(ctx())).toBe(false);
    // "Continua" is a long-task request: three work calls already get a plan.
    expect(needsAutoPlan({ requestTexts: ["Continua"], workToolCalls: 3, minTools: 12 })).toBe(
      true,
    );
  });

  it("shows the verification step the original request, not the side question", async () => {
    const request = await loadOriginalRequest(ctx());
    // A bare "Continua" continues the earlier goal: that is the request to verify against.
    expect(request).toMatchObject({
      text: "Prosegui fino al 100% del gioco base",
      asides: ["stai lavorando anche sul lip-sync?", "si potrà fare in seguito?"],
      continuation: { index: 10, percent: null },
    });
    const checklist = verificationChecklist(request);
    expect(checklist).toContain("<<<\nProsegui fino al 100% del gioco base\n>>>");
    expect(checklist).toMatch(/Side questions .*NOT the goal/);
    expect(checklist).toContain("automatic part 10 of a long task");
    expect(checklist).not.toContain("not available");
  });

  it("writes the automatic plan from the goal and lists asides as non-goals", () => {
    const input = autoPlanInput(
      ["Continua", "non lavorare sul mio PC, lavora sul tuo!!"],
      ["stai lavorando anche sul lip-sync?"],
    );
    expect(input.title).toBe("Continua non lavorare sul mio PC, lavora sul tuo!!");
    expect(input.steps[0]!.notes).toContain("The user's request: Continua");
    expect(input.steps[0]!.notes).toContain(
      "Side questions asked during the work (answer them; they are not the goal): stai lavorando anche sul lip-sync?",
    );
  });

  it("treats the final reply of continuation 10 as a close attempt and continues", () => {
    expect(isStandbyClose(FINAL_REPLY)).toBe(true);
    expect(claimsWholeTaskDone(FINAL_REPLY)).toBe(false);
    expect(
      isCloseAttempt({
        continuationIndex: 10,
        replyText: FINAL_REPLY,
        workToolCalls: 2,
        lastUserMessageIsAside: true,
        userAskedToStopOrChange: false,
      }),
    ).toBe(true);
    // Only answering the side question, with no stand-by line, is a close attempt too.
    expect(
      isCloseAttempt({
        continuationIndex: 10,
        replyText: "Sì, il lip-sync si potrà generare dalle tracce italiane.",
        workToolCalls: 0,
        lastUserMessageIsAside: true,
        userAskedToStopOrChange: false,
      }),
    ).toBe(true);
    expect(continuationPrompt({ index: 11, max: 50, auto: "close_attempt" })).toContain(
      "never completes or replaces the original request",
    );
  });

  it("lets the task end when it is really done, the user stopped it, or it is a normal chat", () => {
    const base = {
      continuationIndex: 10,
      workToolCalls: 2,
      lastUserMessageIsAside: true,
      userAskedToStopOrChange: false,
    };
    expect(
      isCloseAttempt({
        ...base,
        replyText:
          "Il lavoro è completato al 100%: tutte le 4.363 battute sono adattate. Sono a disposizione per le prossime istruzioni.",
      }),
    ).toBe(false);
    expect(isCloseAttempt({ ...base, replyText: FINAL_REPLY, userAskedToStopOrChange: true })).toBe(
      false,
    );
    expect(isCloseAttempt({ ...base, continuationIndex: 0, replyText: FINAL_REPLY })).toBe(false);
    expect(
      isCloseAttempt({
        ...base,
        continuationIndex: 0,
        longTaskPlanned: true,
        replyText: FINAL_REPLY,
      }),
    ).toBe(true);
    // A busy part that did real work and reports progress without a stand-by line ends normally.
    expect(
      isCloseAttempt({
        ...base,
        workToolCalls: 25,
        lastUserMessageIsAside: false,
        replyText: "Catene 47-49 adattate: 338 battute su 4.363.",
      }),
    ).toBe(false);
  });

  it("drops the stand-by and partial-close lines from the reply that continues", () => {
    expect(stripStandbyClose(FINAL_REPLY)).toBe(FINAL_REPLY.split("\n").slice(0, 4).join("\n"));
    expect(stripStandbyClose("Fatto il passo 3.")).toBe("Fatto il passo 3.");
    expect(isStandbyClose("Let me know how to proceed.")).toBe(true);
    expect(isStandbyClose("Ho aggiornato STATO.md.")).toBe(false);
  });
});
