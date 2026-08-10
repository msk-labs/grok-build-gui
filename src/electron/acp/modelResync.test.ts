import { describe, expect, it } from "vitest";
import { modelResyncArgs } from "./modelResync";

describe("modelResyncArgs", () => {
  it("re-applies a model that has no reasoning effort", () => {
    // Regression: custom endpoint models (DeepSeek, relay gateways, …) report
    // no reasoning effort. Skipping them left the session on the agent's own
    // model while the picker showed the user's choice.
    expect(modelResyncArgs("custom-deepseek-v4-pro", undefined)).toEqual({
      modelId: "custom-deepseek-v4-pro",
      reasoningEffort: null,
    });
  });

  it("keeps the effort for a model that has one", () => {
    expect(modelResyncArgs("grok-4.5", "high")).toEqual({
      modelId: "grok-4.5",
      reasoningEffort: "high",
    });
  });

  it("does nothing before a model has been chosen", () => {
    expect(modelResyncArgs(undefined, undefined)).toBeNull();
    expect(modelResyncArgs(undefined, "high")).toBeNull();
  });
});
