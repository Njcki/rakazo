import { describe, expect, it } from "vitest";
import {
  addPlanStepFromTool,
  completePlanFromTool,
  createPlanFromTool,
  isVerifyStepTitle,
  PLAN_VERIFY_STEP_TITLE,
  PLAN_VERIFY_STEP_TITLE_IT,
  type PlanToolDeps,
  planStatusFromTool,
  updatePlanStepFromTool,
} from "./plan-tools.js";

type Row = Record<string, any>;

/** Just enough of Prisma's agentPlan / agentPlanStep for plan-tools. */
function fakePrisma() {
  const plans: Row[] = [];
  const steps: Row[] = [];
  let seq = 0;
  let clock = Date.parse("2026-11-02T10:00:00Z");
  const now = () => {
    clock += 1000;
    return new Date(clock);
  };
  const id = (p: string) => `${p}${++seq}`;
  const matches = (row: Row, where: Row = {}) =>
    Object.entries(where).every(([key, value]) =>
      value && typeof value === "object" && "not" in value
        ? row[key] !== value.not
        : row[key] === value,
    );
  const withSteps = (plan: Row) => ({
    ...plan,
    steps: steps.filter((s) => s.planId === plan.id).sort((a, b) => a.index - b.index),
  });
  const createStep = (data: Row) => {
    const row: Row = {
      id: id("s"),
      notes: "",
      status: "todo",
      blockedBy: [],
      updatedAt: now(),
      ...data,
    };
    if (steps.some((s) => s.planId === row.planId && s.index === row.index)) {
      throw new Error(`unique (planId, index) ${row.index}`);
    }
    steps.push(row);
    return row;
  };
  const prisma: Row = {
    agentPlan: {
      async findFirst({ where }: Row) {
        const found = plans
          .filter((p) => matches(p, where))
          .sort((a, b) => b.updatedAt - a.updatedAt)[0];
        return found ? withSteps(found) : null;
      },
      async findMany({ where }: Row) {
        return plans.filter((p) => matches(p, where)).map(withSteps);
      },
      async create({ data }: Row) {
        const { steps: nested, ...rest } = data;
        const plan = { id: id("p"), createdAt: now(), updatedAt: now(), ...rest };
        plans.push(plan);
        for (const step of nested.create) createStep({ ...step, planId: plan.id });
        return withSteps(plan);
      },
      async update({ where, data }: Row) {
        const plan = plans.find((p) => p.id === where.id)!;
        Object.assign(plan, data, { updatedAt: data.updatedAt ?? now() });
        return withSteps(plan);
      },
    },
    agentPlanStep: {
      async create({ data }: Row) {
        return createStep(data);
      },
      async update({ where, data }: Row) {
        const step = steps.find((s) => s.id === where.id)!;
        if (
          data.index !== undefined &&
          steps.some((s) => s !== step && s.planId === step.planId && s.index === data.index)
        ) {
          throw new Error(`unique (planId, index) ${data.index}`);
        }
        Object.assign(step, data, { updatedAt: now() });
        return step;
      },
      async updateMany({ where, data }: Row) {
        for (const step of steps.filter((s) => matches(s, where))) Object.assign(step, data);
        return {};
      },
    },
  };
  prisma.$transaction = async (fn: (tx: Row) => Promise<unknown>) => fn(prisma);
  return { deps: { prisma } as unknown as PlanToolDeps, plans, steps };
}

const ids = { spaceId: "sp", botId: "b" };
const request = { text: "Doppia tutto il gioco, prosegui fino al 100%." };

async function planWithTwoSteps(deps: PlanToolDeps) {
  const created = await createPlanFromTool(deps, {
    ...ids,
    userId: "u",
    title: "Dub",
    steps: [
      { title: "Chain 15" },
      { title: "Chain 16" },
      { title: "Verifica che tutti gli obiettivi richiesti siano raggiunti" },
    ],
  });
  if ("error" in created) throw new Error(created.error);
  return created.plan;
}

describe("plan verification step", () => {
  it("matches the stored English title and the Italian one", () => {
    expect(isVerifyStepTitle(PLAN_VERIFY_STEP_TITLE)).toBe(true);
    expect(isVerifyStepTitle(PLAN_VERIFY_STEP_TITLE_IT)).toBe(true);
    expect(isVerifyStepTitle("verify all requested goals are met.")).toBe(true);
    expect(isVerifyStepTitle("Verify the build")).toBe(false);
  });

  it("is appended once, last, depending on every other step", async () => {
    const { deps } = fakePrisma();
    const plan = await planWithTwoSteps(deps);
    expect(plan.steps.map((s) => s.title)).toEqual([
      "Chain 15",
      "Chain 16",
      PLAN_VERIFY_STEP_TITLE,
    ]);
    expect(plan.steps[2]!.blockedBy).toEqual([1, 2]);
  });

  it("cannot be ticked before the work, without starting it, or without verified and evidence", async () => {
    const { deps } = fakePrisma();
    await planWithTwoSteps(deps);
    const early = await updatePlanStepFromTool(deps, { ...ids, index: 3, status: "in_progress" });
    expect("error" in early && early.error).toContain("Finish the other steps first");

    await updatePlanStepFromTool(deps, { ...ids, index: 1, status: "done" });
    await updatePlanStepFromTool(deps, { ...ids, index: 2, status: "done" });

    const notStarted = await updatePlanStepFromTool(deps, {
      ...ids,
      index: 3,
      status: "done",
      verified: true,
      notes: "all goals met, see report",
      originalRequest: request,
    });
    expect("error" in notStarted && notStarted.error).toContain("Start the verification first");

    const started = await updatePlanStepFromTool(deps, {
      ...ids,
      index: 3,
      status: "in_progress",
      originalRequest: request,
    });
    expect("verification" in started && started.verification).toContain("prosegui fino al 100%");

    const unverified = await updatePlanStepFromTool(deps, {
      ...ids,
      index: 3,
      status: "done",
      notes: "done",
      originalRequest: request,
    });
    expect("error" in unverified && unverified.error).toContain("verified=true");

    const skipped = await updatePlanStepFromTool(deps, { ...ids, index: 3, status: "skipped" });
    expect("error" in skipped && skipped.error).toContain("cannot be skipped");

    const ticked = await updatePlanStepFromTool(deps, {
      ...ids,
      index: 3,
      status: "done",
      verified: true,
      notes: "Goal: whole game to 100% — 4363/4363 lines dubbed (report.md).",
      originalRequest: request,
    });
    expect("step" in ticked && ticked.step.status).toBe("done");
    const completed = await completePlanFromTool(deps, ids);
    expect("plan" in completed && completed.plan?.status).toBe("completed");
  });

  it("blocks plan_complete while only the verification is open", async () => {
    const { deps } = fakePrisma();
    await planWithTwoSteps(deps);
    await updatePlanStepFromTool(deps, { ...ids, index: 1, status: "done" });
    await updatePlanStepFromTool(deps, { ...ids, index: 2, status: "done" });
    const refused = await completePlanFromTool(deps, ids);
    expect("error" in refused && refused.error).toContain("final verification step");
  });

  it("new or reopened work goes before it and reopens it", async () => {
    const { deps } = fakePrisma();
    await planWithTwoSteps(deps);
    await updatePlanStepFromTool(deps, { ...ids, index: 1, status: "done" });
    await updatePlanStepFromTool(deps, { ...ids, index: 2, status: "done" });
    await updatePlanStepFromTool(deps, { ...ids, index: 3, status: "in_progress" });
    const added = await addPlanStepFromTool(deps, { ...ids, title: "Chains 17-40" });
    if ("error" in added) throw new Error(added.error);
    expect(added.plan.steps.map((s) => s.title)).toEqual([
      "Chain 15",
      "Chain 16",
      "Chains 17-40",
      PLAN_VERIFY_STEP_TITLE,
    ]);
    const verify = added.plan.steps[3]!;
    expect(verify.status).toBe("todo");
    expect(verify.blockedBy).toEqual([1, 2, 3]);

    const renamed = await updatePlanStepFromTool(deps, { ...ids, index: 4, title: "Done" });
    expect(("step" in renamed && renamed.step.title) || "").not.toBe("Done");
  });

  it("is added to a plan written before it existed", async () => {
    const { deps, plans, steps } = fakePrisma();
    plans.push({
      id: "old",
      spaceId: "sp",
      botId: "b",
      title: "Legacy",
      summary: "",
      status: "active",
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });
    steps.push({
      id: "o1",
      planId: "old",
      index: 1,
      title: "Only",
      status: "done",
      notes: "",
      blockedBy: [],
      updatedAt: new Date(0),
    });
    const status = await planStatusFromTool(deps, ids);
    expect(status.plan?.steps.map((s) => s.title)).toEqual(["Only", PLAN_VERIFY_STEP_TITLE]);
    const refused = await completePlanFromTool(deps, ids);
    expect("error" in refused).toBe(true);
  });
});
