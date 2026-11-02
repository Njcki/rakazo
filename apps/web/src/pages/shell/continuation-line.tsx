import { useLingui } from "@lingui/react/macro";
import type { MessageBlock } from "@rakazo/contracts";
import { Button } from "@rakazo/ui-web";
import { useState } from "react";

type MetaBlock = Extract<MessageBlock, { kind: "meta" }>;
type Continuation = NonNullable<MetaBlock["continuation"]>;

/** Status line of an explicit continue_later chain, with a stop control while one is pending. */
export function ContinuationLine({
  continuation,
  onStop,
}: {
  continuation: Continuation;
  /** Present only on the latest message, while the scheduled continuation can still be stopped. */
  onStop?: () => void | Promise<void>;
}) {
  const { t } = useLingui();
  const [stopped, setStopped] = useState(false);
  const { index, max, percent, measure } = continuation;
  const measured =
    measure && measure.target > 0
      ? Math.max(0, Math.min(100, Math.floor((measure.value / measure.target) * 100)))
      : undefined;
  let progress = "";
  let hint = t`The bot keeps working on its own until the goal is reached`;
  if (measure && measured !== undefined) {
    const value = formatAmount(measure.value);
    const target = formatAmount(measure.target);
    const unit = measure.unit;
    progress = unit
      ? t`${value} ${unit} of ${target} (${measured}%)`
      : t`${value} of ${target} (${measured}%)`;
    // The shown percent never exceeds the bot's own lower estimate: say both.
    if (percent != null && percent < measured) progress += ` · ${t`bot estimate ${percent}%`}`;
    hint = t`The bot keeps working on its own until the goal is reached; the percentage is measured by the system`;
  } else if (percent != null) {
    progress = t`${percent}% (bot estimate)`;
    hint = t`The bot keeps working on its own until the goal is reached; the percentage is estimated by the bot`;
  }
  const round = t`Continuing on its own · round ${index} of max ${max}`;
  const label =
    continuation.state === "scheduled"
      ? progress
        ? `${round} · ${progress}`
        : round
      : continuation.state === "limit"
        ? t`Automatic continuation stopped: limit reached (${max})`
        : continuation.state === "no_progress"
          ? t`Automatic continuation stopped: no progress`
          : t`Automatic continuation skipped: other work is in progress`;
  const canStop = continuation.state === "scheduled" && onStop && !stopped;
  return (
    <div
      data-testid="continuation-line"
      className="flex items-center justify-center gap-2 py-1 text-[13.5px] text-muted-foreground"
    >
      <span className="text-warning">◷</span>
      <span title={continuation.state === "scheduled" && !stopped ? hint : undefined}>
        {stopped ? t`Automatic continuation stopped` : label}
      </span>
      {canStop ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[13px]"
          onClick={() => {
            setStopped(true);
            void Promise.resolve(onStop()).catch(() => setStopped(false));
          }}
        >
          {t`Stop`}
        </Button>
      ) : null}
    </div>
  );
}

function formatAmount(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}
