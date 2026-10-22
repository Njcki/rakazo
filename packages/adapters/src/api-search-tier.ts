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

const DEFAULT_API_TIER_TIMEOUT_MS = 10_000;
const MAX_API_TIER_RESPONSE_BYTES = 2 * 1024 * 1024;

export type ApiSearchUsage = {
  outcome: "results" | "empty" | "error";
  results: number;
  durationMs: number;
  error?: string;
  /** Provider-reported cost of the call when the API returns one (Exa: USD). */
  costUsd?: number;
};

export type ApiSearchTierOptions = {
  apiKey: string;
  fetch?: typeof globalThis.fetch;
  /** Per-request timeout; on expiry the search falls back. Default 10 s. */
  timeoutMs?: number;
  /** Override for tests or a proxy. */
  endpoint?: string;
  /** Next tier for search, and the provider used for every `fetch`. Default: keyless HTTP. */
  fallback?: WebProvider;
  /** Called after every paid call. Default: an `info` log line `web_search <Label> call`. */
  onUsage?: (usage: ApiSearchUsage) => void;
  /** Called when a search falls back. Default: a `warn` log line. */
  onFallback?: (reason: string) => void;
  /** Called when this tier answers a search with results (patch 0032 stats). */
  onResults?: () => void;
};

export type ApiSearchRequestInit = { headers: Record<string, string>; body: unknown };

/**
 * Shared shape of a keyed JSON search API used as a fallback tier: POST one JSON request,
 * map the response to hits, log every call (each one spends credits), and hand the search to
 * the next tier when the API errors, times out or returns nothing. A caller abort is final.
 */
export abstract class ApiSearchTier implements WebProvider {
  protected abstract readonly id: string;
  protected abstract readonly label: string;
  protected abstract readonly defaultEndpoint: string;
  protected readonly apiKey: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly endpointOverride?: string;
  private readonly fallback: WebProvider;
  private readonly onUsageOption?: (usage: ApiSearchUsage) => void;
  private readonly onFallbackOption?: (reason: string) => void;
  private readonly onResultsOption?: () => void;

  constructor(options: ApiSearchTierOptions, keyName: string) {
    const apiKey = options.apiKey.trim();
    if (!apiKey) throw new Error(`${keyName} is empty`);
    this.apiKey = apiKey;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs =
      options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_API_TIER_TIMEOUT_MS;
    this.endpointOverride = options.endpoint;
    this.fallback = options.fallback ?? new KeylessHttpWebProvider();
    this.onUsageOption = options.onUsage;
    this.onFallbackOption = options.onFallback;
    this.onResultsOption = options.onResults;
  }

  protected abstract buildRequest(query: string, maxResults: number): ApiSearchRequestInit;
  protected abstract parse(payload: unknown, maxResults: number): WebSearchHit[];
  protected costOf(_payload: unknown): number | undefined {
    return undefined;
  }

  describe() {
    return {
      id: this.id,
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
      const { hits, costUsd } = await this.call(query, maxResults, signal);
      this.reportUsage({
        outcome: hits.length > 0 ? "results" : "empty",
        results: hits.length,
        durationMs: Date.now() - started,
        ...(costUsd === undefined ? {} : { costUsd }),
      });
      if (hits.length > 0) {
        this.onResultsOption?.();
        return hits;
      }
      reason = "no results";
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error);
      this.reportUsage({
        outcome: "error",
        results: 0,
        durationMs: Date.now() - started,
        error: reason,
      });
      if (signal?.aborted) throw error;
    }
    if (this.onFallbackOption) this.onFallbackOption(reason);
    else getLogger().warn(`web_search ${this.label} fallback`, { reason });
    try {
      return await this.fallback.search({ ...request, query, maxResults }, context);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${this.label}: ${reason}; fallback: ${message}`);
    }
  }

  fetch(request: WebFetchRequest, context: AdapterContext): Promise<WebFetchResult> {
    return this.fallback.fetch(request, context);
  }

  private reportUsage(usage: ApiSearchUsage) {
    if (this.onUsageOption) this.onUsageOption(usage);
    else getLogger().info(`web_search ${this.label} call`, { ...usage, provider: this.id });
  }

  private async call(
    query: string,
    maxResults: number,
    signal: AbortSignal | undefined,
  ): Promise<{ hits: WebSearchHit[]; costUsd?: number }> {
    const init = this.buildRequest(query, maxResults);
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpointOverride ?? this.defaultEndpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          ...init.headers,
        },
        body: JSON.stringify(init.body),
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
    if (text.length > MAX_API_TIER_RESPONSE_BYTES) throw new Error("response too large");
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error("response is not JSON");
    }
    return { hits: this.parse(payload, maxResults), costUsd: this.costOf(payload) };
  }
}

/** Map `items[]` to hits with the given field names: http(s) only, deduped, capped, whitespace-normalized. */
export function mapSearchItems(
  items: unknown,
  maxResults: number,
  pick: (record: Record<string, unknown>) => { title: unknown; url: unknown; snippet: unknown },
): WebSearchHit[] {
  if (!Array.isArray(items)) throw new Error("response has no results array");
  const hits: WebSearchHit[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const fields = pick(item as Record<string, unknown>);
    if (typeof fields.url !== "string") continue;
    let url: string;
    try {
      const parsed = new URL(fields.url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
      url = parsed.href;
    } catch {
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    const title = normalize(typeof fields.title === "string" ? fields.title : "") || url;
    const snippet = normalize(typeof fields.snippet === "string" ? fields.snippet : "");
    hits.push({ title, url, snippet });
    if (hits.length >= maxResults) break;
  }
  return hits;
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
