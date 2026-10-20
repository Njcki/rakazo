import type { AdapterContext } from "@rakazo/adapter-kit";
import { describe, expect, it } from "vitest";
import { FakeWebProvider } from "./fake-web.js";
import { SearxngWebProvider } from "./searxng-web.js";
import {
  parseTavilyResults,
  TAVILY_SEARCH_ENDPOINT,
  type TavilyUsage,
  TavilyWebProvider,
} from "./tavily-web.js";
import { createWebProvider, resolveWebProviderKind } from "./web-provider-factory.js";

const ctx: AdapterContext = {
  operationId: "1",
  traceId: "1",
  spaceId: "w",
  userId: "u",
  signal: new AbortController().signal,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function setup(fetchImpl: typeof fetch, timeoutMs?: number) {
  const fallback = new FakeWebProvider();
  fallback.searchHits = [{ title: "DDG", url: "https://ddg.test/r", snippet: "from fallback" }];
  const usage: TavilyUsage[] = [];
  const reasons: string[] = [];
  const provider = new TavilyWebProvider({
    apiKey: "tvly-test",
    fetch: fetchImpl,
    fallback,
    timeoutMs,
    onUsage: (u) => usage.push(u),
    onFallback: (r) => reasons.push(r),
  });
  return { provider, fallback, usage, reasons };
}

describe("Tavily parsing", () => {
  it("maps title/url/content, keeps http(s) only, dedupes and caps", () => {
    expect(
      parseTavilyResults(
        {
          results: [
            { title: " A\n title ", url: "https://a.test/", content: "c  a", score: 0.9 },
            { title: "dup", url: "https://a.test/" },
            { title: "bad", url: "file:///etc/passwd" },
            { url: "https://b.test/" },
            { title: "C", url: "https://c.test/" },
          ],
        },
        2,
      ),
    ).toEqual([
      { title: "A title", url: "https://a.test/", snippet: "c a" },
      { title: "https://b.test/", url: "https://b.test/", snippet: "" },
    ]);
    expect(() => parseTavilyResults({ detail: "x" }, 5)).toThrow(/results/);
  });
});

describe("Tavily web provider", () => {
  it("POSTs a basic search with Bearer auth and max_results = cap", async () => {
    let seen: { url: string; init?: RequestInit } | undefined;
    const { provider, usage } = setup(async (input, init) => {
      seen = { url: String(input), init };
      return jsonResponse({ results: [{ title: "T", url: "https://t.test/", content: "s" }] });
    });
    const hits = await provider.search({ query: " q ", maxResults: 7 }, ctx);
    expect(hits).toEqual([{ title: "T", url: "https://t.test/", snippet: "s" }]);
    expect(seen?.url).toBe(TAVILY_SEARCH_ENDPOINT);
    expect(seen?.init?.method).toBe("POST");
    const headers = seen?.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer tvly-test");
    expect(JSON.parse(String(seen?.init?.body))).toMatchObject({
      query: "q",
      search_depth: "basic",
      max_results: 7,
      include_answer: false,
    });
    expect(usage).toEqual([expect.objectContaining({ outcome: "results", results: 1 })]);
  });

  it("falls back to DuckDuckGo on HTTP errors, empty results and timeouts", async () => {
    const http = setup(async () => new Response("quota", { status: 432 }));
    await expect(http.provider.search({ query: "q" }, ctx)).resolves.toHaveLength(1);
    expect(http.reasons).toEqual(["HTTP 432"]);
    expect(http.usage[0]).toMatchObject({ outcome: "error", error: "HTTP 432" });

    const empty = setup(async () => jsonResponse({ results: [] }));
    await expect(empty.provider.search({ query: "q" }, ctx)).resolves.toHaveLength(1);
    expect(empty.reasons).toEqual(["no results"]);
    expect(empty.usage[0]).toMatchObject({ outcome: "empty", results: 0 });

    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    const slow = setup(hanging, 25);
    await expect(slow.provider.search({ query: "q" }, ctx)).resolves.toHaveLength(1);
    expect(slow.reasons).toEqual(["timed out after 25 ms"]);
  });

  it("does not fall back when the caller aborted", async () => {
    const controller = new AbortController();
    const { provider, fallback } = setup(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const pending = provider.search({ query: "q", signal: controller.signal }, ctx);
    controller.abort();
    await expect(pending).rejects.toThrow("aborted");
    expect(fallback.lastSearch).toBeUndefined();
  });

  it("rejects an empty API key", () => {
    expect(() => new TavilyWebProvider({ apiKey: "  " })).toThrow(/TAVILY_API_KEY/);
  });
});

describe("SearXNG → Tavily → DuckDuckGo chain", () => {
  it("calls Tavily only when SearXNG fails", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      calls.push(new URL(url).host);
      if (url.startsWith("http://sx.test")) {
        return calls.length === 1
          ? jsonResponse({ results: [{ title: "S", url: "https://s.test/", content: "" }] })
          : new Response("down", { status: 503 });
      }
      return jsonResponse({ results: [{ title: "T", url: "https://t.test/", content: "" }] });
    };
    const ddg = new FakeWebProvider();
    const tavily = new TavilyWebProvider({
      apiKey: "k",
      fetch: fetchImpl,
      fallback: ddg,
      onUsage: () => {},
    });
    const chain = new SearxngWebProvider({
      baseUrl: "http://sx.test",
      fetch: fetchImpl,
      fallback: tavily,
      onFallback: () => {},
    });
    expect((await chain.search({ query: "a" }, ctx))[0]?.title).toBe("S");
    expect(calls).toEqual(["sx.test"]);
    expect((await chain.search({ query: "b" }, ctx))[0]?.title).toBe("T");
    expect(calls).toEqual(["sx.test", "sx.test", "api.tavily.com"]);
    expect(ddg.lastSearch).toBeUndefined();
  });

  it("factory wires Tavily behind SearXNG when TAVILY_API_KEY is set", () => {
    const env = { SEARXNG_URL: "http://sx.test:8080", TAVILY_API_KEY: "k" };
    expect(createWebProvider(resolveWebProviderKind(env), undefined, env).describe().id).toBe(
      "searxng",
    );
    expect(resolveWebProviderKind({ WEB_PROVIDER: "tavily" })).toBe("tavily");
    expect(createWebProvider("tavily", undefined, { TAVILY_API_KEY: "k" }).describe().id).toBe(
      "tavily",
    );
    expect(() => createWebProvider("tavily", undefined, {})).toThrow(/TAVILY_API_KEY/);
  });
});
