import type { WebProvider } from "@rakazo/adapter-kit";
import { FakeWebProvider } from "./fake-web.js";
import { KeylessHttpWebProvider } from "./keyless-http-web.js";
import { SearxngWebProvider } from "./searxng-web.js";
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
 * Tavily: with `TAVILY_API_KEY` set it becomes the second tier behind SearXNG
 * (SearXNG → Tavily → DuckDuckGo); Tavily is only called when SearXNG errors,
 * times out or finds nothing. `WEB_PROVIDER=tavily` uses Tavily first.
 * Optional `TAVILY_TIMEOUT_MS`.
 */
export function resolveWebProviderKind(source: NodeJS.ProcessEnv = process.env): string {
  const raw = source.WEB_PROVIDER?.trim().toLowerCase();
  if (!raw && source.SEARXNG_URL?.trim()) return "searxng";
  if (!raw || raw === "keyless" || raw === "keyless-http") return "keyless-http";
  if (raw === "fake") return "fake";
  if (raw === "tavily") return "tavily";
  return raw;
}

export function createWebProvider(
  kind: string = resolveWebProviderKind(),
  options?: ConstructorParameters<typeof KeylessHttpWebProvider>[0],
  source: NodeJS.ProcessEnv = process.env,
): WebProvider {
  switch (kind) {
    case "fake":
      return new FakeWebProvider();
    case "keyless-http":
    case "keyless":
    case "":
      return new KeylessHttpWebProvider(options);
    case "searxng": {
      const baseUrl = source.SEARXNG_URL?.trim();
      if (!baseUrl) throw new Error("WEB_PROVIDER=searxng requires SEARXNG_URL");
      const keyless = new KeylessHttpWebProvider(options);
      const apiKey = source.TAVILY_API_KEY?.trim();
      return new SearxngWebProvider({
        baseUrl,
        timeoutMs: positiveNumber(source.SEARXNG_TIMEOUT_MS),
        categories: source.SEARXNG_CATEGORIES,
        language: source.SEARXNG_LANGUAGE,
        fallback: apiKey
          ? new TavilyWebProvider({
              apiKey,
              timeoutMs: positiveNumber(source.TAVILY_TIMEOUT_MS),
              fallback: keyless,
            })
          : keyless,
      });
    }
    case "tavily": {
      const apiKey = source.TAVILY_API_KEY?.trim();
      if (!apiKey) throw new Error("WEB_PROVIDER=tavily requires TAVILY_API_KEY");
      return new TavilyWebProvider({
        apiKey,
        timeoutMs: positiveNumber(source.TAVILY_TIMEOUT_MS),
        fallback: new KeylessHttpWebProvider(options),
      });
    }
    default:
      throw new Error(`Unknown web provider "${kind}"`);
  }
}

function positiveNumber(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
