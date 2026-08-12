import { describe, expect, it } from "vitest";
import { CHATGPT_MODELS, modelConfigKey } from "./chatgptModels";

describe("CHATGPT_MODELS", () => {
  it("exposes the complete Coding Plan catalog in product order", () => {
    expect(CHATGPT_MODELS.map((model) => model.id)).toEqual([
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.5",
      "gpt-5.2",
    ]);
    expect(CHATGPT_MODELS.map((model) => model.label)).toEqual([
      "5.6 Sol",
      "5.6 Terra",
      "5.6 Luna",
      "5.5",
      "5.2",
    ]);
  });

  it("publishes the five Coding Plan reasoning levels for every GPT model", () => {
    for (const model of CHATGPT_MODELS) {
      expect(model.reasoningEfforts).toEqual([
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
      ]);
      expect(model.defaultReasoningEffort).toBe("high");
    }
  });

  it("creates stable OAuth config keys for the current model ids", () => {
    expect(modelConfigKey("gpt-5.6-sol")).toBe("chatgpt-gpt-5-6-sol");
    expect(modelConfigKey("gpt-5.6-terra")).toBe("chatgpt-gpt-5-6-terra");
    expect(modelConfigKey("gpt-5.6-luna")).toBe("chatgpt-gpt-5-6-luna");
    expect(modelConfigKey("gpt-5.5")).toBe("chatgpt-gpt-5-5");
    expect(modelConfigKey("gpt-5.2")).toBe("chatgpt-gpt-5-2");
  });
});
