import { describe, expect, it } from "vitest";
import { recordToolActivity } from "./run-turn.js";

describe("recordToolActivity", () => {
  it("keeps the last eight steps with the note the user saw", () => {
    const reply: { toolActivity?: Array<{ text: string; at: number }> } = {};
    recordToolActivity(reply, "web_search", "Cerco le fonti  sul\nmeteo", 1);
    for (let i = 0; i < 9; i++) recordToolActivity(reply, `tool_${i}`, undefined, 10 + i);
    expect(reply.toolActivity).toHaveLength(8);
    expect(reply.toolActivity![0]).toEqual({ text: "tool_1", at: 11 });
    const fresh: { toolActivity?: Array<{ text: string; at: number }> } = {};
    recordToolActivity(fresh, "web_search", "Cerco le fonti  sul\nmeteo", 1);
    expect(fresh.toolActivity).toEqual([{ text: "web_search: Cerco le fonti sul meteo", at: 1 }]);
  });
});
