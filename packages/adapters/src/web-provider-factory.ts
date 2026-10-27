import type { WebProvider } from "@rakazo/adapter-kit";
import { ExaWebProvider } from "./exa-web.js";
import { FakeWebProvider } from "./fake-web.js";
import { KeylessHttpWebProvider } from "./keyless-http-web.js";
import { ParallelWebProvider } from "./parallel-web.js";
import { SearxngWebProvider } from "./searxng-web.js";
import { SerperWebProvider } from "./serper-web.js";
import { TavilyWebProvider } from "./tavily-web.js";

/**
 * Resolve the deployment web provider.
 *
 * Pi 0.84 does not expose a provider-neutral callable native-search API we can
 * compose without vendor branches at the tool layer. Default is keyless HTTP so
 * core runs with no hosted search vendor. Inject a custom adapter (or set
 * WEB_PROVIDER=fake in tests) without changing builtin tool names.
 *
 * SearXNG: `SEARXNG_URL` alone selects it (unless WEB_PROVIDER says otherwise);
 * `WEB_PROVIDER=searxng` requires `SEARXNG_URL`. Optional `SEARXNG_TIMEOUT_MS`,
 * `SEARXNG_CATEGORIES`, `SEARXNG_LANGUAGE`. Falls back to keyless HTTP search.
 *
 * Paid fallback tiers, each enabled by its key and each called only when every
 * earlier tier errored, timed out or found nothing:
 * SearXNG → Tavily (`TAVILY_API_KEY`) → Exa (`EXA_API_KEY`) → Serper
 * (`SERPER_API_KEY`) → DuckDuckGo. Optional `TAVILY_TIMEOUT_MS`, `EXA_TIMEOUT_MS`,
 * `EXA_SEARCH_TYPE` (default auto), `SERPER_TIMEOUT_MS`, `SERPER_GL`, `SERPER_HL`.
 * `WEB_PROVIDER=tavily|exa|serper` starts the chain at that tier.
 */
export function resolveWebProviderKind(source: NodeJS.ProcessEnv = process.env): string {
  const raw = source.WEB_PROVIDER?.trim().toLowerCase();
  if (!raw && source.SEARXNG_URL?.trim()) return "searxng";
  if (!raw || raw === "keyless" || raw === "keyless-http") return "keyless-http";
  if (raw === "fake") return "fake";
  if (raw === "tavily" || raw === "exa" || raw === "serper") return raw;
  return raw;
}

/**
 * Create the deployment web provider. `onResults` (patch 0032) is called with the
 * friendly name of the tier that answered a search with results.
 */
export function createWebProvider(
  kind: string = resolveWebProviderKind(),
  options?: ConstructorParameters<typeof KeylessHttpWebProvider>[0],
  source: NodeJS.ProcessEnv = process.env,
  onResults?: (service: string) => void,
): WebProvider {
  const notify = (service: string) => (onResults ? () => onResults(service) : undefined);
  switch (kind) {
    case "parallel":
      return new ParallelWebProvider(options);
    case "fake":
      return new FakeWebProvider();
    case "keyless-http":
    case "keyless":
    case "":
      return new KeylessHttpWebProvider({ ...options, onResults: notify("DuckDuckGo") });
    case "searxng": {
      const baseUrl = source.SEARXNG_URL?.trim();
      if (!baseUrl) throw new Error("WEB_PROVIDER=searxng requires SEARXNG_URL");
      return new SearxngWebProvider({
        baseUrl,
        timeoutMs: positiveNumber(source.SEARXNG_TIMEOUT_MS),
        categories: source.SEARXNG_CATEGORIES,
        language: source.SEARXNG_LANGUAGE,
        onResults: notify("SearXNG"),
        fallback: fallbackChain(source, options, "tavily", onResults),
      });
    }
    case "tavily":
    case "exa":
    case "serper": {
      const keyName = `${kind.toUpperCase()}_API_KEY`;
      if (!source[keyName]?.trim()) throw new Error(`WEB_PROVIDER=${kind} requires ${keyName}`);
      return fallbackChain(source, options, kind, onResults);
    }
    default:
      throw new Error(`Unknown web provider "${kind}"`);
  }
}

const PAID_TIERS = ["tavily", "exa", "serper"] as const;

const TIER_SERVICE_NAMES: Record<(typeof PAID_TIERS)[number], string> = {
  tavily: "Tavily",
  exa: "Exa",
  serper: "Serper",
};

/** Paid tiers from `from` onward whose key is set, ending in keyless DuckDuckGo. */
function fallbackChain(
  source: NodeJS.ProcessEnv,
  options: ConstructorParameters<typeof KeylessHttpWebProvider>[0],
  from: (typeof PAID_TIERS)[number],
  onResults?: (service: string) => void,
): WebProvider {
  const notify = (service: string) => (onResults ? () => onResults(service) : undefined);
  let next: WebProvider = new KeylessHttpWebProvider({ ...options, onResults: notify("DuckDuckGo") });
  for (const tier of PAID_TIERS.slice(PAID_TIERS.indexOf(from)).reverse()) {
    const apiKey = source[`${tier.toUpperCase()}_API_KEY`]?.trim();
    if (!apiKey) continue;
    if (tier === "serper") {
      next = new SerperWebProvider({
        apiKey,
        timeoutMs: positiveNumber(source.SERPER_TIMEOUT_MS),
        country: source.SERPER_GL,
        language: source.SERPER_HL,
        onResults: notify(TIER_SERVICE_NAMES[tier]),
        fallback: next,
      });
    } else if (tier === "exa") {
      next = new ExaWebProvider({
        apiKey,
        timeoutMs: positiveNumber(source.EXA_TIMEOUT_MS),
        searchType: source.EXA_SEARCH_TYPE,
        onResults: notify(TIER_SERVICE_NAMES[tier]),
        fallback: next,
      });
    } else {
      next = new TavilyWebProvider({
        apiKey,
        timeoutMs: positiveNumber(source.TAVILY_TIMEOUT_MS),
        onResults: notify(TIER_SERVICE_NAMES[tier]),
        fallback: next,
      });
    }
  }
  return next;
}

function positiveNumber(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
