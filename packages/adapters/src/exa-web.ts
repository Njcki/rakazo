import type { WebSearchHit } from "@rakazo/adapter-kit";
import {
  type ApiSearchRequestInit,
  ApiSearchTier,
  type ApiSearchTierOptions,
  mapSearchItems,
} from "./api-search-tier.js";

export const EXA_SEARCH_ENDPOINT = "https://api.exa.ai/search";
const EXA_HIGHLIGHT_CHARS = 300;

export type ExaWebOptions = ApiSearchTierOptions & {
  /** Exa search type. Default `auto` ($7 / 1k requests); `lite` is $4 / 1k. */
  searchType?: string;
};

/**
 * Exa Search API tier. One request returns up to 10 results with short highlights (contents are
 * included in the base price up to 10 results), used as snippets.
 */
export class ExaWebProvider extends ApiSearchTier {
  protected readonly id = "exa";
  protected readonly label = "Exa";
  protected readonly defaultEndpoint = EXA_SEARCH_ENDPOINT;
  private readonly searchType: string;

  constructor(options: ExaWebOptions) {
    super(options, "EXA_API_KEY");
    this.searchType = options.searchType?.trim() || "auto";
  }

  protected buildRequest(query: string, maxResults: number): ApiSearchRequestInit {
    return {
      headers: { "x-api-key": this.apiKey },
      body: {
        query,
        type: this.searchType,
        numResults: maxResults,
        contents: { highlights: { maxCharacters: EXA_HIGHLIGHT_CHARS } },
      },
    };
  }

  protected parse(payload: unknown, maxResults: number): WebSearchHit[] {
    return parseExaResults(payload, maxResults);
  }

  protected override costOf(payload: unknown): number | undefined {
    const total = (payload as { costDollars?: { total?: unknown } } | null)?.costDollars?.total;
    return typeof total === "number" ? total : undefined;
  }
}

/** Exa `results[]`: title, url, highlights[] (or text) → web_search hits. */
export function parseExaResults(payload: unknown, maxResults: number): WebSearchHit[] {
  const results =
    payload && typeof payload === "object" ? (payload as { results?: unknown }).results : undefined;
  return mapSearchItems(results, maxResults, (record) => {
    const highlights = Array.isArray(record.highlights)
      ? record.highlights.filter((h): h is string => typeof h === "string").join(" … ")
      : "";
    const text = typeof record.text === "string" ? record.text.slice(0, EXA_HIGHLIGHT_CHARS) : "";
    return { title: record.title, url: record.url, snippet: highlights || text };
  });
}
