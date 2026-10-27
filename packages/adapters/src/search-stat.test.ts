import { describe, expect, it, vi } from "vitest";
import { recordSearchStat } from "./search-stats.js";

describe("recordSearchStat", () => {
  it("increments the counter for the service that answered", async () => {
    const upsert = vi.fn(async () => ({}));
    await recordSearchStat({ searchStat: { upsert } } as never, "SearXNG");
    expect(upsert).toHaveBeenCalledWith({
      where: { service: "SearXNG" },
      update: { count: { increment: 1 } },
      create: { service: "SearXNG", count: 1 },
    });
  });

  it("does not throw when the counter write fails", async () => {
    const upsert = vi.fn(async () => {
      throw new Error("db down");
    });
    await expect(
      recordSearchStat({ searchStat: { upsert } } as never, "Tavily"),
    ).resolves.toBeUndefined();
  });
});
