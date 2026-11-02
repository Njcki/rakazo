import { describe, expect, it } from "vitest";
import {
  decideAutoContinuation,
  hitToolCallBudget,
  planGateVerdict,
} from "./plan-completion-gate.js";
import { PLAN_VERIFY_STEP_TITLE, type PlanDto, type PlanStepDto } from "./plan-tools.js";

const t0 = new Date("2026-11-02T11:54:00Z");
const after = "2026-11-02T11:55:00.000Z";
const before = "2026-11-01T09:00:00.000Z";

function step(
  index: number,
  title: string,
  status: PlanStepDto["status"],
  updatedAt = after,
): PlanStepDto {
  return { id: `s${index}`, index, title, status, notes: "", blockedBy: [], updatedAt };
}

function plan(
  steps: PlanStepDto[],
  updatedAt = after,
  status: PlanDto["status"] = "active",
): PlanDto {
  const done = steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  return {
    id: "p",
    botId: "b",
    title: "Dub",
    status,
    summary: "",
    progress: { done, total: steps.length, percent: 0 },
    nextStep: null,
    steps,
    createdAt: updatedAt,
    updatedAt,
    guidance: "",
  };
}

const verdict = (p: PlanDto | null, used = false) =>
  planGateVerdict({ plan: p, chainStartedAt: t0, planToolUsedThisRun: used });

describe("planGateVerdict", () => {
  it("keeps going while work steps are open", () => {
    const v = verdict(
      plan([step(1, "A", "done"), step(2, "B", "todo"), step(3, PLAN_VERIFY_STEP_TITLE, "todo")]),
    );
    expect(v).toMatchObject({ open: true, reason: "plan_open" });
  });

  it("keeps going while only the verification is open", () => {
    const v = verdict(plan([step(1, "A", "done"), step(2, PLAN_VERIFY_STEP_TITLE, "in_progress")]));
    expect(v).toMatchObject({ open: true, reason: "verification_pending" });
  });

  it("treats a finished plan without a verification step as pending verification", () => {
    expect(verdict(plan([step(1, "A", "done")]))).toMatchObject({
      open: true,
      reason: "verification_pending",
    });
  });

  it("stops when everything is closed, no plan, closed plan, stale, or all blocked", () => {
    expect(
      verdict(plan([step(1, "A", "done"), step(2, PLAN_VERIFY_STEP_TITLE, "done")])),
    ).toMatchObject({ open: false, why: "all_closed" });
    expect(verdict(null)).toMatchObject({ open: false, why: "no_plan" });
    expect(verdict(plan([step(1, "A", "todo")], after, "completed"))).toMatchObject({
      open: false,
      why: "not_active",
    });
    expect(verdict(plan([step(1, "A", "todo", before)], before))).toMatchObject({
      open: false,
      why: "stale",
    });
    expect(verdict(plan([step(1, "A", "todo", before)], before), true)).toMatchObject({
      open: true,
    });
    expect(
      verdict(plan([step(1, "A", "blocked"), step(2, PLAN_VERIFY_STEP_TITLE, "todo")])),
    ).toMatchObject({ open: false, why: "all_blocked" });
  });
});

describe("decideAutoContinuation", () => {
  const settings = { maxContinuations: 50, maxRepeats: 3 };
  const first = {
    continuationIndex: 0,
    continuationRootRunId: null,
    continuationDigest: null,
    continuationRepeats: 0,
    continuationPercent: null,
  };
  const base = {
    runId: "r1",
    chain: first,
    settings,
    workToolCalls: 12,
    replyText: "140 su 4.363 (3,21%).",
    progressLine: "Plan «Dub»: 2/3 steps closed; open: 3. Verify (todo)",
    maxSummaryChars: 2000,
  };

  it("does nothing without a reason", () => {
    expect(decideAutoContinuation({ ...base, reason: undefined })).toEqual({ kind: "none" });
  });

  it("schedules the next part marked as automatic", () => {
    const d = decideAutoContinuation({ ...base, reason: "verification_pending" });
    expect(d.kind).toBe("continue");
    if (d.kind !== "continue") return;
    expect(d.request).toMatchObject({
      index: 1,
      max: 50,
      rootRunId: "r1",
      auto: "verification_pending",
    });
    expect(d.request.summary).toContain("3,21%");
  });

  it("respects the chain limit and the no-progress guard", () => {
    expect(
      decideAutoContinuation({
        ...base,
        reason: "plan_open",
        chain: { ...first, continuationIndex: 50 },
      }),
    ).toMatchObject({ kind: "refused", refused: { state: "limit" } });
    expect(
      decideAutoContinuation({
        ...base,
        reason: "plan_open",
        workToolCalls: 0,
        chain: {
          ...first,
          continuationIndex: 4,
          continuationRootRunId: "r0",
          continuationRepeats: 2,
        },
      }),
    ).toMatchObject({ kind: "refused", refused: { state: "no_progress" } });
  });
});

describe("hitToolCallBudget", () => {
  it("only when the limit is on and the note is in the reply", () => {
    expect(hitToolCallBudget("x STOP", 100, "STOP")).toBe(true);
    expect(hitToolCallBudget("x STOP", 0, "STOP")).toBe(false);
    expect(hitToolCallBudget("x", 100, "STOP")).toBe(false);
  });
});
