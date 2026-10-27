import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createOpenAiCompatibleFetch,
  isModelServerConnectFailure,
  openAiCompatibleConnectTimeoutMs,
  resetOpenAiCompatibleOfflineCache,
} from "./pi-openai-compatible-provider.js";

// Patch 0029: offline OpenAI-compatible servers fail fast so backups take over.
describe("openai-compatible offline detection", () => {
  const saved = { ...process.env };
  beforeEach(() => resetOpenAiCompatibleOfflineCache());
  afterEach(() => {
    process.env = { ...saved };
    resetOpenAiCompatibleOfflineCache();
  });

  it("defaults the connect budget to 5 s and honours the env override", () => {
    delete process.env.OPENAI_COMPATIBLE_CONNECT_TIMEOUT_MS;
    expect(openAiCompatibleConnectTimeoutMs()).toBe(5_000);
    process.env.OPENAI_COMPATIBLE_CONNECT_TIMEOUT_MS = "2500";
    expect(openAiCompatibleConnectTimeoutMs()).toBe(2_500);
    process.env.OPENAI_COMPATIBLE_CONNECT_TIMEOUT_MS = "0";
    expect(openAiCompatibleConnectTimeoutMs()).toBeUndefined();
    process.env.OPENAI_COMPATIBLE_CONNECT_TIMEOUT_MS = "nope";
    expect(openAiCompatibleConnectTimeoutMs()).toBe(5_000);
  });

  it("recognises connect failures through the cause chain only", () => {
    const connect = new TypeError("fetch failed", {
      cause: Object.assign(new Error("Connect Timeout Error"), { code: "UND_ERR_CONNECT_TIMEOUT" }),
    });
    expect(isModelServerConnectFailure(connect)).toBe(true);
    const refused = new TypeError("fetch failed", {
      cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
    });
    expect(isModelServerConnectFailure(refused)).toBe(true);
    expect(isModelServerConnectFailure(new Error("terminated"))).toBe(false);
    expect(isModelServerConnectFailure(new DOMException("aborted", "AbortError"))).toBe(false);
  });

  it("marks a refused endpoint offline, skips it, then re-probes after the TTL", async () => {
    process.env.OPENAI_COMPATIBLE_OFFLINE_TTL_MS = "200";
    let calls = 0;
    const failing = (async () => {
      calls += 1;
      throw new TypeError("fetch failed", {
        cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
      });
    }) as unknown as typeof fetch;
    const safeFetch = createOpenAiCompatibleFetch(failing, undefined, { allowPrivate: true });
    const url = "http://127.0.0.1:9/v1/chat/completions";
    await expect(safeFetch(url, { method: "POST", body: "{}" })).rejects.toThrow("fetch failed");
    expect(calls).toBe(1);
    const skipped = await safeFetch(url, { method: "POST", body: "{}" }).catch((error) => error);
    expect(calls).toBe(1);
    expect(String(skipped.cause)).toMatch(/timed out/);
    expect(isModelServerConnectFailure(skipped)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await expect(safeFetch(url, { method: "POST", body: "{}" })).rejects.toThrow("fetch failed");
    expect(calls).toBe(2);
  });

  it("does not cache when the TTL is 0 and clears on success", async () => {
    process.env.OPENAI_COMPATIBLE_OFFLINE_TTL_MS = "0";
    let calls = 0;
    const failing = (async () => {
      calls += 1;
      throw new TypeError("fetch failed", {
        cause: Object.assign(new Error("x"), { code: "EHOSTUNREACH" }),
      });
    }) as unknown as typeof fetch;
    const safeFetch = createOpenAiCompatibleFetch(failing, undefined, { allowPrivate: true });
    const url = "http://127.0.0.1:9/v1/models";
    await expect(safeFetch(url)).rejects.toThrow();
    await expect(safeFetch(url)).rejects.toThrow();
    expect(calls).toBe(2);
  });

  it("bounds a blackholed connect by the connect budget, not the 10 s default", async () => {
    process.env.OPENAI_COMPATIBLE_CONNECT_TIMEOUT_MS = "300";
    // Non-routable address: either dropped (bounded by the budget) or
    // rejected at once by the host network; both must end well under 10 s.
    const started = Date.now();
    const safeFetch = createOpenAiCompatibleFetch(undefined, undefined, { allowPrivate: true });
    const error = await safeFetch("http://10.255.255.1:8080/v1/models").catch((e) => e);
    const elapsed = Date.now() - started;
    expect(error).toBeInstanceOf(Error);
    expect(elapsed).toBeLessThan(5_000);
  }, 15_000);
});
