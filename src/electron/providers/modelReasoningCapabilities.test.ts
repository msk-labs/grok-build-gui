import { describe, expect, it } from "vitest";
import { detectModelReasoningCapability } from "./modelReasoningCapabilities";

const detect = (
  presetId: string,
  modelId: string,
  apiBackend: "chat_completions" | "responses" | "messages" =
    "chat_completions",
) => detectModelReasoningCapability({ presetId, modelId, apiBackend });

describe("detectModelReasoningCapability", () => {
  it("uses the documented DeepSeek V4 effort levels and defaults", () => {
    expect(detect("deepseek", "deepseek-v4-flash")).toEqual({
      supportsReasoningEffort: true,
      reasoningEfforts: ["low", "high", "max"],
      defaultReasoningEffort: "high",
    });
    expect(detect("deepseek", "deepseek-v4-pro")).toEqual({
      supportsReasoningEffort: true,
      reasoningEfforts: ["high", "max"],
      defaultReasoningEffort: "high",
    });
    expect(detect("deepseek", "deepseek-v4-pro", "responses")).toEqual({
      supportsReasoningEffort: false,
    });
    expect(detect("deepseek", "deepseek-v4-flash", "messages")).toEqual({
      supportsReasoningEffort: true,
      reasoningEfforts: ["low", "high", "max"],
      defaultReasoningEffort: "high",
    });
  });

  it("does not infer configurable effort from legacy DeepSeek thinking", () => {
    expect(detect("deepseek", "deepseek-reasoner")).toEqual({
      supportsReasoningEffort: false,
    });
  });

  it("uses the exact OpenAI GPT-5 family values", () => {
    expect(detect("openai", "gpt-5.6")).toEqual({
      supportsReasoningEffort: true,
      reasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
      defaultReasoningEffort: "medium",
    });
    expect(detect("openai", "gpt-5.4-2026-03-05")).toEqual({
      supportsReasoningEffort: true,
      reasoningEfforts: ["none", "low", "medium", "high", "xhigh"],
      defaultReasoningEffort: "none",
    });
    expect(detect("openai", "gpt-4o")).toEqual({
      supportsReasoningEffort: false,
    });
    expect(detect("custom", "gpt-5.6", "messages")).toEqual({
      supportsReasoningEffort: false,
    });
  });

  it("enables Anthropic effort only on the Messages backend", () => {
    expect(detect("anthropic", "claude-opus-4-6", "messages")).toEqual({
      supportsReasoningEffort: true,
      reasoningEfforts: ["low", "medium", "high", "max"],
      defaultReasoningEffort: "high",
    });
    expect(detect("anthropic", "claude-sonnet-4-5", "messages")).toEqual({
      supportsReasoningEffort: false,
    });
    expect(detect("anthropic", "claude-opus-4-6")).toEqual({
      supportsReasoningEffort: false,
    });
  });

  it("recognizes Zhipu GLM 5.2 and later without inventing duplicate aliases", () => {
    expect(detect("zhipu", "glm-5.2")).toEqual({
      supportsReasoningEffort: true,
      reasoningEfforts: ["none", "high", "max"],
      defaultReasoningEffort: "max",
    });
    expect(detect("zhipu", "glm-5.1")).toEqual({
      supportsReasoningEffort: false,
    });
  });

  it("uses DashScope-specific effort values", () => {
    expect(detect("dashscope", "qwen3.8-max")).toEqual({
      supportsReasoningEffort: true,
      reasoningEfforts: ["low", "medium", "xhigh"],
      defaultReasoningEffort: "xhigh",
    });
    expect(detect("dashscope", "deepseek-v4-pro")).toEqual({
      supportsReasoningEffort: true,
      reasoningEfforts: ["high", "max"],
      defaultReasoningEffort: "high",
    });
    expect(detect("dashscope", "kimi-k3")).toEqual({
      supportsReasoningEffort: true,
      reasoningEfforts: ["max"],
      defaultReasoningEffort: "max",
    });
  });

  it("keeps unknown custom relay models manually configurable", () => {
    expect(detect("custom", "vendor/new-model")).toEqual({});
  });

  it("trusts compatible OpenRouter per-model metadata", () => {
    expect(
      detectModelReasoningCapability({
        presetId: "openrouter",
        modelId: "vendor/model",
        apiBackend: "chat_completions",
        supportedParameters: ["reasoning_effort"],
        advertisedReasoningEfforts: ["high", "none", "high"],
        advertisedDefaultReasoningEffort: "high",
      }),
    ).toEqual({
      supportsReasoningEffort: true,
      reasoningEfforts: ["high", "none"],
      defaultReasoningEffort: "high",
    });
  });

  it("does not enable OpenRouter when the selected backend has no compatible parameter", () => {
    expect(
      detectModelReasoningCapability({
        presetId: "openrouter",
        modelId: "vendor/model",
        apiBackend: "chat_completions",
        supportedParameters: ["reasoning"],
        advertisedReasoningEfforts: ["high", "none"],
      }),
    ).toEqual({ supportsReasoningEffort: false });
  });
});
