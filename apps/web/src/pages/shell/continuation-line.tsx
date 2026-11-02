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
  const { index, max, percent } = continuation;
  const label =
    continuation.state === "scheduled"
      ? percent == null
        ? t`Continuing automatically (${index}/${max})`
        : t`Continuing automatically (${index}/${max}) · ${percent}%`
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
      <span>{stopped ? t`Automatic continuation stopped` : label}</span>
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
