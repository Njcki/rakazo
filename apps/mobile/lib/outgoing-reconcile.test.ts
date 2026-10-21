import { resolveComposerSendPlan } from "@rakazo/core";
import { describe, expect, it } from "vitest";
import type { OutgoingMessage } from "./outgoing-reconcile";
import { reconcileOutgoing } from "./outgoing-reconcile";
import type { SendAttempt } from "./thread-feedback";

type Msg = OutgoingMessage;

function attempt(text: string, payload: Partial<SendAttempt["payload"]> = {}): SendAttempt {
  return {
    payload: {
      originThreadKey: "bot-1",
      displayText: text,
      replyPreview: null,
      botTarget: "bot-1",
      reroutedToGroup: false,
      plan: resolveComposerSendPlan({ text, mentions: [], hasAttachments: false }),
      attachments: [],
      replyQuote: null,
      echoAfterSeq: 4,
      echoKnownIds: [],
      ...payload,
    },
    clientNonce: `nonce-${text}`,
    artifactIds: new Map(),
    state: "pending",
    apiBase: "https://example.test",
    spaceId: null,
    userId: "u",
    cacheSession: "c",
    session: 0,
  };
}
const user = (id: string, text: string, extra: Partial<Msg> = {}): Msg => ({
  id,
  role: "user",
  blocks: [{ kind: "text", text }],
  ...extra,
});
const bot = (id: string, seq: number): Msg => ({
  id,
  role: "bot",
  seq,
  blocks: [{ kind: "text", text: "risposta" }],
});
const standIn = (a: SendAttempt, id: string): Msg => user(id, a.payload.plan.trimmed);
const history = [user("m0", "prima", { seq: 3 }), bot("b0", 4)];

/** Renders one step: the list keys, rows showing "Sending…", and copies of `text`. */
function frame(keys: Map<string, string>, messages: Msg[], attempts: SendAttempt[], text: string) {
  const r = reconcileOutgoing(messages, attempts, keys, standIn);
  const rows = r.messages.map((m) => ({ key: r.keyOf(m.id), m }));
  return {
    keys: rows.map((row) => row.key),
    pending: rows.filter((row) => r.pendingIds.has(row.m.id)).map((row) => row.key),
    copies: rows.filter((row) => row.m.role === "user" && row.m.blocks[0]?.text === text).length,
    separate: r.separate,
  };
}

describe("reconcileOutgoing", () => {
  it("send response, then refresh: one row, same key, label goes away", () => {
    const keys = new Map<string, string>();
    const sent = attempt("ciao");
    const steps = [
      frame(keys, history, [sent], "ciao"),
      (() => {
        sent.acceptedSeq = 7;
        sent.acceptedRunId = "run-1";
        return frame(keys, history, [sent], "ciao");
      })(),
      frame(keys, [...history, user("m1", "ciao", { seq: 7, runId: "run-1" })], [sent], "ciao"),
      // confirmEchoes forgets the send; the server row keeps its key.
      frame(keys, [...history, user("m1", "ciao", { seq: 7, runId: "run-1" })], [], "ciao"),
    ];
    for (const step of steps) {
      expect(step.copies).toBe(1);
      expect(step.keys.at(-1)).toBe("local:nonce-ciao");
    }
    expect(steps.map((step) => step.pending.length)).toEqual([1, 1, 0, 0]);
  });

  it("live copy (no seq) before the send response, then refresh", () => {
    const keys = new Map<string, string>();
    const sent = attempt("ciao");
    const live = user("m1", "ciao", { runId: "run-1" });
    const steps = [
      frame(keys, history, [sent], "ciao"),
      frame(keys, [...history, live], [sent], "ciao"),
      (() => {
        sent.acceptedSeq = 7;
        sent.acceptedRunId = "run-1";
        return frame(keys, [...history, live, bot("b1", 8)], [sent], "ciao");
      })(),
      frame(keys, [...history, { ...live, seq: 7 }, bot("b1", 8)], [sent], "ciao"),
      frame(keys, [...history, { ...live, seq: 7 }, bot("b1", 8)], [], "ciao"),
    ];
    for (const step of steps) {
      expect(step.copies).toBe(1);
      expect(step.keys).toContain("local:nonce-ciao");
    }
    expect(steps.map((step) => step.pending.length)).toEqual([1, 0, 0, 0, 0]);
  });

  it("matches a live copy whose text differs once the run id is known", () => {
    const keys = new Map<string, string>();
    const sent = attempt("ciao @bot");
    const live = user("m1", "ciao @Bot", { runId: "run-1" });
    expect(frame(keys, [...history, live], [sent], "ciao @bot").pending).toHaveLength(1);
    sent.acceptedRunId = "run-1";
    sent.acceptedSeq = 7;
    const accepted = frame(keys, [...history, live], [sent], "ciao @Bot");
    expect(accepted.pending).toHaveLength(0);
    expect(accepted.keys.at(-1)).toBe("local:nonce-ciao @bot");
    const refreshed = frame(keys, [...history, { ...live, seq: 7 }], [sent], "ciao @Bot");
    expect(refreshed.pending).toHaveLength(0);
    expect(refreshed.keys.at(-1)).toBe("local:nonce-ciao @bot");
  });

  it("does not take an older identical message for the echo", () => {
    const keys = new Map<string, string>();
    const older = user("m-old", "ok", { runId: "run-0" });
    const sent = attempt("ok", { echoKnownIds: ["m-old"] });
    const seqOlder = user("m-seq", "ok", { seq: 2 });
    const step = frame(keys, [seqOlder, ...history, older], [sent], "ok");
    expect(step.pending).toEqual(["local:nonce-ok"]);
    expect(step.copies).toBe(3);
  });

  it("keeps failed, offline and attachment sends as separate bubbles", () => {
    const keys = new Map<string, string>();
    const failed = { ...attempt("a"), state: "failed" as const, error: "x" };
    const offline = { ...attempt("b"), state: "queued" as const, error: "offline" };
    const withFile = attempt("c", {
      attachments: [{ id: "f", name: "f.png", mimeType: "image/png", contentBase64: "" }] as never,
    });
    const step = frame(keys, history, [failed, offline, withFile], "a");
    expect(step.separate.map((a) => a.payload.displayText)).toEqual(["a", "b", "c"]);
    expect(step.pending).toEqual([]);
  });
});
