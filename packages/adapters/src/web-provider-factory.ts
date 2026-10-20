import type { WebProvider } from "@rakazo/adapter-kit";
import { FakeWebProvider } from "./fake-web.js";
import { KeylessHttpWebProvider } from "./keyless-http-web.js";
import { SearxngWebProvider } from "./searxng-web.js";

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
 */
export function resolveWebProviderKind(source: NodeJS.ProcessEnv = process.env): string {
  const raw = source.WEB_PROVIDER?.trim().toLowerCase();
  if (!raw && source.SEARXNG_URL?.trim()) return "searxng";
  if (!raw || raw === "keyless" || raw === "keyless-http") return "keyless-http";
  if (raw === "fake") return "fake";
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
      const timeoutMs = Number(source.SEARXNG_TIMEOUT_MS);
      return new SearxngWebProvider({
        baseUrl,
        timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : undefined,
        categories: source.SEARXNG_CATEGORIES,
        language: source.SEARXNG_LANGUAGE,
        fallback: new KeylessHttpWebProvider(options),
      });
    }
    default:
      throw new Error(`Unknown web provider "${kind}"`);
  }
}
