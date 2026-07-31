import { describe, expect, it } from "vitest";
import type { ContextUsage, ModelState } from "../../electron/preload";
import {
  FALLBACK_CONTEXT_WINDOW_TOKENS,
  contextBreakdown,
  contextMeter,
  formatTokens,
  resolveContextWindowTokens,
} from "./contextWindow";

const models: ModelState = {
  currentModelId: "grok-4.5",
  currentReasoningEffort: "high",
  availableModels: [
    { modelId: "grok-4.5", name: "Grok 4.5", contextWindowTokens: 500_000 },
    { modelId: "mystery", name: "Mystery" },
  ],
};

const usage = (over: Partial<ContextUsage> = {}): ContextUsage => ({
  sessionId: "s1",
  usedTokens: 50_000,
  modelId: "grok-4.5",
  ...over,
});

describe("resolveContextWindowTokens", () => {
  it("uses the window the agent reported for the model", () => {
    expect(resolveContextWindowTokens("grok-4.5", models)).toBe(500_000);
  });

  it("falls back when the agent reports no window", () => {
    expect(resolveContextWindowTokens("mystery", models)).toBe(
      FALLBACK_CONTEXT_WINDOW_TOKENS,
    );
  });

  it("falls back for a model that is not in the list", () => {
    expect(resolveContextWindowTokens("gone", models)).toBe(
      FALLBACK_CONTEXT_WINDOW_TOKENS,
    );
  });

  it("uses the current model when the usage has no model id", () => {
    expect(resolveContextWindowTokens(null, models)).toBe(500_000);
  });
});

describe("contextMeter", () => {
  it("is null until the agent has reported usage", () => {
    expect(contextMeter(null, models)).toBeNull();
    expect(contextMeter(usage({ usedTokens: 0 }), models)).toBeNull();
  });

  it("computes percent, free space and level", () => {
    const meter = contextMeter(usage({ usedTokens: 50_000 }), models);
    expect(meter).toMatchObject({
      usedTokens: 50_000,
      sizeTokens: 500_000,
      percent: 10,
      freeTokens: 450_000,
      level: "normal",
    });
  });

  it("crosses into warn and danger at the thresholds", () => {
    expect(contextMeter(usage({ usedTokens: 300_000 }), models)?.level).toBe(
      "warn",
    );
    expect(contextMeter(usage({ usedTokens: 430_000 }), models)?.level).toBe(
      "danger",
    );
  });

  it("clamps when the reported window is smaller than what is in context", () => {
    const stale: ModelState = {
      ...models,
      availableModels: [
        { modelId: "grok-4.5", name: "Grok 4.5", contextWindowTokens: 10_000 },
      ],
    };
    const meter = contextMeter(usage({ usedTokens: 50_000 }), stale);
    expect(meter?.percent).toBe(100);
    expect(meter?.freeTokens).toBe(0);
    expect(meter?.usedTokens).toBe(50_000);
  });
});

describe("contextBreakdown", () => {
  it("splits cache out of input instead of double counting", () => {
    expect(
      contextBreakdown(
        usage({
          lastTurn: {
            inputTokens: 13_647,
            outputTokens: 29,
            cachedReadTokens: 11_264,
            reasoningTokens: 24,
          },
        }),
      ),
    ).toEqual({
      cachedTokens: 11_264,
      freshInputTokens: 2_383,
      outputTokens: 29,
      reasoningTokens: 24,
    });
  });

  it("is null before the first turn completes", () => {
    expect(contextBreakdown(usage())).toBeNull();
  });
});

describe("formatTokens", () => {
  it("formats the ranges the gauge shows", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(13_647)).toBe("13.6k");
    expect(formatTokens(500_000)).toBe("500k");
    expect(formatTokens(1_200_000)).toBe("1.2M");
  });
});
