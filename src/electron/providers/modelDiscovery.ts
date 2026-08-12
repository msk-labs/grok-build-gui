/**
 * Ask an OpenAI-compatible endpoint what it serves.
 *
 * Relay gateways front many vendors, so their catalog is the only reliable way
 * to know which model ids are valid — typing them by hand is how you end up
 * with entries that fail at request time.
 */

import type { ApiBackend } from "./customEndpoints.js";
import { normalizeBaseUrl } from "./customEndpoints.js";
import { detectModelReasoningCapability } from "./modelReasoningCapabilities.js";

const DISCOVERY_TIMEOUT_MS = 15_000;

export type DiscoveredModel = {
  id: string;
  /** Context window when the endpoint advertises one. */
  contextWindow: number | null;
  /** Tri-state: omitted when the endpoint and researched model rules are inconclusive. */
  supportsReasoningEffort?: boolean;
  reasoningEfforts?: string[];
  defaultReasoningEffort?: string;
  /** Raw provider metadata used by the capability detector. */
  supportedParameters?: string[];
  advertisedReasoningEfforts?: string[];
  advertisedDefaultReasoningEffort?: string;
};

export type DiscoveryResult =
  { ok: true; models: DiscoveredModel[] } | { ok: false; error: string };

function readContextWindow(entry: Record<string, unknown>): number | null {
  // No standard field: OpenAI omits it, gateways use varying names.
  for (const key of [
    "context_window",
    "context_length",
    "max_context_tokens",
  ]) {
    const value = entry[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return null;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = value.filter(
    (entry): entry is string =>
      typeof entry === "string" && Boolean(entry.trim()),
  );
  return entries.length
    ? [...new Set(entries.map((entry) => entry.trim()))]
    : undefined;
}

function readReasoningMetadata(
  entry: Record<string, unknown>,
): Pick<
  DiscoveredModel,
  | "supportedParameters"
  | "advertisedReasoningEfforts"
  | "advertisedDefaultReasoningEffort"
> {
  const reasoning =
    entry.reasoning && typeof entry.reasoning === "object"
      ? (entry.reasoning as Record<string, unknown>)
      : null;
  const defaultEffort = reasoning?.default_effort;
  const supportedParameters = readStringArray(entry.supported_parameters);
  const advertisedReasoningEfforts = readStringArray(
    reasoning?.supported_efforts,
  );
  return {
    ...(supportedParameters ? { supportedParameters } : {}),
    ...(advertisedReasoningEfforts ? { advertisedReasoningEfforts } : {}),
    ...(typeof defaultEffort === "string" && defaultEffort.trim()
      ? { advertisedDefaultReasoningEffort: defaultEffort.trim() }
      : {}),
  };
}

/** Parse an OpenAI-style `/models` payload, tolerating gateway variations. */
export function parseModelList(body: unknown): DiscoveredModel[] {
  const root = body as { data?: unknown; models?: unknown } | null;
  const rows = Array.isArray(root?.data)
    ? root.data
    : Array.isArray(root?.models)
      ? root.models
      : Array.isArray(body)
        ? body
        : [];

  const seen = new Set<string>();
  const models: DiscoveredModel[] = [];
  for (const row of rows) {
    let id: string | null = null;
    let entry: Record<string, unknown> = {};
    if (typeof row === "string") {
      id = row;
    } else if (row && typeof row === "object") {
      entry = row as Record<string, unknown>;
      const raw = entry.id ?? entry.name ?? entry.model;
      if (typeof raw === "string") id = raw;
    }
    if (!id) continue;
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    models.push({
      id: trimmed,
      contextWindow: readContextWindow(entry),
      ...readReasoningMetadata(entry),
    });
  }
  return models.sort((a, b) => a.id.localeCompare(b.id));
}

export type FetchLike = typeof fetch;

/**
 * List the models an endpoint serves. Anthropic-style endpoints authenticate
 * with `x-api-key`; everything else uses a bearer token.
 */
export async function discoverModels(
  options: {
    baseUrl: string;
    apiKey: string;
    apiBackend: ApiBackend;
    presetId?: string;
  },
  fetchImpl: FetchLike = fetch,
): Promise<DiscoveryResult> {
  const base = normalizeBaseUrl(options.baseUrl);
  if (!base) return { ok: false, error: "Enter an endpoint URL first." };

  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.apiKey) {
    if (options.apiBackend === "messages") {
      headers["x-api-key"] = options.apiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else {
      headers.Authorization = `Bearer ${options.apiKey}`;
    }
  }

  let response: Response;
  try {
    response = await fetchImpl(`${base}/models`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? `Could not reach ${base}: ${error.message}`
          : `Could not reach ${base}.`,
    };
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: "The endpoint rejected this API key." };
    }
    if (response.status === 404) {
      return {
        ok: false,
        error: `${base}/models was not found. Check the URL — it usually ends in /v1.`,
      };
    }
    return {
      ok: false,
      error: `The endpoint returned ${response.status} for /models.`,
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: "The endpoint did not return JSON." };
  }

  const models = parseModelList(body);
  if (models.length === 0) {
    return { ok: false, error: "The endpoint listed no models." };
  }
  return {
    ok: true,
    models: models.map((model) => ({
      ...model,
      ...detectModelReasoningCapability({
        presetId: options.presetId ?? "custom",
        modelId: model.id,
        apiBackend: options.apiBackend,
        supportedParameters: model.supportedParameters,
        advertisedReasoningEfforts: model.advertisedReasoningEfforts,
        advertisedDefaultReasoningEffort:
          model.advertisedDefaultReasoningEffort,
      }),
    })),
  };
}
