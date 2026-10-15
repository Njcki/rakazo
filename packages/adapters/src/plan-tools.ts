import type { PrismaClient } from "@rakazo/db";

export const PLAN_STATUSES = ["active", "completed", "cancelled"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const PLAN_STEP_STATUSES = ["todo", "in_progress", "done", "blocked", "skipped"] as const;
export type PlanStepStatus = (typeof PLAN_STEP_STATUSES)[number];

const TITLE_MAX = 200;
const SUMMARY_MAX = 2_000;
const NOTES_MAX = 2_000;
const MAX_STEPS = 40;

export type PlanToolDeps = {
  prisma: PrismaClient;
};

export type PlanStepDto = {
  id: string;
  index: number;
  title: string;
  status: PlanStepStatus;
  notes: string;
  blockedBy: number[];
  updatedAt: string;
};

export type PlanDto = {
  id: string;
  botId: string;
  title: string;
  status: PlanStatus;
  summary: string;
  progress: { done: number; total: number; percent: number };
  nextStep: PlanStepDto | null;
  steps: PlanStepDto[];
  createdAt: string;
  updatedAt: string;
  guidance: string;
};

type PlanRow = {
  id: string;
  botId: string;
  title: string;
  status: string;
  summary: string;
  createdAt: Date;
  updatedAt: Date;
  steps: StepRow[];
};

type StepRow = {
  id: string;
  index: number;
  title: string;
  status: string;
  notes: string;
  blockedBy: unknown;
  updatedAt: Date;
};

export function isPlanStatus(value: unknown): value is PlanStatus {
  return typeof value === "string" && (PLAN_STATUSES as readonly string[]).includes(value);
}

export function isPlanStepStatus(value: unknown): value is PlanStepStatus {
  return typeof value === "string" && (PLAN_STEP_STATUSES as readonly string[]).includes(value);
}

export function coercePlanStatus(value: unknown): PlanStatus {
  return isPlanStatus(value) ? value : "active";
}

export function coercePlanStepStatus(value: unknown): PlanStepStatus {
  return isPlanStepStatus(value) ? value : "todo";
}

function parseBlockedBy(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  for (const entry of value) {
    const n = typeof entry === "number" ? entry : Number(entry);
    if (Number.isInteger(n) && n >= 1 && !out.includes(n)) out.push(n);
  }
  return out.sort((a, b) => a - b);
}

function mapStep(row: StepRow): PlanStepDto {
  return {
    id: row.id,
    index: row.index,
    title: row.title,
    status: coercePlanStepStatus(row.status),
    notes: row.notes,
    blockedBy: parseBlockedBy(row.blockedBy),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function openStatuses(status: PlanStepStatus): boolean {
  return status === "todo" || status === "in_progress" || status === "blocked";
}

function computeProgress(steps: PlanStepDto[]): PlanDto["progress"] {
  const total = steps.length;
  const done = steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  return { done, total, percent };
}

function pickNextStep(steps: PlanStepDto[]): PlanStepDto | null {
  const byIndex = new Map(steps.map((s) => [s.index, s]));
  const inProgress = steps.find((s) => s.status === "in_progress");
  if (inProgress) return inProgress;
  for (const step of steps) {
    if (step.status !== "todo") continue;
    const blockers = step.blockedBy.filter((idx) => {
      const dep = byIndex.get(idx);
      return !dep || (dep.status !== "done" && dep.status !== "skipped");
    });
    if (blockers.length === 0) return step;
  }
  return steps.find((s) => s.status === "blocked") ?? null;
}

function buildGuidance(plan: Omit<PlanDto, "guidance">): string {
  if (plan.status === "completed") {
    return "Plan is completed. Do not reopen it unless the user asks for more work; then call plan_create for a new plan.";
  }
  if (plan.status === "cancelled") {
    return "Plan was cancelled. Call plan_create if the user wants a new ordered plan.";
  }
  const open = plan.steps.filter((s) => openStatuses(s.status));
  if (open.length === 0) {
    return "All steps are done or skipped. Call plan_complete to close the plan before telling the user the overall task is finished.";
  }
  const next = plan.nextStep;
  if (!next) {
    return "Active plan has open steps but none are ready (check blocked dependencies). Call plan_update_step or plan_status.";
  }
  if (next.status === "in_progress") {
    return `Continue step ${next.index} «${next.title}» (id: ${next.id}). When finished, plan_update_step status=done (or blocked/skipped). Do not claim the whole task finished while ${open.length} step(s) remain open.`;
  }
  if (next.status === "blocked") {
    return `Step ${next.index} «${next.title}» is blocked. Update notes with why, resolve the blocker, then set status back to todo or in_progress.`;
  }
  return `Next ready step is ${next.index} «${next.title}» (id: ${next.id}). Call plan_update_step with status=in_progress before working on it, then done when finished. Do not claim the whole task finished while ${open.length} step(s) remain open.`;
}

export function mapPlan(row: PlanRow): PlanDto {
  const steps = row.steps
    .slice()
    .sort((a, b) => a.index - b.index)
    .map(mapStep);
  const base = {
    id: row.id,
    botId: row.botId,
    title: row.title,
    status: coercePlanStatus(row.status),
    summary: row.summary,
    progress: computeProgress(steps),
    nextStep: pickNextStep(steps),
    steps,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
  return { ...base, guidance: buildGuidance(base) };
}

const planInclude = {
  steps: { orderBy: { index: "asc" as const } },
};

export async function getActivePlan(
  deps: PlanToolDeps,
  input: { spaceId: string; botId: string },
): Promise<PlanDto | null> {
  const row = await deps.prisma.agentPlan.findFirst({
    where: { spaceId: input.spaceId, botId: input.botId, status: "active" },
    include: planInclude,
    orderBy: { updatedAt: "desc" },
  });
  return row ? mapPlan(row) : null;
}

export async function getPlanById(
  deps: PlanToolDeps,
  input: { spaceId: string; botId: string; planId: string },
): Promise<PlanDto | null> {
  const row = await deps.prisma.agentPlan.findFirst({
    where: { id: input.planId, spaceId: input.spaceId, botId: input.botId },
    include: planInclude,
  });
  return row ? mapPlan(row) : null;
}

export async function listPlansForBot(
  deps: PlanToolDeps,
  input: { spaceId: string; botId: string; includeClosed?: boolean },
): Promise<PlanDto[]> {
  const rows = await deps.prisma.agentPlan.findMany({
    where: {
      spaceId: input.spaceId,
      botId: input.botId,
      ...(input.includeClosed ? {} : { status: "active" }),
    },
    include: planInclude,
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    take: 10,
  });
  return rows.map(mapPlan);
}

export type PlanCreateStepInput = {
  title: string;
  blockedBy?: number[];
  notes?: string;
};

export async function createPlanFromTool(
  deps: PlanToolDeps,
  input: {
    spaceId: string;
    botId: string;
    userId: string;
    title: string;
    summary?: string;
    steps: PlanCreateStepInput[];
    replaceActive?: boolean;
  },
): Promise<{ plan: PlanDto } | { error: string }> {
  const title = input.title.trim();
  if (!title) return { error: "title is required." };
  if (title.length > TITLE_MAX) return { error: `title must be at most ${TITLE_MAX} characters.` };
  const summary = (input.summary ?? "").trim();
  if (summary.length > SUMMARY_MAX) {
    return { error: `summary must be at most ${SUMMARY_MAX} characters.` };
  }
  if (!Array.isArray(input.steps) || input.steps.length === 0) {
    return { error: "steps must be a non-empty array of { title, blockedBy? }." };
  }
  if (input.steps.length > MAX_STEPS) {
    return { error: `at most ${MAX_STEPS} steps allowed.` };
  }

  const normalized: { title: string; blockedBy: number[]; notes: string }[] = [];
  for (let i = 0; i < input.steps.length; i++) {
    const raw = input.steps[i]!;
    const stepTitle = String(raw?.title ?? "").trim();
    if (!stepTitle) return { error: `steps[${i}].title is required.` };
    if (stepTitle.length > TITLE_MAX) {
      return { error: `steps[${i}].title must be at most ${TITLE_MAX} characters.` };
    }
    const notes = String(raw?.notes ?? "").trim();
    if (notes.length > NOTES_MAX) {
      return { error: `steps[${i}].notes must be at most ${NOTES_MAX} characters.` };
    }
    const blockedBy = parseBlockedBy(raw?.blockedBy).filter((idx) => idx >= 1 && idx <= input.steps.length && idx !== i + 1);
    normalized.push({ title: stepTitle, blockedBy, notes });
  }

  const existing = await getActivePlan(deps, { spaceId: input.spaceId, botId: input.botId });
  if (existing && input.replaceActive !== true) {
    return {
      error: `An active plan already exists (id: ${existing.id}, «${existing.title}», ${existing.progress.done}/${existing.progress.total}). Pass replaceActive=true to cancel it and create a new plan, or continue updating that plan with plan_update_step.`,
    };
  }

  const plan = await deps.prisma.$transaction(async (tx) => {
    if (existing) {
      await tx.agentPlan.update({
        where: { id: existing.id },
        data: { status: "cancelled" },
      });
    }
    return tx.agentPlan.create({
      data: {
        spaceId: input.spaceId,
        botId: input.botId,
        userId: input.userId,
        title,
        summary,
        status: "active",
        steps: {
          create: normalized.map((step, i) => ({
            spaceId: input.spaceId,
            index: i + 1,
            title: step.title,
            status: "todo",
            notes: step.notes,
            blockedBy: step.blockedBy,
          })),
        },
      },
      include: planInclude,
    });
  });

  const dto = mapPlan(plan);
  return { plan: dto };
}

export async function updatePlanStepFromTool(
  deps: PlanToolDeps,
  input: {
    spaceId: string;
    botId: string;
    stepId?: string;
    index?: number;
    status?: string;
    title?: string;
    notes?: string;
  },
): Promise<{ plan: PlanDto; step: PlanStepDto } | { error: string }> {
  const plan = await getActivePlan(deps, { spaceId: input.spaceId, botId: input.botId });
  if (!plan) return { error: "No active plan. Call plan_create first for multi-step work." };

  let step = input.stepId
    ? plan.steps.find((s) => s.id === input.stepId)
    : input.index !== undefined
      ? plan.steps.find((s) => s.index === Number(input.index))
      : undefined;
  if (!step) {
    return { error: "Step not found. Pass stepId or index from plan_status / plan_create." };
  }

  const data: { status?: string; title?: string; notes?: string } = {};
  if (input.status !== undefined) {
    if (!isPlanStepStatus(input.status)) {
      return { error: "status must be todo, in_progress, done, blocked, or skipped." };
    }
    data.status = input.status;
  }
  if (input.title !== undefined) {
    const title = input.title.trim();
    if (!title) return { error: "title cannot be empty." };
    if (title.length > TITLE_MAX) return { error: `title must be at most ${TITLE_MAX} characters.` };
    data.title = title;
  }
  if (input.notes !== undefined) {
    const notes = input.notes.trim();
    if (notes.length > NOTES_MAX) return { error: `notes must be at most ${NOTES_MAX} characters.` };
    data.notes = notes;
  }
  if (Object.keys(data).length === 0) {
    return { error: "Provide status, title, and/or notes to update." };
  }

  // Only one in_progress step at a time: demote others when starting a new one.
  if (data.status === "in_progress") {
    await deps.prisma.agentPlanStep.updateMany({
      where: {
        planId: plan.id,
        status: "in_progress",
        id: { not: step.id },
      },
      data: { status: "todo" },
    });
  }

  await deps.prisma.agentPlanStep.update({
    where: { id: step.id },
    data,
  });
  await deps.prisma.agentPlan.update({
    where: { id: plan.id },
    data: { updatedAt: new Date() },
  });

  const refreshed = await getPlanById(deps, {
    spaceId: input.spaceId,
    botId: input.botId,
    planId: plan.id,
  });
  if (!refreshed) return { error: "Plan disappeared after update." };
  const updatedStep = refreshed.steps.find((s) => s.id === step!.id)!;
  return { plan: refreshed, step: updatedStep };
}

export async function addPlanStepFromTool(
  deps: PlanToolDeps,
  input: {
    spaceId: string;
    botId: string;
    title: string;
    blockedBy?: number[];
    notes?: string;
    afterIndex?: number;
  },
): Promise<{ plan: PlanDto; step: PlanStepDto } | { error: string }> {
  const plan = await getActivePlan(deps, { spaceId: input.spaceId, botId: input.botId });
  if (!plan) return { error: "No active plan. Call plan_create first." };
  if (plan.steps.length >= MAX_STEPS) return { error: `at most ${MAX_STEPS} steps allowed.` };

  const title = input.title.trim();
  if (!title) return { error: "title is required." };
  if (title.length > TITLE_MAX) return { error: `title must be at most ${TITLE_MAX} characters.` };
  const notes = (input.notes ?? "").trim();
  if (notes.length > NOTES_MAX) return { error: `notes must be at most ${NOTES_MAX} characters.` };

  const afterIndex =
    input.afterIndex !== undefined && Number.isInteger(Number(input.afterIndex))
      ? Number(input.afterIndex)
      : plan.steps.length;
  const insertAt = Math.min(Math.max(afterIndex + 1, 1), plan.steps.length + 1);
  const blockedBy = parseBlockedBy(input.blockedBy).filter(
    (idx) => idx >= 1 && idx <= plan.steps.length,
  );

  await deps.prisma.$transaction(async (tx) => {
    // Shift indexes up to make room.
    const toShift = plan.steps.filter((s) => s.index >= insertAt).sort((a, b) => b.index - a.index);
    for (const s of toShift) {
      await tx.agentPlanStep.update({
        where: { id: s.id },
        data: { index: s.index + 1 },
      });
    }
    await tx.agentPlanStep.create({
      data: {
        planId: plan.id,
        spaceId: input.spaceId,
        index: insertAt,
        title,
        status: "todo",
        notes,
        blockedBy,
      },
    });
    await tx.agentPlan.update({
      where: { id: plan.id },
      data: { updatedAt: new Date() },
    });
  });

  const refreshed = await getPlanById(deps, {
    spaceId: input.spaceId,
    botId: input.botId,
    planId: plan.id,
  });
  if (!refreshed) return { error: "Plan disappeared after add." };
  const step = refreshed.steps.find((s) => s.index === insertAt)!;
  return { plan: refreshed, step };
}

export async function planStatusFromTool(
  deps: PlanToolDeps,
  input: { spaceId: string; botId: string },
): Promise<{ plan: PlanDto | null; guidance: string }> {
  const plan = await getActivePlan(deps, input);
  if (!plan) {
    return {
      plan: null,
      guidance:
        "No active plan. For any multi-step user request (2+ distinct actions), call plan_create with ordered steps BEFORE starting work, then plan_update_step as you go.",
    };
  }
  return { plan, guidance: plan.guidance };
}

export async function completePlanFromTool(
  deps: PlanToolDeps,
  input: { spaceId: string; botId: string; force?: boolean; reason?: string },
): Promise<{ plan: PlanDto } | { error: string; plan?: PlanDto }> {
  const plan = await getActivePlan(deps, input);
  if (!plan) return { error: "No active plan to complete." };
  const open = plan.steps.filter((s) => openStatuses(s.status));
  if (open.length > 0 && !input.force) {
    return {
      error: `Cannot complete: ${open.length} step(s) still open (${open
        .map((s) => `${s.index}:${s.status}`)
        .join(", ")}). Finish them with plan_update_step, or pass force=true with reason if the user cancelled remaining work.`,
      plan,
    };
  }
  if (input.force && open.length > 0) {
    const reason = (input.reason ?? "").trim();
    if (!reason) {
      return { error: "force=true requires a short reason explaining why open steps are abandoned.", plan };
    }
  }
  const row = await deps.prisma.agentPlan.update({
    where: { id: plan.id },
    data: {
      status: "completed",
      summary: input.force && open.length > 0
        ? `${plan.summary}\n[forced complete] ${input.reason}`.trim()
        : plan.summary,
    },
    include: planInclude,
  });
  return { plan: mapPlan(row) };
}

export async function cancelPlanFromTool(
  deps: PlanToolDeps,
  input: { spaceId: string; botId: string; reason?: string },
): Promise<{ plan: PlanDto } | { error: string }> {
  const plan = await getActivePlan(deps, input);
  if (!plan) return { error: "No active plan to cancel." };
  const reason = (input.reason ?? "").trim();
  const row = await deps.prisma.agentPlan.update({
    where: { id: plan.id },
    data: {
      status: "cancelled",
      summary: reason ? `${plan.summary}\n[cancelled] ${reason}`.trim() : plan.summary,
    },
    include: planInclude,
  });
  return { plan: mapPlan(row) };
}

/** Soft reminder text when the agent keeps tooling without updating the plan. */
export function planStaleReminder(plan: PlanDto | null): string | undefined {
  if (!plan || plan.status !== "active") return undefined;
  const open = plan.steps.filter((s) => openStatuses(s.status));
  if (open.length === 0) {
    return "PLAN REMINDER: all steps are done/skipped — call plan_complete before telling the user the overall task is finished.";
  }
  const next = plan.nextStep;
  if (!next) return "PLAN REMINDER: active plan has open steps; call plan_status and update them.";
  return `PLAN REMINDER: you have an active plan «${plan.title}» (${plan.progress.done}/${plan.progress.total}). Update step ${next.index} «${next.title}» with plan_update_step (in_progress/done/blocked). Do not claim finished while steps remain open.`;
}
