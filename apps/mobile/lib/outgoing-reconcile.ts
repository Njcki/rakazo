import type { SendAttempt } from "./thread-feedback";

/** The fields of a thread message the reconciliation reads. */
export type OutgoingMessage = {
  id: string;
  role: string;
  seq?: number;
  runId?: string;
  createdAt?: string;
  replyToMessageId?: string;
  replyQuote?: string;
  blocks: ReadonlyArray<{ kind: string; text?: unknown }>;
};

export const LOCAL_MESSAGE_PREFIX = "local:";

export function outgoingKey(attempt: Pick<SendAttempt, "clientNonce">) {
  return `${LOCAL_MESSAGE_PREFIX}${attempt.clientNonce}`;
}

function normalized(text: string) {
  return text.replace(/\r\n?/g, "\n").trim();
}

export function outgoingText(message: Pick<OutgoingMessage, "blocks">) {
  return normalized(
    message.blocks
      .flatMap((block) =>
        block.kind === "text" && typeof block.text === "string" ? [block.text] : [],
      )
      .join("\n"),
  );
}

/** A send still on its way: no failure yet (a queued send that never tried counts too). */
export function isInFlight(attempt: SendAttempt) {
  return attempt.state === "pending" || (attempt.state === "queued" && !attempt.error);
}

/** Only text sends are drawn as a regular row; attachments keep the separate bubble. */
export function drawsInline(attempt: SendAttempt) {
  return (
    isInFlight(attempt) &&
    attempt.payload.attachments.length === 0 &&
    !!attempt.payload.plan.trimmed
  );
}

export type OutgoingReconciliation<M extends OutgoingMessage> = {
  /** Server messages plus one stand-in row per in-flight text send, in reading order. */
  messages: M[];
  /** Stand-in rows that are still waiting for their server copy ("Sending…"). */
  pendingIds: ReadonlySet<string>;
  /** Sends that are not drawn in the list: failed, refused, offline, or with attachments. */
  separate: SendAttempt[];
  /** The list key of a message: a server copy keeps the key of the stand-in it replaced. */
  keyOf(id: string): string;
};

/**
 * Merges the user's unsent/in-flight sends into the thread as ordinary rows.
 *
 * A send is drawn as a stand-in row keyed by its client nonce. When its server copy arrives
 * (matched by accepted seq, by accepted run id for a live-feed copy that carries no seq, or
 * before threads/send returns by text among user messages that were not there at send time)
 * the stand-in is dropped in the same render and the server copy inherits its key, so the list
 * keeps one row that only loses its "Sending…" label. `keys` is kept by the caller per thread so
 * the key survives once the send itself is forgotten.
 */
export function reconcileOutgoing<M extends OutgoingMessage>(
  messages: readonly M[],
  attempts: readonly SendAttempt[],
  keys: Map<string, string>,
  standIn: (attempt: SendAttempt, id: string) => M,
): OutgoingReconciliation<M> {
  const own = messages.filter((m) => m.role === "user");
  const byKey = new Map<string, M>();
  for (const message of own) {
    const key = keys.get(message.id);
    if (key) byKey.set(key, message);
  }
  const claimed = new Set<string>([...byKey.values()].map((message) => message.id));
  const standIns: M[] = [];
  const pendingIds = new Set<string>();
  const separate: SendAttempt[] = [];
  for (const attempt of attempts) {
    const key = outgoingKey(attempt);
    let echo = byKey.get(key);
    if (!echo && attempt.acceptedSeq !== undefined)
      echo = own.find((m) => !claimed.has(m.id) && m.seq === attempt.acceptedSeq);
    const text = normalized(attempt.payload.plan.trimmed ?? "");
    const known = new Set(attempt.payload.echoKnownIds ?? []);
    if (!echo && attempt.acceptedRunId) {
      // A live copy has no seq yet; prefer the same text, else any new message of that run.
      const ofRun = own.filter(
        (m) =>
          !claimed.has(m.id) &&
          !known.has(m.id) &&
          m.seq === undefined &&
          m.runId === attempt.acceptedRunId,
      );
      echo = ofRun.find((m) => outgoingText(m) === text) ?? ofRun[0];
    }
    const after = attempt.payload.echoAfterSeq;
    if (!echo && text && after !== undefined && isInFlight(attempt)) {
      echo = own.find(
        (m) =>
          !claimed.has(m.id) &&
          (m.seq !== undefined ? m.seq > after : !known.has(m.id)) &&
          outgoingText(m) === text,
      );
    }
    if (echo) {
      claimed.add(echo.id);
      keys.set(echo.id, key);
      continue;
    }
    if (drawsInline(attempt)) {
      standIns.push(standIn(attempt, key));
      pendingIds.add(key);
    } else separate.push(attempt);
  }
  return {
    messages: standIns.length ? [...messages, ...standIns] : (messages as M[]),
    pendingIds,
    separate,
    keyOf: (id) => keys.get(id) ?? id,
  };
}
