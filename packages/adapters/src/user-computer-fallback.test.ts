import { describe, expect, it } from "vitest";
import type { RunContext } from "./run-context.js";
import {
  ASK_USER_COMPUTER_REFUSAL,
  asksAboutUnavailableComputer,
  instructionsWantUserComputer,
  refuseAskUserAboutComputer,
  replyMentionsComputerFallback,
  userComputerFallbackNotice,
} from "./user-computer-fallback.js";

function ctx(state: "connected" | "offline" | undefined) {
  return {
    state: { userComputerFallback: { state, instructionsWantIt: true, triggeredThisRun: false } },
  } as unknown as Pick<RunContext, "state">;
}

describe("user computer fallback", () => {
  it("spots instructions that use the user's PC", () => {
    expect(
      instructionsWantUserComputer(
        "Lavora sul PC locale dell'utente, file in C:\\Users\\utente\\progetto",
      ),
    ).toBe(true);
    expect(instructionsWantUserComputer("Use the user's computer for builds")).toBe(true);
    expect(instructionsWantUserComputer("Rispondi in italiano")).toBe(false);
    expect(instructionsWantUserComputer(undefined)).toBe(false);
  });

  it("refuses ask_user about the offline PC and marks the fallback", () => {
    const c = ctx("offline");
    expect(
      refuseAskUserAboutComputer(c, "Il PC Windows è offline. Come procedo?", [
        "Aspetto",
        "Continua sul container",
      ]),
    ).toBe(ASK_USER_COMPUTER_REFUSAL);
    expect(c.state.userComputerFallback?.triggeredThisRun).toBe(true);
  });

  it("leaves other questions and connected computers alone", () => {
    expect(
      refuseAskUserAboutComputer(ctx("offline"), "Quale voce preferisci?", ["A", "B"]),
    ).toBeUndefined();
    expect(
      refuseAskUserAboutComputer(ctx("connected"), "Il PC è offline?", ["Sì", "No"]),
    ).toBeUndefined();
    expect(
      asksAboutUnavailableComputer("Your computer is not connected, open the desktop app?", [
        "ok",
        "no",
      ]),
    ).toBe(true);
  });

  it("notices in the reply's language, and only when not said already", () => {
    expect(userComputerFallbackNotice("Ho completato il lavoro e non ci sono errori")).toContain(
      "il tuo PC era offline",
    );
    expect(userComputerFallbackNotice("I finished the work and this is done")).toContain(
      "your computer was offline",
    );
    expect(replyMentionsComputerFallback("Il tuo PC era offline, ho usato il mio computer")).toBe(
      true,
    );
    expect(replyMentionsComputerFallback("Fatto: 140 righe")).toBe(false);
  });
});
