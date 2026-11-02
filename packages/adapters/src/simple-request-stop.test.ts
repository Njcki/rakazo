import { describe, expect, it } from "vitest";
import { continuationPrompt } from "./continue-later.js";
import { looksLikeDanglingNarration } from "./final-answer-guard.js";
import {
  AUTO_PLAN_SUMMARY,
  answeredInFull,
  chainStepProgressOf,
  isAutoPlan,
  isGoalUnfinished,
  isNoProgressPart,
  planGateVerdict,
} from "./plan-completion-gate.js";
import {
  AUTO_PLAN_STEP_TITLE,
  PLAN_VERIFY_STEP_TITLE,
  type PlanDto,
  type PlanStepDto,
} from "./plan-tools.js";
import { closesWholeJob, looksLikeWholeJobGoal, needsAutoPlan } from "./user-intent.js";

// A simple request ("weather for the next 7 days") answered in full must end after one run;
// a "fino al 100%" job closed one batch at a time must keep going.
const t0 = new Date("2026-03-02T10:00:00Z");
const after = "2026-03-02T10:05:00.000Z";

function step(index: number, title: string, status: PlanStepDto["status"]): PlanStepDto {
  return { id: `s${index}`, index, title, status, notes: "", blockedBy: [], updatedAt: after };
}

function plan(steps: PlanStepDto[], summary = ""): PlanDto {
  const done = steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  return {
    id: "p",
    botId: "b",
    title: "t",
    status: "active",
    summary,
    progress: { done, total: steps.length, percent: 0 },
    nextStep: null,
    steps,
    createdAt: after,
    updatedAt: after,
    guidance: "",
  };
}

const verdictOf = (p: PlanDto | null) =>
  planGateVerdict({ plan: p, chainStartedAt: t0, planToolUsedThisRun: true });

const WEATHER_REQUEST = "meteo per i prossimi 7gg a Pesaro";
const WEATHER_ANSWER = [
  "Dati meteo estratti con successo. Procedo con la stesura del bollettino.",
  "",
  "Ecco la sintesi delle previsioni per **Pesaro** per i prossimi 7 giorni:",
  "",
  "* **Lunedì:** cielo coperto, vento forte da nord-est, 9–15 °C.",
  "* **Martedì:** schiarite, 12–16 °C.",
  "* **Mercoledì – Domenica:** fase stabile, minime 6–8 °C e massime 14–16 °C.",
  "",
  "Il bollettino completo in PDF è allegato.",
].join("\n");

describe("simple request answered in full (weather)", () => {
  it("is not a whole-job goal and the answer is not dangling", () => {
    expect(looksLikeWholeJobGoal(WEATHER_REQUEST)).toBe(false);
    expect(looksLikeDanglingNarration(WEATHER_ANSWER)).toBe(false);
  });

  it("gets no automatic plan after many tool calls when the answer is complete", () => {
    expect(
      needsAutoPlan({
        requestTexts: [WEATHER_REQUEST],
        workToolCalls: 18,
        minTools: 12,
        continuationIndex: 0,
        replyUnfinished: looksLikeDanglingNarration(WEATHER_ANSWER),
        replyClaimsDone: closesWholeJob(WEATHER_ANSWER),
      }),
    ).toBe(false);
  });

  it("still gets one when the reply stops on an announced step", () => {
    const dangling = "Dati estratti. Ora genero il PDF:";
    expect(
      needsAutoPlan({
        requestTexts: [WEATHER_REQUEST],
        workToolCalls: 18,
        minTools: 12,
        replyUnfinished: looksLikeDanglingNarration(dangling),
      }),
    ).toBe(true);
  });

  it("never gets a new automatic plan in a later part", () => {
    expect(
      needsAutoPlan({
        requestTexts: [WEATHER_REQUEST],
        workToolCalls: 20,
        minTools: 12,
        continuationIndex: 1,
        replyUnfinished: true,
      }),
    ).toBe(false);
  });

  it("closes an open automatic plan when the final answer delivers the request", () => {
    const auto = plan(
      [step(1, AUTO_PLAN_STEP_TITLE, "in_progress"), step(2, PLAN_VERIFY_STEP_TITLE, "todo")],
      AUTO_PLAN_SUMMARY,
    );
    expect(isAutoPlan(auto)).toBe(true);
    const reply = `${WEATHER_ANSWER}\n\nIl compito è completato.`;
    expect(answeredInFull({ verdict: verdictOf(auto), plan: auto, replyText: reply })).toBe(true);
  });

  it("accepts a complete answer when only the verification is left", () => {
    const own = plan([step(1, "Scarica i dati", "done"), step(2, PLAN_VERIFY_STEP_TITLE, "todo")]);
    const reply = "Tutti gli obiettivi della richiesta sono stati completati e verificati.";
    expect(answeredInFull({ verdict: verdictOf(own), plan: own, replyText: reply })).toBe(true);
  });

  it("does not end a model plan with real work open on a done claim", () => {
    const own = plan([
      step(1, "Scarica i dati", "done"),
      step(2, "Scrivi il PDF", "todo"),
      step(3, PLAN_VERIFY_STEP_TITLE, "todo"),
    ]);
    expect(
      answeredInFull({ verdict: verdictOf(own), plan: own, replyText: "Il compito è completato." }),
    ).toBe(false);
  });

  it("stops at the first automatic part without real work", () => {
    expect(
      isNoProgressPart({
        reason: "plan_created",
        continuationIndex: 2,
        workToolCalls: 0,
        fence: 1,
      }),
    ).toBe(true);
    expect(
      isNoProgressPart({ reason: "plan_open", continuationIndex: 1, workToolCalls: 4, fence: 1 }),
    ).toBe(false);
  });

  it("lets a part recovered after a restart go on even with no work yet", () => {
    expect(
      isNoProgressPart({
        reason: "goal_unfinished",
        continuationIndex: 1,
        workToolCalls: 0,
        fence: 2,
      }),
    ).toBe(false);
    expect(
      isNoProgressPart({ reason: "tool_budget", continuationIndex: 3, workToolCalls: 0, fence: 1 }),
    ).toBe(false);
  });
});

describe("long whole-job request (dubbing to 100%)", () => {
  const goal = "Prosegui fino al 100% del gioco base";
  const batchReply =
    "Lotto completato: 3 copioni verificati, 337 battute scritte su 4363 totali. Il piano di lavoro è stato completato.";

  it("a closed batch is not a complete answer", () => {
    expect(closesWholeJob(batchReply)).toBe(false);
    const auto = plan([step(1, AUTO_PLAN_STEP_TITLE, "in_progress")], AUTO_PLAN_SUMMARY);
    expect(answeredInFull({ verdict: verdictOf(auto), plan: auto, replyText: batchReply })).toBe(
      false,
    );
  });

  it("continues through goal_unfinished in later parts (no auto plan needed)", () => {
    expect(
      needsAutoPlan({
        requestTexts: [goal],
        workToolCalls: 30,
        minTools: 12,
        continuationIndex: 3,
      }),
    ).toBe(false);
    expect(
      isGoalUnfinished({
        wholeJobGoal: looksLikeWholeJobGoal(goal),
        verdict: { open: false, why: "no_plan" },
        continuationIndex: 3,
        planToolUsedThisRun: true,
        workToolCalls: 30,
        replyText: batchReply,
        userAskedToStopOrChange: false,
      }),
    ).toBe(true);
    expect(
      isNoProgressPart({
        reason: "goal_unfinished",
        continuationIndex: 3,
        workToolCalls: 30,
        fence: 1,
      }),
    ).toBe(false);
  });

  it("ends when the reply says the whole job is done", () => {
    expect(
      isGoalUnfinished({
        wholeJobGoal: true,
        verdict: { open: false, why: "no_plan" },
        continuationIndex: 9,
        planToolUsedThisRun: true,
        workToolCalls: 30,
        replyText: "Lavoro completato al 100%: 4363 battute su 4363.",
        userAskedToStopOrChange: false,
      }),
    ).toBe(false);
  });
});

describe("a part that redoes finished work (generic batches)", () => {
  const t = (iso: string) => new Date(`2026-03-02T${iso}Z`);
  const runStart = t("10:30:00");
  const s = (title: string, status: string, at: string) => ({
    title,
    status,
    updatedAt: t(at),
  });

  it("counts only steps no earlier part had finished", () => {
    const plans = [
      // this part: a new plan with the same work steps as the batch finished before
      {
        steps: [
          s("Batch 7: write items 1-3", "done", "10:31:00"),
          s(AUTO_PLAN_STEP_TITLE, "done", "10:31:00"),
        ],
      },
      {
        steps: [
          s("batch 7 — write items 1-3", "done", "10:10:00"),
          s(PLAN_VERIFY_STEP_TITLE, "done", "10:11:00"),
        ],
      },
    ];
    const progress = chainStepProgressOf(plans, runStart);
    expect(progress.fresh).toEqual([]);
    expect(progress.redone).toHaveLength(1);
    expect(progress.doneBefore).toEqual(["batch 7 — write items 1-3"]);
    expect(
      isNoProgressPart({
        reason: "goal_unfinished",
        continuationIndex: 3,
        workToolCalls: 9,
        fence: 1,
        planToolUsedThisRun: true,
        freshDoneSteps: progress.fresh.length,
      }),
    ).toBe(true);
  });

  it("a part that only closes the automatic plan is no progress", () => {
    const progress = chainStepProgressOf(
      [
        {
          steps: [
            s(AUTO_PLAN_STEP_TITLE, "done", "10:31:00"),
            s(PLAN_VERIFY_STEP_TITLE, "done", "10:32:00"),
          ],
        },
      ],
      runStart,
    );
    expect(progress.fresh).toEqual([]);
    expect(
      isNoProgressPart({
        reason: "plan_open",
        continuationIndex: 1,
        workToolCalls: 14,
        fence: 1,
        planToolUsedThisRun: true,
        freshDoneSteps: 0,
      }),
    ).toBe(true);
  });

  it("the next batch is progress and the chain goes on", () => {
    const progress = chainStepProgressOf(
      [
        { steps: [s("Batch 8: write items 4-6", "done", "10:40:00")] },
        { steps: [s("Batch 7: write items 1-3", "done", "10:10:00")] },
      ],
      runStart,
    );
    expect(progress.fresh).toEqual(["Batch 8: write items 4-6"]);
    expect(
      isNoProgressPart({
        reason: "goal_unfinished",
        continuationIndex: 2,
        workToolCalls: 20,
        fence: 1,
        planToolUsedThisRun: true,
        freshDoneSteps: 1,
      }),
    ).toBe(false);
  });

  it("the next prompt lists the finished steps as DONE", () => {
    const prompt = continuationPrompt({
      index: 2,
      max: 50,
      auto: "goal_unfinished",
      doneSteps: ["Batch 7: write items 1-3"],
    });
    expect(prompt).toContain("already DONE");
    expect(prompt).toContain("«Batch 7: write items 1-3»");
    expect(prompt).toContain("Do not redo");
  });
});
