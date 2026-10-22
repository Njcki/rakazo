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

export const TAVILY_SEARCH_ENDPOINT = "https://api.tavily.com/search";
const DEFAULT_TAVILY_TIMEOUT_MS = 10_000;
const MAX_TAVILY_RESPONSE_BYTES = 2 * 1024 * 1024;

export type TavilyUsage = {
  outcome: "results" | "empty" | "error";
  results: number;
  durationMs: number;
  error?: string;
};

export type TavilyWebOptions = {
  apiKey: string;
  fetch?: typeof globalThis.fetch;
  /** Per-request timeout; on expiry the search falls back. Default 10 s. */
  timeoutMs?: number;
  /** Override for tests or a proxy. Default https://api.tavily.com/search. */
  endpoint?: string;
  /**
   * Used for every `fetch` (web_fetch stays the keyless Readability fetch) and as the search
   * fallback when Tavily errors, times out or returns no results. Default: keyless HTTP.
   */
  fallback?: WebProvider;
  /** Called after every Tavily call (each one costs a credit). Default: an `info` log line. */
  onUsage?: (usage: TavilyUsage) => void;
  /** Called when a search falls back. Default: a `warn` log line. */
  onFallback?: (reason: string) => void;
  /** Called when this tier answers a search with results (patch 0032 stats). */
  onResults?: () => void;
};

/**
 * Tavily Search API provider (`search_depth: basic`, 1 credit per call), with keyless fallback.
 * Intended as a paid second tier behind SearXNG: only called when the tier before it failed.
 */
export class TavilyWebProvider implements WebProvider {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly endpoint: string;
  private readonly fallback: WebProvider;
  private readonly onUsage: (usage: TavilyUsage) => void;
  private readonly onFallback: (reason: string) => void;
  private readonly onResults?: () => void;

  constructor(options: TavilyWebOptions) {
    const apiKey = options.apiKey.trim();
    if (!apiKey) throw new Error("TAVILY_API_KEY is empty");
    this.apiKey = apiKey;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs =
      options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_TAVILY_TIMEOUT_MS;
    this.endpoint = options.endpoint ?? TAVILY_SEARCH_ENDPOINT;
    this.fallback = options.fallback ?? new KeylessHttpWebProvider();
    this.onUsage =
      options.onUsage ??
      ((usage) => getLogger().info("web_search Tavily call", { ...usage, provider: "tavily" }));
    this.onFallback =
      options.onFallback ??
      ((reason) => getLogger().warn("web_search Tavily fallback", { reason }));
    this.onResults = options.onResults;
  }

  describe() {
    return {
      id: "tavily",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: {
        search: true,
        fetch: true,
        keyless: false,
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
    const started = Date.now();
    let reason: string;
    try {
      const hits = await this.searchTavily(query, maxResults, signal);
      this.onUsage({
        outcome: hits.length > 0 ? "results" : "empty",
        results: hits.length,
        durationMs: Date.now() - started,
      });
      if (hits.length > 0) {
        this.onResults?.();
        return hits;
      }
      reason = "no results";
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error);
      this.onUsage({
        outcome: "error",
        results: 0,
        durationMs: Date.now() - started,
        error: reason,
      });
      if (signal?.aborted) throw error;
    }
    this.onFallback(reason);
    try {
      return await this.fallback.search({ ...request, query, maxResults }, context);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Tavily: ${reason}; fallback: ${message}`);
    }
  }

  fetch(request: WebFetchRequest, context: AdapterContext): Promise<WebFetchResult> {
    return this.fallback.fetch(request, context);
  }

  private async searchTavily(
    query: string,
    maxResults: number,
    signal: AbortSignal | undefined,
  ): Promise<WebSearchHit[]> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          query,
          search_depth: "basic",
          max_results: maxResults,
          include_answer: false,
          include_images: false,
          include_raw_content: false,
        }),
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
    if (text.length > MAX_TAVILY_RESPONSE_BYTES) throw new Error("response too large");
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error("response is not JSON");
    }
    return parseTavilyResults(payload, maxResults);
  }
}

/** Map Tavily `results[]` (title, url, content) to web_search hits: http(s) only, deduped, capped. */
export function parseTavilyResults(payload: unknown, maxResults: number): WebSearchHit[] {
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
    seen.add(url);
    const title = normalizeWhitespace(typeof record.title === "string" ? record.title : "") || url;
    const snippet = normalizeWhitespace(typeof record.content === "string" ? record.content : "");
    hits.push({ title, url, snippet });
    if (hits.length >= maxResults) break;
  }
  return hits;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
