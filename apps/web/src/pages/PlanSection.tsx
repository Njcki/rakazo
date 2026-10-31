import { Trans, useLingui } from "@lingui/react/macro";
import type { AgentPlan, AgentPlanStep } from "@rakazo/contracts";
import { Check, ChevronDown, Circle, CircleDot, ListTodo, Lock, Minus } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";

import { rpc } from "../lib/rpc";

const STATUS_ICON: Record<
  AgentPlanStep["status"],
  { icon: typeof Check; className: string; label: string }
> = {
  done: { icon: Check, className: "text-emerald-600 dark:text-emerald-400", label: "done" },
  in_progress: {
    icon: CircleDot,
    className: "text-sky-600 dark:text-sky-400 animate-pulse",
    label: "in progress",
  },
  blocked: { icon: Lock, className: "text-amber-600 dark:text-amber-400", label: "blocked" },
  skipped: { icon: Minus, className: "text-muted-foreground/70", label: "skipped" },
  todo: { icon: Circle, className: "text-muted-foreground/60", label: "todo" },
};

function StepRow({ step }: { step: AgentPlanStep }) {
  const meta = STATUS_ICON[step.status] ?? STATUS_ICON.todo;
  const Icon = meta.icon;
  const doneLike = step.status === "done" || step.status === "skipped";
  return (
    <div
      className={`flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 ${
        step.status === "in_progress" ? "bg-sky-500/8" : "hover:bg-accent/60"
      }`}
      data-testid={`plan-step-${step.index}`}
      data-status={step.status}
    >
      <Icon
        size={15}
        strokeWidth={2}
        className={`mt-0.5 shrink-0 ${meta.className}`}
        aria-label={meta.label}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground/80">
            {step.index}.
          </span>
          <span
            className={`min-w-0 text-start text-[13.5px] ${
              doneLike ? "text-muted-foreground/80 line-through" : "text-foreground"
            }`}
            dir="auto"
          >
            {step.title}
          </span>
        </div>
        {step.blockedBy.length > 0 ? (
          <div className="mt-0.5 text-[11.5px] text-muted-foreground/70">
            <Trans>Depends on</Trans> {step.blockedBy.map((n) => `#${n}`).join(", ")}
          </div>
        ) : null}
        {step.notes ? (
          <div className="mt-0.5 text-[12px] text-muted-foreground/80" dir="auto">
            {step.notes}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * RAKAZO: the header row. With `onToggle` it becomes a disclosure button (chevron, aria-expanded)
 * so the panel can collapse the plan while keeping its title and progress in view.
 */
function PlanHeader({
  expanded,
  onToggle,
  bodyId,
  children,
  trailing,
}: {
  expanded: boolean;
  onToggle?: () => void;
  bodyId: string;
  children: ReactNode;
  trailing?: ReactNode;
}) {
  if (!onToggle) {
    return (
      <div className="mb-2 flex items-center justify-between gap-2">
        {children}
        {trailing}
      </div>
    );
  }
  return (
    <button
      type="button"
      data-testid="bot-plan-toggle"
      aria-expanded={expanded}
      aria-controls={bodyId}
      onClick={onToggle}
      className={`group flex w-full cursor-pointer items-center justify-between gap-2 rounded-md text-start outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${
        expanded ? "mb-2" : ""
      }`}
    >
      {children}
      <span className="flex shrink-0 items-center gap-1.5">
        {trailing}
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 -rotate-90 text-muted-foreground transition-transform group-aria-expanded:rotate-0 motion-reduce:transition-none"
        />
      </span>
    </button>
  );
}

export function PlanSection({
  botId,
  pollMs = 4000,
  expanded = true,
  onToggle,
  className = "mt-6 border-t border-border/70 pt-5",
}: {
  botId: string;
  /** Poll interval while a plan is active (live updates during a run). */
  pollMs?: number;
  /** RAKAZO: collapsed hides the steps; the header (title + progress) stays. */
  expanded?: boolean;
  /** RAKAZO: when set, the header toggles `expanded`. */
  onToggle?: () => void;
  className?: string;
}) {
  const { t } = useLingui();
  const bodyId = useId();
  const [plan, setPlan] = useState<AgentPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listGeneration = useRef(0);

  async function refresh() {
    const generation = ++listGeneration.current;
    try {
      const result = await rpc.plans.active({ botId });
      if (generation !== listGeneration.current) return;
      setPlan(result);
      setError(null);
    } catch {
      if (generation !== listGeneration.current) return;
      setError(t`Could not load plan`);
    }
  }

  useEffect(() => {
    void refresh();
    return () => {
      listGeneration.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botId]);

  useEffect(() => {
    // Poll while active; also when completed so a replaceActive/create refreshes the panel.
    if (!plan) return;
    const id = window.setInterval(() => {
      void refresh();
    }, pollMs);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botId, plan?.id, plan?.status, pollMs]);

  if (!plan) {
    return (
      <div className={className} data-testid="bot-plan-empty" data-expanded={expanded}>
        <PlanHeader expanded={expanded} onToggle={onToggle} bodyId={bodyId}>
          <div className="flex items-center gap-2 text-[14px] text-muted-foreground">
            <ListTodo size={15} strokeWidth={1.8} aria-hidden />
            <Trans>Plan</Trans>
          </div>
        </PlanHeader>
        {expanded ? (
          <div id={bodyId}>
            <div className="py-1 text-[13px] text-muted-foreground/75">
              <Trans>
                No plan yet. The bot creates one for multi-step work; completed plans stay here
                until replaced.
              </Trans>
            </div>
            {error ? <div className="mt-1 text-[12.5px] text-destructive">{error}</div> : null}
          </div>
        ) : null}
      </div>
    );
  }

  const { done, total, percent } = plan.progress;

  return (
    <div className={className} data-testid="bot-plan" data-expanded={expanded}>
      <PlanHeader
        expanded={expanded}
        onToggle={onToggle}
        bodyId={bodyId}
        trailing={
          <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
            {done}/{total} · {percent}%
          </span>
        }
      >
        <div className="flex min-w-0 items-center gap-2 text-[14px] text-muted-foreground">
          <ListTodo size={15} strokeWidth={1.8} aria-hidden />
          <span className="truncate font-medium text-foreground" dir="auto">
            <Trans>Plan</Trans>
            {plan.title ? ` · ${plan.title}` : ""}
          </span>
          {plan.status === "completed" ? (
            <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
              <Trans>Completed</Trans>
            </span>
          ) : null}
        </div>
      </PlanHeader>
      {expanded ? (
        <div id={bodyId}>
          <div
            className="mb-2 h-1.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t`Plan progress`}
          >
            <div
              className={`h-full rounded-full transition-[width] duration-300 ${
                plan.status === "completed" ? "bg-emerald-500" : "bg-sky-500"
              }`}
              style={{ width: `${percent}%` }}
            />
          </div>
          <div className="max-h-[min(42vh,360px)] space-y-0.5 overflow-y-auto pr-0.5">
            {plan.steps.map((step) => (
              <StepRow key={step.id} step={step} />
            ))}
          </div>
          {error ? <div className="mt-2 text-[12.5px] text-destructive">{error}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
