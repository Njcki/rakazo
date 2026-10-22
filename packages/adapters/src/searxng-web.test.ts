import type { AdapterContext } from "@rakazo/adapter-kit";
import { describe, expect, it } from "vitest";
import { FakeWebProvider } from "./fake-web.js";
import { parseSearxngResults, SearxngWebProvider, searxngSearchEndpoint } from "./searxng-web.js";
import { createWebProvider, resolveWebProviderKind } from "./web-provider-factory.js";

const ctx: AdapterContext = {
  operationId: "1",
  traceId: "1",
  spaceId: "w",
  userId: "u",
  signal: new AbortController().signal,
};

const BASE = "http://searxng.test:8080";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function setup(fetchImpl: typeof fetch, extra: { timeoutMs?: number; onResults?: () => void } = {}) {
  const fallback = new FakeWebProvider();
  fallback.searchHits = [{ title: "DDG", url: "https://ddg.test/r", snippet: "from fallback" }];
  const reasons: string[] = [];
  const provider = new SearxngWebProvider({
    baseUrl: BASE,
    fetch: fetchImpl,
    fallback,
    onFallback: (reason) => reasons.push(reason),
    categories: "news",
    language: "it",
    ...extra,
  });
  return { provider, fallback, reasons };
}

describe("SearXNG endpoint and parsing", () => {
  it("builds the /search endpoint from a base URL", () => {
    expect(searxngSearchEndpoint("http://h:8080").href).toBe("http://h:8080/search");
    expect(searxngSearchEndpoint("http://h:8080/sx/").href).toBe("http://h:8080/sx/search");
    expect(searxngSearchEndpoint("http://h:8080/search?x=1").href).toBe("http://h:8080/search");
    expect(() => searxngSearchEndpoint("ftp://h")).toThrow(/http/);
    expect(() => searxngSearchEndpoint("not a url")).toThrow(/SEARXNG_URL/);
  });

  it("maps title/url/content, keeps http(s) only, dedupes and caps", () => {
    const hits = parseSearxngResults(
      {
        results: [
          { title: "  Alpha\n news ", url: "https://a.test/1", content: "Snippet\t A" },
          { title: "Dup", url: "https://a.test/1", content: "again" },
          { title: "Bad", url: "javascript:alert(1)" },
          { title: "No url" },
          { url: "https://b.test/", content: 3 },
          { title: "C", url: "https://c.test/", content: "c" },
        ],
      },
      2,
    );
    expect(hits).toEqual([
      { title: "Alpha news", url: "https://a.test/1", snippet: "Snippet A" },
      { title: "https://b.test/", url: "https://b.test/", snippet: "" },
    ]);
  });

  it("rejects a payload without results[]", () => {
    expect(() => parseSearxngResults({ error: "x" }, 5)).toThrow(/results/);
  });
});

describe("SearXNG web provider", () => {
  it("queries the JSON API with categories/language and returns mapped hits", async () => {
    let requested = "";
    const { provider, reasons } = setup(async (input) => {
      requested = String(input);
      return jsonResponse({
        results: [
          { title: "One", url: "https://one.test/", content: "first" },
          { title: "Two", url: "https://two.test/", content: "second" },
        ],
      });
    });
    const hits = await provider.search({ query: " meteo roma ", maxResults: 5 }, ctx);
    expect(hits.map((h) => h.title)).toEqual(["One", "Two"]);
    const url = new URL(requested);
    expect(url.origin + url.pathname).toBe(`${BASE}/search`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "meteo roma",
      format: "json",
      categories: "news",
      language: "it",
    });
    expect(reasons).toEqual([]);
  });

  it("falls back to the keyless backend on HTTP errors", async () => {
    const { provider, fallback, reasons } = setup(async () => new Response("no", { status: 429 }));
    const hits = await provider.search({ query: "q", maxResults: 3 }, ctx);
    expect(hits[0]?.title).toBe("DDG");
    expect(fallback.lastSearch).toMatchObject({ query: "q", maxResults: 3 });
    expect(reasons).toEqual(["HTTP 429"]);
  });

  it("notifies onResults only when SearXNG answers", async () => {
    let reported = 0;
    const { provider } = setup(
      async () => jsonResponse({ results: [{ title: "One", url: "https://one.test/", content: "x" }] }),
      { onResults: () => reported++ },
    );
    expect((await provider.search({ query: "q" }, ctx))[0]?.title).toBe("One");
    expect(reported).toBe(1);

    const { provider: silent } = setup(async () => jsonResponse({ results: [] }), {
      onResults: () => reported++,
    });
    expect((await silent.search({ query: "q" }, ctx))[0]?.title).toBe("DDG");
    expect(reported).toBe(1);
  });

  it("falls back on network errors, non-JSON bodies and empty results", async () => {
    for (const [impl, reason] of [
      [
        async () => {
          throw new TypeError("fetch failed");
        },
        "fetch failed",
      ],
      [async () => new Response("<html>captcha</html>", { status: 200 }), "response is not JSON"],
      [async () => jsonResponse({ results: [] }), "no results"],
    ] as const) {
      const { provider, reasons } = setup(impl as typeof fetch);
      await expect(provider.search({ query: "q" }, ctx)).resolves.toHaveLength(1);
      expect(reasons[0]).toContain(reason);
    }
  });

  it("falls back when SearXNG does not answer before the timeout", async () => {
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    const { provider, reasons } = setup(hanging, { timeoutMs: 30 });
    const started = Date.now();
    const hits = await provider.search({ query: "q" }, ctx);
    expect(hits[0]?.title).toBe("DDG");
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(reasons).toEqual(["timed out after 30 ms"]);
  });

  it("does not fall back when the caller aborted", async () => {
    const controller = new AbortController();
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const { provider, fallback } = setup(hanging);
    const pending = provider.search({ query: "q", signal: controller.signal }, ctx);
    controller.abort();
    await expect(pending).rejects.toThrow("aborted");
    expect(fallback.lastSearch).toBeUndefined();
  });

  it("reports both failures when the fallback also fails", async () => {
    const { provider, fallback } = setup(async () => new Response("", { status: 502 }));
    fallback.searchError = new Error("captcha");
    await expect(provider.search({ query: "q" }, ctx)).rejects.toThrow(
      "SearXNG: HTTP 502; fallback: captcha",
    );
  });

  it("delegates web_fetch to the fallback provider unchanged", async () => {
    const { provider, fallback } = setup(async () => jsonResponse({ results: [] }));
    fallback.fetchResult = { url: "https://p.test/", title: "P", text: "body", truncated: false };
    await expect(provider.fetch({ url: "https://p.test/" }, ctx)).resolves.toEqual(
      fallback.fetchResult,
    );
  });
});

describe("web provider factory with SearXNG", () => {
  it("selects searxng from SEARXNG_URL or WEB_PROVIDER=searxng", () => {
    expect(resolveWebProviderKind({ SEARXNG_URL: BASE })).toBe("searxng");
    expect(resolveWebProviderKind({ WEB_PROVIDER: "SearXNG", SEARXNG_URL: BASE })).toBe("searxng");
    expect(resolveWebProviderKind({ WEB_PROVIDER: "keyless", SEARXNG_URL: BASE })).toBe(
      "keyless-http",
    );
    expect(resolveWebProviderKind({ SEARXNG_URL: "  " })).toBe("keyless-http");
    expect(createWebProvider("searxng", undefined, { SEARXNG_URL: BASE }).describe().id).toBe(
      "searxng",
    );
  });

  it("requires SEARXNG_URL for WEB_PROVIDER=searxng", () => {
    expect(() => createWebProvider("searxng", undefined, {})).toThrow(/SEARXNG_URL/);
  });
});
