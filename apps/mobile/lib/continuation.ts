import { createContext } from "react";
import { t } from "./i18n";

/** Status of an explicit continue_later chain, as the server puts it on a `meta` block. */
export type ContinuationStatus = {
  state: "scheduled" | "limit" | "no_progress" | "superseded";
  index: number;
  max: number;
  percent?: number;
};

const STATES = new Set(["scheduled", "limit", "no_progress", "superseded"]);

/** Reads the continuation of a block, if it is a well-formed one (older servers send none). */
export function continuationOf(block: { kind: string }): ContinuationStatus | undefined {
  if (block.kind !== "meta") return undefined;
  const value = (block as { continuation?: unknown }).continuation;
  if (!value || typeof value !== "object") return undefined;
  const { state, index, max, percent } = value as Record<string, unknown>;
  if (typeof state !== "string" || !STATES.has(state)) return undefined;
  if (typeof index !== "number" || typeof max !== "number") return undefined;
  return {
    state: state as ContinuationStatus["state"],
    index,
    max,
    ...(typeof percent === "number" ? { percent } : {}),
  };
}

/** The translated status line, the same wording as the web app. */
export function continuationLabel(status: ContinuationStatus): string {
  const values = { index: status.index, max: status.max };
  switch (status.state) {
    case "scheduled":
      return status.percent === undefined
        ? t("Continuing automatically ({index}/{max})", values)
        : t("Continuing automatically ({index}/{max}) · {percent}%", {
            ...values,
            percent: status.percent,
          });
    case "limit":
      return t("Automatic continuation stopped: limit reached ({max})", values);
    case "no_progress":
      return t("Automatic continuation stopped: no progress");
    case "superseded":
      return t("Automatic continuation skipped: other work is in progress");
  }
}

/** Lets the latest message's status line stop the scheduled next part, as on the web. */
export type ContinuationControl = { latestMessageId?: string; stop?: () => void | Promise<void> };
export const ContinuationControlContext = createContext<ContinuationControl>({});
