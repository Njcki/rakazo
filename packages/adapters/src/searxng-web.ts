import type {
  AdapterContext,
  WebFetchRequest,
  WebFetchResult,
  WebProvider,
  WebSearchHit,
  WebSearchRequest,
} from "@rakazo/adapter-kit";
import { getLogger } from "@rakazo/logging";
import { KeylessHttpWebProvider } from "./keyless-http-web.js";
import { clampMaxResults } from "./web-limits.js";

const DEFAULT_SEARXNG_TIMEOUT_MS = 10_000;
const MAX_SEARXNG_RESPONSE_BYTES = 2 * 1024 * 1024;

export type SearxngWebOptions = {
  /** SearXNG base URL, e.g. `http://searxng:8080` (the instance must enable `format=json`). */
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
  /** Per-request timeout for SearXNG; on expiry the search falls back. Default 10 s. */
  timeoutMs?: number;
  /** Optional SearXNG `categories` (e.g. `general`, `news`). */
  categories?: string;
  /** Optional SearXNG `language` (e.g. `it`, `en-US`, `all`). */
  language?: string;
  /**
   * Used for every `fetch` (web_fetch stays the keyless Readability fetch) and as the search
   * fallback when SearXNG errors, times out or returns no results. Default: keyless HTTP
   * (DuckDuckGo HTML).
   */
  fallback?: WebProvider;
  /** Called when a search falls back. Default: a `warn` log line. */
  onFallback?: (reason: string) => void;
  /** Called when this tier answers a search with results (patch 0032 stats). */
  onResults?: () => void;
};

/**
 * Web provider backed by a self-hosted SearXNG JSON API, with keyless fallback.
 *
 * The base URL comes from operator configuration (`SEARXNG_URL`), so it is fetched directly
 * (it is usually a private address that the public-URL SSRF guard would refuse); result URLs
 * are only returned to the model, never fetched here, and must be http(s).
 */
export class SearxngWebProvider implements WebProvider {
  private readonly endpoint: URL;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly categories?: string;
  private readonly language?: string;
  private readonly fallback: WebProvider;
  private readonly onFallback: (reason: string) => void;
  private readonly onResults?: () => void;

  constructor(options: SearxngWebOptions) {
    this.endpoint = searxngSearchEndpoint(options.baseUrl);
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs =
      options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_SEARXNG_TIMEOUT_MS;
    this.categories = options.categories?.trim() || undefined;
    this.language = options.language?.trim() || undefined;
    this.fallback = options.fallback ?? new KeylessHttpWebProvider();
    this.onFallback =
      options.onFallback ??
      ((reason) => getLogger().warn("web_search SearXNG fallback", { reason }));
    this.onResults = options.onResults;
  }

  describe() {
    return {
      id: "searxng",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: {
        search: true,
        fetch: true,
        keyless: true,
        native: false,
        readability: true,
      },
    };
  }

  async search(request: WebSearchRequest, context: AdapterContext): Promise<WebSearchHit[]> {
    const query = request.query.trim();
    if (!query) throw new Error("query is required");
    const maxResults = clampMaxResults(request.maxResults);
    const signal = request.signal ?? context.signal;
    let reason: string;
    try {
      const hits = await this.searchSearxng(query, maxResults, signal);
      if (hits.length > 0) {
        this.onResults?.();
        return hits;
      }
      reason = "no results";
    } catch (error) {
      if (signal?.aborted) throw error;
      reason = error instanceof Error ? error.message : String(error);
    }
    this.onFallback(reason);
    try {
      return await this.fallback.search({ ...request, query, maxResults }, context);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`SearXNG: ${reason}; fallback: ${message}`);
    }
  }

  fetch(request: WebFetchRequest, context: AdapterContext): Promise<WebFetchResult> {
    return this.fallback.fetch(request, context);
  }

  private async searchSearxng(
    query: string,
    maxResults: number,
    signal: AbortSignal | undefined,
  ): Promise<WebSearchHit[]> {
    const url = new URL(this.endpoint);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    if (this.categories) url.searchParams.set("categories", this.categories);
    if (this.language) url.searchParams.set("language", this.language);
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await this.fetchImpl(url.href, {
        headers: { accept: "application/json" },
        redirect: "error",
        signal: combined,
      });
    } catch (error) {
      if (timeout.aborted && !signal?.aborted) {
        throw new Error(`timed out after ${this.timeoutMs} ms`);
      }
      throw error;
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`HTTP ${response.status}`);
    }
    const text = await response.text();
    if (text.length > MAX_SEARXNG_RESPONSE_BYTES) throw new Error("response too large");
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error("response is not JSON (is format=json enabled in settings.yml?)");
    }
    return parseSearxngResults(payload, maxResults);
  }
}

/** `http://host:8080` or `http://host:8080/prefix/` → `…/search`; a URL already ending in `/search` is kept. */
export function searxngSearchEndpoint(baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    throw new Error(`SEARXNG_URL is not a valid URL: ${baseUrl}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("SEARXNG_URL must be http(s)");
  }
  url.search = "";
  url.hash = "";
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/search") ? path : `${path}/search`;
  return url;
}

/** Map SearXNG JSON `results[]` (title, url, content) to web_search hits: http(s) only, deduped, capped. */
export function parseSearxngResults(payload: unknown, maxResults: number): WebSearchHit[] {
  const results =
    payload && typeof payload === "object" ? (payload as { results?: unknown }).results : undefined;
  if (!Array.isArray(results)) throw new Error("response has no results array");
  const hits: WebSearchHit[] = [];
  const seen = new Set<string>();
  for (const item of results) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.url !== "string") continue;
    let url: string;
    try {
      const parsed = new URL(record.url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
      url = parsed.href;
    } catch {
      continue;
    }
    if (seen.has(url)) continue;
    const title = normalizeWhitespace(typeof record.title === "string" ? record.title : "") || url;
    const snippet = normalizeWhitespace(typeof record.content === "string" ? record.content : "");
    seen.add(url);
    hits.push({ title, url, snippet });
    if (hits.length >= maxResults) break;
  }
  return hits;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
