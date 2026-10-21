import { resolveComposerSendPlan } from "@rakazo/core";
import { describe, expect, it } from "vitest";
import type { SendAttempt } from "./thread-feedback";
import { withoutEchoedSends } from "./thread-feedback";

function attempt(
  text: string,
  extra: Partial<SendAttempt> = {},
  echoAfterSeq?: number,
): SendAttempt {
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
      echoAfterSeq,
    },
    clientNonce: `n-${text}`,
    artifactIds: new Map(),
    state: "pending",
    apiBase: "https://example.test",
    spaceId: null,
    userId: "u",
    cacheSession: "c",
    session: 0,
    ...extra,
  };
}
const user = (seq: number, text: string) => ({
  role: "user",
  seq,
  blocks: [{ kind: "text", text }],
});

describe("withoutEchoedSends", () => {
  it("hides an accepted send as soon as its seq is in the thread", () => {
    const sent = attempt("ciao", { acceptedSeq: 5 });
    expect(withoutEchoedSends([sent], [user(5, "ciao")])).toEqual([]);
    expect(withoutEchoedSends([sent], [user(4, "ciao")])).toEqual([sent]);
  });

  it("hides a pending send whose echo arrived before threads/send returned", () => {
    const sent = attempt("ciao", {}, 3);
    expect(withoutEchoedSends([sent], [user(2, "ciao"), user(4, "ciao")])).toEqual([]);
    // An older identical message is not the echo.
    expect(withoutEchoedSends([sent], [user(2, "ciao")])).toEqual([sent]);
  });

  it("matches one echo to one send and keeps failed sends visible", () => {
    const a = attempt("ok", {}, 1);
    const b = attempt("ok", { clientNonce: "n-ok-2" }, 1);
    expect(withoutEchoedSends([a, b], [user(2, "ok")])).toEqual([b]);
    const failed = attempt("ok", { state: "failed" }, 1);
    expect(withoutEchoedSends([failed], [user(2, "ok")])).toEqual([failed]);
  });
});
