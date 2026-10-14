import { readFileSync } from "node:fs";
import {
  createProvider,
  type Model,
  type MutableModels,
  type Provider,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";

import { declaredVisionModelIds, inputModalities } from "./model-modalities.js";
/**
 * Local OpenAI-compatible model server (Ollama, LM Studio, llama.cpp, MLX).
 *
 * Pi's built-in catalog only ships hosted providers, so a model running on the
 * operator's own machine has no catalog entry to select. This registers one
 * from environment configuration. The server is keyless: `resolve` returns a
 * placeholder because OpenAI-compatible local servers ignore the header, but
 * Models treats a provider with no resolvable auth as unconfigured and hides
 * its models.
 */
export const LOCAL_PROVIDER_ID = "local";

/** Model ids the local server serves with vision, declared by the operator. */
export const LOCAL_VISION_MODELS_ENV = "RAKAZO_LOCAL_VISION_MODELS";

export function localVisionModelIds(): ReadonlySet<string> {
  return declaredVisionModelIds(LOCAL_VISION_MODELS_ENV);
}

const DEFAULT_BASE_URL = "http://127.0.0.1:11434/v1";
const DEFAULT_CONTEXT_WINDOW = 32_768;
const DEFAULT_MAX_TOKENS = 4_096;

export function localBaseUrl(): string {
  const value = process.env.RAKAZO_LOCAL_MODELS_URL?.trim() || DEFAULT_BASE_URL;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("RAKAZO_LOCAL_MODELS_URL must be an absolute HTTP(S) URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("RAKAZO_LOCAL_MODELS_URL must be an absolute HTTP(S) URL");
  }
  return value;
}

/**
 * A token count from the environment, or the default when unset.
 *
 * Token limits are only meaningful as finite positive integers, so anything
 * else is a configuration mistake. Throwing beats `Number(x) || default`, which
 * would accept a negative window and silently swallow a typo as the default.
 */
function tokenLimit(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, received "${raw}"`);
  }
  return value;
}

/** Comma-separated model ids exactly as the local server names them. */
function localModelIds(): string[] {
  return (process.env.RAKAZO_LOCAL_MODELS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

function localModel(id: string): Model<"openai-completions"> {
  return {
    id,
    name: id,
    api: "openai-completions",
    provider: LOCAL_PROVIDER_ID,
    baseUrl: localBaseUrl(),
    reasoning: false,
    compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
    input: inputModalities(localVisionModelIds().has(id)),
    // Runs on the operator's own hardware, so there is nothing to bill.
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: tokenLimit("RAKAZO_LOCAL_CONTEXT_WINDOW", DEFAULT_CONTEXT_WINDOW),
    maxTokens: tokenLimit("RAKAZO_LOCAL_MAX_TOKENS", DEFAULT_MAX_TOKENS),
  };
}

/**
 * RAKAZO PATCH (gsq-voice): extra local entries that alias an upstream model id
 * with their own label and token limits. Read from /data/local-extra-models.json
 * (persists across container recreate) or RAKAZO_LOCAL_EXTRA_MODELS (JSON).
 * Shape: [{ "id": "alias", "upstreamId": "real-id", "name": "Label",
 *           "contextWindow": 262144, "maxTokens": 16384 }]
 */
type ExtraLocalModel = {
  id: string;
  upstreamId: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
};
const EXTRA_MODELS_FILE = "/data/local-extra-models.json";
function extraLocalModels(): ExtraLocalModel[] {
  let raw = process.env.RAKAZO_LOCAL_EXTRA_MODELS?.trim() || "";
  if (!raw) {
    try {
      raw = readFileSync(EXTRA_MODELS_FILE, "utf8");
    } catch {
      return [];
    }
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((m) => m && typeof m.id === "string" && m.id.trim())
      .map((m) => ({
        id: String(m.id).trim(),
        upstreamId: String(m.upstreamId || m.id).trim(),
        name: String(m.name || m.id),
        contextWindow: Number.isSafeInteger(m.contextWindow) && m.contextWindow > 0 ? m.contextWindow : DEFAULT_CONTEXT_WINDOW,
        maxTokens: Number.isSafeInteger(m.maxTokens) && m.maxTokens > 0 ? m.maxTokens : DEFAULT_MAX_TOKENS,
      }));
  } catch (error) {
    console.error("[local-provider] invalid extra local models config", error);
    return [];
  }
}

function extraLocalModel(extra: ExtraLocalModel): Model<"openai-completions"> {
  const base = localModel(extra.upstreamId);
  return {
    ...base,
    id: extra.id,
    name: extra.name,
    input: inputModalities(localVisionModelIds().has(extra.id) || localVisionModelIds().has(extra.upstreamId)),
    contextWindow: extra.contextWindow,
    maxTokens: extra.maxTokens,
  };
}

/** Rewrites alias ids to the upstream id the server actually serves. */
function aliasingLocalApi(extras: ExtraLocalModel[]) {
  const api = openAICompletionsApi();
  const upstream = new Map(extras.map((e) => [e.id, e.upstreamId]));
  const fix = <M extends { id: string }>(model: M): M => {
    const target = upstream.get(model.id);
    return target ? { ...model, id: target } : model;
  };
  return {
    ...api,
    stream: (
      model: Parameters<typeof api.stream>[0],
      context: Parameters<typeof api.stream>[1],
      options: Parameters<typeof api.stream>[2],
    ) => api.stream(fix(model), context, options),
    streamSimple: (
      model: Parameters<typeof api.streamSimple>[0],
      context: Parameters<typeof api.streamSimple>[1],
      options: Parameters<typeof api.streamSimple>[2],
    ) => api.streamSimple(fix(model), context, options),
  };
}

/** The provider, or undefined when no local models are configured. */
export function localProvider(): Provider | undefined {
  const ids = localModelIds();
  if (!ids.length) return undefined;
  const extras = extraLocalModels().filter((e) => !ids.includes(e.id));
  return createProvider({
    id: LOCAL_PROVIDER_ID,
    name: "Local (Ollama / LM Studio)",
    baseUrl: localBaseUrl(),
    auth: {
      apiKey: {
        name: "Local model server",
        resolve: async () => ({
          auth: { apiKey: "local", baseUrl: localBaseUrl() },
          source: "local model server",
        }),
      },
    },
    models: [...ids.map(localModel), ...extras.map(extraLocalModel)],
    api: extras.length ? aliasingLocalApi(extras) : openAICompletionsApi(),
  });
}

/** Register the local provider on a Models collection. No-op when unconfigured. */
export function registerLocalProvider(models: MutableModels): MutableModels {
  const provider = localProvider();
  if (provider) models.setProvider(provider);
  return models;
}
