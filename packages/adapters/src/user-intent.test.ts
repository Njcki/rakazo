import { describe, expect, it } from "vitest";
import { asksToStopOrChange, looksLikeLongTask, needsAutoPlan } from "./user-intent.js";

describe("asksToStopOrChange", () => {
  it.each([
    "Basta così, fermati",
    "stop",
    "Annulla il resto",
    "lascia perdere il doppiaggio",
    "non serve più",
    "cambia piano: fai prima il menu",
    "fai invece le voci del capitolo 2",
    "cancel the rest",
    "never mind",
    "change the plan",
  ])("yes: %s", (text) => expect(asksToStopOrChange(text)).toBe(true));

  it.each(["Prosegui fino al 100%", "Continua sul container", "ok grazie", "fai tutto il gioco"])(
    "no: %s",
    (text) => expect(asksToStopOrChange(text)).toBe(false),
  );
});

describe("needsAutoPlan", () => {
  it("long-task wording with some real work", () => {
    expect(looksLikeLongTask("Prosegui fino al 100%")).toBe(true);
    expect(looksLikeLongTask("doppia tutto il gioco")).toBe(true);
    expect(looksLikeLongTask("keep going until it's done")).toBe(true);
    expect(
      needsAutoPlan({ requestTexts: ["Prosegui fino al 100%"], workToolCalls: 3, minTools: 12 }),
    ).toBe(true);
  });

  it("many tool calls even without the wording", () => {
    expect(
      needsAutoPlan({ requestTexts: ["sistema il sito"], workToolCalls: 12, minTools: 12 }),
    ).toBe(true);
  });

  it("never short chats", () => {
    expect(looksLikeLongTask("tutto bene?")).toBe(false);
    expect(
      needsAutoPlan({ requestTexts: ["Prosegui fino al 100%"], workToolCalls: 2, minTools: 12 }),
    ).toBe(false);
    expect(needsAutoPlan({ requestTexts: ["che ore sono?"], workToolCalls: 1, minTools: 12 })).toBe(
      false,
    );
    expect(
      needsAutoPlan({ requestTexts: ["cerca il meteo"], workToolCalls: 5, minTools: 12 }),
    ).toBe(false);
  });
});
