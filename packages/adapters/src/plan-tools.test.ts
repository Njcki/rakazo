import { describe, expect, it } from "vitest";
import {
  coercePlanStepStatus,
  isPlanStepStatus,
  planStaleReminder,
  type PlanDto,
} from "./plan-tools.js";

function samplePlan(overrides: Partial<PlanDto> = {}): PlanDto {
  const steps = overrides.steps ?? [
    {
      id: "s1",
      index: 1,
      title: "Research",
      status: "done" as const,
      notes: "",
      blockedBy: [],
      updatedAt: new Date().toISOString(),
    },
    {
      id: "s2",
      index: 2,
      title: "Implement",
      status: "todo" as const,
      notes: "",
      blockedBy: [1],
      updatedAt: new Date().toISOString(),
    },
  ];
  const done = steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  const base: PlanDto = {
    id: "p1",
    botId: "b1",
    title: "Ship feature",
    status: "active",
    summary: "",
    progress: { done, total: steps.length, percent: Math.round((done / steps.length) * 100) },
    nextStep: steps.find((s) => s.status === "todo" || s.status === "in_progress") ?? null,
    steps,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    guidance: "test",
  };
  return { ...base, ...overrides, steps };
}

describe("plan-tools helpers", () => {
  it("accepts known step statuses", () => {
    expect(isPlanStepStatus("in_progress")).toBe(true);
    expect(isPlanStepStatus("nope")).toBe(false);
    expect(coercePlanStepStatus("blocked")).toBe("blocked");
    expect(coercePlanStepStatus("x")).toBe("todo");
  });

  it("builds a stale reminder for open plans", () => {
    const reminder = planStaleReminder(samplePlan());
    expect(reminder).toContain("PLAN REMINDER");
    expect(reminder).toContain("Implement");
    expect(planStaleReminder(null)).toBeUndefined();
  });

  it("reminds to complete when all steps are closed", () => {
    const reminder = planStaleReminder(
      samplePlan({
        steps: [
          {
            id: "s1",
            index: 1,
            title: "A",
            status: "done",
            notes: "",
            blockedBy: [],
            updatedAt: new Date().toISOString(),
          },
        ],
        nextStep: null,
        progress: { done: 1, total: 1, percent: 100 },
      }),
    );
    expect(reminder).toContain("plan_complete");
  });
});
