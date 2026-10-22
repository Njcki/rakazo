import type { AdapterContext } from "@rakazo/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import type { ApiSearchUsage } from "./api-search-tier.js";
import { EXA_SEARCH_ENDPOINT, ExaWebProvider, parseExaResults } from "./exa-web.js";
import { FakeWebProvider } from "./fake-web.js";
import { SearxngWebProvider } from "./searxng-web.js";
import { parseSerperResults, SERPER_SEARCH_ENDPOINT, SerperWebProvider } from "./serper-web.js";
import { TavilyWebProvider } from "./tavily-web.js";
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

type Seen = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

function capture(response: () => Response) {
  const seen: Seen[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    seen.push({
      url: String(input),
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(String(init?.body)),
    });
    return response();
  };
  return { seen, fetchImpl };
}

function fallbackFake() {
  const fallback = new FakeWebProvider();
  fallback.searchHits = [{ title: "DDG", url: "https://ddg.test/", snippet: "" }];
  return fallback;
}

describe("Exa tier", () => {
  it("parses results with highlights (or text) as snippet", () => {
    expect(
      parseExaResults(
        {
          results: [
            { title: "A", url: "https://a.test/", highlights: ["one", "two"] },
            { title: "B", url: "https://b.test/", text: "x".repeat(400) },
            { title: "bad", url: "mailto:x@y.z" },
          ],
        },
        5,
      ),
    ).toEqual([
      { title: "A", url: "https://a.test/", snippet: "one … two" },
      { title: "B", url: "https://b.test/", snippet: "x".repeat(300) },
    ]);
  });

  it("POSTs type auto, numResults = cap and short highlights with x-api-key; logs cost", async () => {
    const { seen, fetchImpl } = capture(() =>
      jsonResponse({
        results: [{ title: "E", url: "https://e.test/", highlights: ["h"] }],
        costDollars: { total: 0.007 },
      }),
    );
    const usage: ApiSearchUsage[] = [];
    const exa = new ExaWebProvider({
      apiKey: "exa-k",
      fetch: fetchImpl,
      onUsage: (u) => usage.push(u),
    });
    await expect(exa.search({ query: " q ", maxResults: 6 }, ctx)).resolves.toEqual([
      { title: "E", url: "https://e.test/", snippet: "h" },
    ]);
    expect(seen[0]?.url).toBe(EXA_SEARCH_ENDPOINT);
    expect(seen[0]?.headers["x-api-key"]).toBe("exa-k");
    expect(seen[0]?.body).toEqual({
      query: "q",
      type: "auto",
      numResults: 6,
      contents: { highlights: { maxCharacters: 300 } },
    });
    expect(usage).toEqual([
      expect.objectContaining({ outcome: "results", results: 1, costUsd: 0.007 }),
    ]);
  });

  it("falls back on errors and empty results", async () => {
    for (const [response, reason] of [
      [() => new Response("", { status: 402 }), "HTTP 402"],
      [() => jsonResponse({ results: [] }), "no results"],
    ] as const) {
      const reasons: string[] = [];
      const fallback = fallbackFake();
      const exa = new ExaWebProvider({
        apiKey: "k",
        fetch: capture(response).fetchImpl,
        fallback,
        onUsage: () => {},
        onFallback: (r) => reasons.push(r),
      });
      expect((await exa.search({ query: "q" }, ctx))[0]?.title).toBe("DDG");
      expect(reasons).toEqual([reason]);
    }
  });

  it("times out into the fallback", async () => {
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    const reasons: string[] = [];
    const exa = new ExaWebProvider({
      apiKey: "k",
      fetch: hanging,
      timeoutMs: 20,
      fallback: fallbackFake(),
      onUsage: () => {},
      onFallback: (r) => reasons.push(r),
    });
    expect((await exa.search({ query: "q" }, ctx))[0]?.title).toBe("DDG");
    expect(reasons).toEqual(["timed out after 20 ms"]);
  });
});

describe("Serper tier", () => {
  it("maps organic[] link/snippet and treats a missing organic as empty", () => {
    expect(
      parseSerperResults(
        { organic: [{ title: "G", link: "https://g.test/", snippet: "s", position: 1 }] },
        5,
      ),
    ).toEqual([{ title: "G", url: "https://g.test/", snippet: "s" }]);
    expect(parseSerperResults({ searchParameters: {} }, 5)).toEqual([]);
  });

  it("POSTs {q, num, gl, hl} with X-API-KEY", async () => {
    const { seen, fetchImpl } = capture(() =>
      jsonResponse({ organic: [{ title: "G", link: "https://g.test/", snippet: "s" }] }),
    );
    const usage: ApiSearchUsage[] = [];
    const serper = new SerperWebProvider({
      apiKey: "sp-k",
      fetch: fetchImpl,
      country: "it",
      language: "it",
      onUsage: (u) => usage.push(u),
    });
    await expect(serper.search({ query: "q", maxResults: 4 }, ctx)).resolves.toHaveLength(1);
    expect(seen[0]?.url).toBe(SERPER_SEARCH_ENDPOINT);
    expect(seen[0]?.headers["x-api-key"]).toBe("sp-k");
    expect(seen[0]?.body).toEqual({ q: "q", num: 4, gl: "it", hl: "it" });
    expect(usage[0]).toMatchObject({ outcome: "results", results: 1 });
  });

  it("omits gl/hl when not configured", async () => {
    const { seen, fetchImpl } = capture(() => jsonResponse({ organic: [] }));
    const serper = new SerperWebProvider({
      apiKey: "k",
      fetch: fetchImpl,
      fallback: fallbackFake(),
      onUsage: () => {},
      onFallback: () => {},
    });
    await serper.search({ query: "q" }, ctx);
    expect(seen[0]?.body).toEqual({ q: "q", num: 5 });
  });

  it("rejects an empty key", () => {
    expect(() => new SerperWebProvider({ apiKey: "" })).toThrow(/SERPER_API_KEY/);
    expect(() => new ExaWebProvider({ apiKey: " " })).toThrow(/EXA_API_KEY/);
  });
});

describe("full chain SearXNG → Tavily → Exa → Serper → DuckDuckGo", () => {
  it("calls each tier only after every earlier tier failed", async () => {
    const calls: string[] = [];
    const ok = new Set<string>();
    const fetchImpl: typeof fetch = async (input) => {
      const host = new URL(String(input)).host;
      calls.push(host);
      if (!ok.has(host)) return new Response("", { status: 503 });
      if (host === "google.serper.dev") {
        return jsonResponse({ organic: [{ title: host, link: "https://r.test/", snippet: "" }] });
      }
      return jsonResponse({ results: [{ title: host, url: "https://r.test/", content: "" }] });
    };
    const quiet = { onUsage: () => {}, onFallback: () => {} };
    const ddg = fallbackFake();
    const serper = new SerperWebProvider({
      apiKey: "s",
      fetch: fetchImpl,
      fallback: ddg,
      ...quiet,
    });
    const exa = new ExaWebProvider({ apiKey: "e", fetch: fetchImpl, fallback: serper, ...quiet });
    const tavily = new TavilyWebProvider({
      apiKey: "t",
      fetch: fetchImpl,
      fallback: exa,
      ...quiet,
    });
    const chain = new SearxngWebProvider({
      baseUrl: "http://sx.test",
      fetch: fetchImpl,
      fallback: tavily,
      onFallback: () => {},
    });

    ok.add("google.serper.dev");
    expect((await chain.search({ query: "q" }, ctx))[0]?.title).toBe("google.serper.dev");
    expect(calls).toEqual(["sx.test", "api.tavily.com", "api.exa.ai", "google.serper.dev"]);

    calls.length = 0;
    ok.add("api.exa.ai");
    expect((await chain.search({ query: "q" }, ctx))[0]?.title).toBe("api.exa.ai");
    expect(calls).toEqual(["sx.test", "api.tavily.com", "api.exa.ai"]);

    calls.length = 0;
    ok.clear();
    expect((await chain.search({ query: "q" }, ctx))[0]?.title).toBe("DDG");
    expect(calls).toHaveLength(4);
  });

  it("factory includes only the tiers whose key is set", () => {
    const env = {
      SEARXNG_URL: "http://sx.test:8080",
      EXA_API_KEY: "e",
      SERPER_API_KEY: "s",
    };
    expect(createWebProvider(resolveWebProviderKind(env), undefined, env).describe().id).toBe(
      "searxng",
    );
    expect(resolveWebProviderKind({ WEB_PROVIDER: "Exa" })).toBe("exa");
    expect(createWebProvider("exa", undefined, env).describe().id).toBe("exa");
    expect(createWebProvider("serper", undefined, env).describe().id).toBe("serper");
    expect(() => createWebProvider("serper", undefined, {})).toThrow(/SERPER_API_KEY/);
  });

  it("factory reports the tier that answered a search", async () => {
    const publicResolver = async () => [{ address: "203.0.113.10", family: 4 as const }];
    const html = `<div class="result"><a class="result__a" href="https://example.test/a">Alpha</a></div>`;
    let fetchImpl: typeof fetch = async () => new Response("no", { status: 500 });
    const stub = (searxng: Response, tavily: Response) => {
      fetchImpl = async (input) => {
        const url = String(input);
        if (url.startsWith("http://sx.test")) return searxng;
        if (url.startsWith("https://api.tavily.com")) return tavily;
        return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
      };
      vi.stubGlobal("fetch", fetchImpl);
    };
    const make = (reported: string[]) =>
      createWebProvider(
        "searxng",
        // A distinct wrapper: the keyless tier pairs the global fetch with its
        // own dispatcher, so the stub must reach it through options instead.
        { fetch: (input, init) => fetchImpl(input, init), resolveHostname: publicResolver },
        { SEARXNG_URL: "http://sx.test:8080", TAVILY_API_KEY: "k" },
        (service) => reported.push(service),
      );
    try {
      let reported: string[] = [];
      stub(
        jsonResponse({ results: [{ title: "S", url: "https://s.test/", content: "" }] }),
        jsonResponse({ results: [] }),
      );
      expect((await make(reported).search({ query: "q" }, ctx))[0]?.title).toBe("S");
      expect(reported).toEqual(["SearXNG"]);

      reported = [];
      stub(new Response("down", { status: 503 }), jsonResponse({ results: [{ title: "T", url: "https://t.test/", content: "" }] }));
      expect((await make(reported).search({ query: "q" }, ctx))[0]?.title).toBe("T");
      expect(reported).toEqual(["Tavily"]);

      reported = [];
      stub(new Response("down", { status: 503 }), jsonResponse({ results: [] }));
      expect((await make(reported).search({ query: "q" }, ctx))[0]?.title).toBe("Alpha");
      expect(reported).toEqual(["DuckDuckGo"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
