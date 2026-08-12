import type { ApiBackend } from "./customEndpoints.js";

export type ModelReasoningCapability = {
  /** Undefined means the provider catalog and the researched model rules are inconclusive. */
  supportsReasoningEffort?: boolean;
  reasoningEfforts?: string[];
  defaultReasoningEffort?: string;
};

export type ModelReasoningCapabilityInput = {
  presetId: string;
  modelId: string;
  apiBackend: ApiBackend;
  /** Provider-advertised request parameters, currently exposed by OpenRouter. */
  supportedParameters?: readonly string[];
  /** Provider-advertised exact effort values, currently exposed by OpenRouter. */
  advertisedReasoningEfforts?: readonly string[];
  advertisedDefaultReasoningEffort?: string | null;
};

function supported(
  reasoningEfforts: readonly string[],
  defaultReasoningEffort?: string,
): ModelReasoningCapability {
  const unique = [
    ...new Set(reasoningEfforts.map((value) => value.trim()).filter(Boolean)),
  ];
  if (unique.length === 0) return {};
  return {
    supportsReasoningEffort: true,
    reasoningEfforts: unique,
    ...(defaultReasoningEffort && unique.includes(defaultReasoningEffort)
      ? { defaultReasoningEffort }
      : {}),
  };
}

function bareModelId(modelId: string): string {
  return modelId.trim().toLowerCase().split("/").at(-1) ?? "";
}

function openRouterCapability(
  input: ModelReasoningCapabilityInput,
): ModelReasoningCapability | null {
  if (input.presetId !== "openrouter") return null;
  const parameters = new Set(input.supportedParameters ?? []);
  const compatibleParameter =
    parameters.has("reasoning_effort") ||
    (input.apiBackend === "responses" && parameters.has("reasoning"));

  if (!compatibleParameter) {
    return input.supportedParameters ? { supportsReasoningEffort: false } : {};
  }
  if (!input.advertisedReasoningEfforts?.length) return {};
  return supported(
    input.advertisedReasoningEfforts,
    input.advertisedDefaultReasoningEffort ?? undefined,
  );
}

function anthropicCapability(modelId: string): ModelReasoningCapability {
  const allFive = [
    "claude-fable-5",
    "claude-mythos-5",
    "claude-opus-5",
    "claude-opus-4-8",
    "claude-opus-4-7",
    "claude-sonnet-5",
  ];
  if (allFive.some((prefix) => modelId.startsWith(prefix))) {
    return supported(["low", "medium", "high", "xhigh", "max"], "high");
  }

  const withMax = [
    "claude-mythos-preview",
    "claude-opus-4-6",
    "claude-sonnet-4-6",
  ];
  if (withMax.some((prefix) => modelId.startsWith(prefix))) {
    return supported(["low", "medium", "high", "max"], "high");
  }

  if (modelId.startsWith("claude-opus-4-5-20251101")) {
    return supported(["low", "medium", "high"], "high");
  }
  return { supportsReasoningEffort: false };
}

function openAiCapability(
  modelId: string,
  apiBackend: ApiBackend,
): ModelReasoningCapability | null {
  const isGpt5 = /^gpt-5(?:\.|-|$)/.test(modelId);
  if (apiBackend === "messages" && isGpt5) {
    return { supportsReasoningEffort: false };
  }
  if (/^gpt-5\.6(?:-|$)/.test(modelId)) {
    return supported(
      ["none", "low", "medium", "high", "xhigh", "max"],
      "medium",
    );
  }
  if (/^gpt-5\.5(?:-|$)/.test(modelId)) {
    return supported(["none", "low", "medium", "high", "xhigh"], "medium");
  }
  if (/^gpt-5\.(?:4|2)(?:-|$)/.test(modelId)) {
    return supported(["none", "low", "medium", "high", "xhigh"], "none");
  }
  if (/^gpt-5\.1(?:-|$)/.test(modelId)) {
    return supported(["none", "low", "medium", "high"], "none");
  }
  if (/^gpt-5(?:-|$)/.test(modelId)) {
    return supported(["minimal", "low", "medium", "high"], "medium");
  }
  return null;
}

function deepSeekCapability(
  presetId: string,
  modelId: string,
  apiBackend: ApiBackend,
): ModelReasoningCapability | null {
  if (!modelId.startsWith("deepseek-v4-")) {
    return presetId === "deepseek" ? { supportsReasoningEffort: false } : null;
  }
  if (modelId.startsWith("deepseek-v4-flash")) {
    return supported(["low", "high", "max"], "high");
  }
  if (modelId.startsWith("deepseek-v4-pro")) {
    return apiBackend === "responses"
      ? { supportsReasoningEffort: false }
      : supported(["high", "max"], "high");
  }
  return null;
}

function glmCapability(
  presetId: string,
  modelId: string,
  apiBackend: ApiBackend,
): ModelReasoningCapability | null {
  if (presetId !== "zhipu") return null;
  if (apiBackend !== "chat_completions") {
    return { supportsReasoningEffort: false };
  }
  if (/^glm-5\.(?:[2-9]|\d{2,})(?:-|$)/.test(modelId)) {
    // The API accepts aliases, but low/medium collapse to high and xhigh to max.
    return supported(["none", "high", "max"], "max");
  }
  return { supportsReasoningEffort: false };
}

function dashScopeCapability(
  presetId: string,
  modelId: string,
  apiBackend: ApiBackend,
): ModelReasoningCapability | null {
  if (presetId !== "dashscope") return null;
  if (apiBackend !== "chat_completions") {
    return { supportsReasoningEffort: false };
  }
  if (modelId.startsWith("qwen3.8-max")) {
    return supported(["low", "medium", "xhigh"], "xhigh");
  }
  if (/^glm-5(?:\.1|\.2)?(?:-|$)/.test(modelId)) {
    return supported(["high", "max"], "high");
  }
  if (/^deepseek-v4-(?:flash|pro)(?:-|$)/.test(modelId)) {
    return supported(["high", "max"], "high");
  }
  if (modelId === "kimi" || modelId.startsWith("kimi-k3")) {
    return supported(["max"], "max");
  }
  return { supportsReasoningEffort: false };
}

/**
 * Detect configurable reasoning effort, not merely whether a model can think.
 * Rules mirror the providers' documented wire parameters as reviewed on
 * 2026-08-11; unknown relay models deliberately remain manually configurable.
 */
export function detectModelReasoningCapability(
  input: ModelReasoningCapabilityInput,
): ModelReasoningCapability {
  const advertised = openRouterCapability(input);
  if (advertised) return advertised;

  const modelId = bareModelId(input.modelId);
  if (
    input.apiBackend === "messages" &&
    (input.presetId === "anthropic" || modelId.startsWith("claude-"))
  ) {
    return anthropicCapability(modelId);
  }

  const dashScope = dashScopeCapability(
    input.presetId,
    modelId,
    input.apiBackend,
  );
  if (dashScope) return dashScope;

  const deepSeek = deepSeekCapability(
    input.presetId,
    modelId,
    input.apiBackend,
  );
  if (deepSeek) return deepSeek;

  const openAi = openAiCapability(modelId, input.apiBackend);
  if (openAi) return openAi;

  const glm = glmCapability(input.presetId, modelId, input.apiBackend);
  if (glm) return glm;

  if (["openai", "anthropic", "minimax", "ollama"].includes(input.presetId)) {
    return { supportsReasoningEffort: false };
  }
  return {};
}
