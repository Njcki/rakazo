import type { WebSearchHit } from "@rakazo/adapter-kit";
import {
  type ApiSearchRequestInit,
  ApiSearchTier,
  type ApiSearchTierOptions,
  mapSearchItems,
} from "./api-search-tier.js";

export const SERPER_SEARCH_ENDPOINT = "https://google.serper.dev/search";

export type SerperWebOptions = ApiSearchTierOptions & {
  /** Google country code, e.g. `it` (Serper `gl`). */
  country?: string;
  /** Google interface language, e.g. `it` (Serper `hl`). */
  language?: string;
};

/** Serper (Google results) tier: 1 credit per query up to 10 results. Maps `organic[]`. */
export class SerperWebProvider extends ApiSearchTier {
  protected readonly id = "serper";
  protected readonly label = "Serper";
  protected readonly defaultEndpoint = SERPER_SEARCH_ENDPOINT;
  private readonly country?: string;
  private readonly language?: string;

  constructor(options: SerperWebOptions) {
    super(options, "SERPER_API_KEY");
    this.country = options.country?.trim() || undefined;
    this.language = options.language?.trim() || undefined;
  }

  protected buildRequest(query: string, maxResults: number): ApiSearchRequestInit {
    return {
      headers: { "x-api-key": this.apiKey },
      body: {
        q: query,
        num: maxResults,
        ...(this.country ? { gl: this.country } : {}),
        ...(this.language ? { hl: this.language } : {}),
      },
    };
  }

  protected parse(payload: unknown, maxResults: number): WebSearchHit[] {
    return parseSerperResults(payload, maxResults);
  }
}

/** Serper `organic[]`: title, link, snippet → web_search hits. */
export function parseSerperResults(payload: unknown, maxResults: number): WebSearchHit[] {
  if (!payload || typeof payload !== "object") throw new Error("response is not an object");
  // Serper omits `organic` when Google has no web results.
  const organic = (payload as { organic?: unknown }).organic ?? [];
  return mapSearchItems(organic, maxResults, (record) => ({
    title: record.title,
    url: record.link,
    snippet: record.snippet,
  }));
}
