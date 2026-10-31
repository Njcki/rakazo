import { describe, expect, it } from "vitest";
import {
  BOT_PLAN_EXPANDED_STORAGE_KEY,
  persistBotPlanExpanded,
  readBotPlanExpanded,
} from "./bot-plan-expanded-pref";

describe("bot plan expanded preference", () => {
  it("is expanded by default and when the stored value is unknown", () => {
    expect(BOT_PLAN_EXPANDED_STORAGE_KEY).toBe("rakazo.botPanel.planExpanded");
    expect(readBotPlanExpanded(null)).toBe(true);
    expect(readBotPlanExpanded({ getItem: () => null })).toBe(true);
    expect(readBotPlanExpanded({ getItem: () => "garbage" })).toBe(true);
    expect(
      readBotPlanExpanded({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toBe(true);
  });

  it("remembers a collapsed choice", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
    persistBotPlanExpanded(false, storage);
    expect(store.get(BOT_PLAN_EXPANDED_STORAGE_KEY)).toBe("false");
    expect(readBotPlanExpanded(storage)).toBe(false);
    persistBotPlanExpanded(true, storage);
    expect(readBotPlanExpanded(storage)).toBe(true);
  });

  it("ignores a storage that refuses writes", () => {
    expect(() =>
      persistBotPlanExpanded(false, {
        setItem: () => {
          throw new Error("quota");
        },
      }),
    ).not.toThrow();
  });
});
