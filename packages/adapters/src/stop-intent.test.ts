import { describe, expect, it } from "vitest";
import { planMayKeepChainGoing } from "./run-turn.js";
import { isExplicitStopCommand, messagesAskToStop, parseStopVerdict } from "./stop-intent.js";

describe("explicit stop commands", () => {
  it.each([
    "stop",
    "Stop!",
    "fermati",
    "Fermati subito per favore",
    "basta così",
    "ok basta così grazie",
    "annulla",
    "annulla tutto",
    "interrompi il lavoro",
    "smettila",
    "please stop now",
    "cancel this",
  ])("stops: %s", (text) => expect(isExplicitStopCommand(text)).toBe(true));

  it.each([
    "non fermarti",
    "Non ti fermare finché non hai finito",
    "non smettere, continua",
    "don't stop until everything is done",
    "si è fermato di nuovo?",
    "ma si è fermato?",
    "ha smesso di funzionare",
    "it stopped again",
    "fermati solo quando hai finito tutto",
    "continua fino al 100% senza fermarti",
    "basta che li converti tutti",
    "annulla l'ultima modifica e continua",
    "premi il bottone stop solo se serve",
    "continua",
  ])("does not stop: %s", (text) => expect(isExplicitStopCommand(text)).toBe(false));
});

describe("messages written during a chain", () => {
  it("an explicit command stops without the classifier", async () => {
    expect(await messagesAskToStop(["ok", "fermati"])).toEqual({ stop: true, via: "explicit" });
  });

  it("ambiguous wording asks the classifier; no classifier means no stop", async () => {
    const asked: string[] = [];
    const classify = async (text: string) => {
      asked.push(text);
      return false;
    };
    expect(await messagesAskToStop(["cambia piano invece"], classify)).toEqual({ stop: false });
    expect(asked).toEqual(["cambia piano invece"]);
    expect(await messagesAskToStop(["cambia piano invece"])).toEqual({ stop: false });
    expect(await messagesAskToStop(["lascia perdere"], async () => true)).toEqual({
      stop: true,
      via: "classifier",
    });
    expect(await messagesAskToStop(["lascia perdere"], async () => undefined)).toEqual({
      stop: false,
    });
  });

  it("wording that mentions no stop never calls the classifier", async () => {
    let calls = 0;
    await messagesAskToStop(["come va?", "si è fermato di nuovo?"], async () => {
      calls++;
      return true;
    });
    expect(calls).toBe(0);
  });

  it("parses the classifier's JSON", () => {
    expect(parseStopVerdict('{"stop": true}')).toBe(true);
    expect(parseStopVerdict('Answer: {"stop": false}')).toBe(false);
    expect(parseStopVerdict("yes")).toBeUndefined();
  });
});

describe("open plan steps", () => {
  it("keep a long chain going unless the user stopped or nothing moved", () => {
    expect(planMayKeepChainGoing("reached")).toBe(true);
    expect(planMayKeepChainGoing("judge_complete")).toBe(true);
    expect(planMayKeepChainGoing(undefined)).toBe(true);
    expect(planMayKeepChainGoing("stop_asked")).toBe(false);
    expect(planMayKeepChainGoing("stalled")).toBe(false);
    expect(planMayKeepChainGoing("judge_no_work")).toBe(false);
  });
});
