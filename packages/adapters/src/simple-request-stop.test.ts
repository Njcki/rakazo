import { describe, expect, it } from "vitest";
import { looksLikeDanglingNarration } from "./final-answer-guard.js";
import {
  AUTO_PLAN_SUMMARY,
  answeredInFull,
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
