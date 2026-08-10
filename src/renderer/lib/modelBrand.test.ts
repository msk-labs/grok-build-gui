import { describe, expect, it } from "vitest";
import { detectBrand } from "./modelBrand";

describe("detectBrand", () => {
  it("recognizes the agent's own models", () => {
    expect(detectBrand("grok-4.5", "Grok 4.5").id).toBe("grok");
    expect(detectBrand("grok-build").id).toBe("grok");
  });

  it("recognizes subscription models by their config key", () => {
    expect(detectBrand("chatgpt-gpt-5-3-codex", "GPT-5.3 Codex (ChatGPT)").id)
      .toBe("openai");
  });

  it("recognizes gateway models by their upstream id", () => {
    expect(detectBrand("custom-deepseek-chat").id).toBe("deepseek");
    expect(detectBrand("custom-kimi-k3").id).toBe("kimi");
    expect(detectBrand("custom-moonshot-v1-128k").id).toBe("kimi");
    expect(detectBrand("custom-glm-5-2").id).toBe("glm");
    expect(detectBrand("custom-qwen3-max").id).toBe("qwen");
    expect(detectBrand("custom-minimax-m3").id).toBe("minimax");
    expect(detectBrand("custom-claude-opus-4-6").id).toBe("anthropic");
    expect(detectBrand("custom-gemini-3-pro").id).toBe("gemini");
    expect(detectBrand("custom-mixtral-8x7b").id).toBe("mistral");
    expect(detectBrand("custom-meta-llama-3-1-70b").id).toBe("llama");
  });

  it("falls back to the display name when the id is opaque", () => {
    expect(detectBrand("custom-model-7", "DeepSeek V4").id).toBe("deepseek");
  });

  it("prefers the more specific vendor when names overlap", () => {
    // "codestral" contains "codes", and Mistral must win over an OpenAI match.
    expect(detectBrand("custom-codestral-latest").id).toBe("mistral");
    // A relay may prefix everything with its own name; the model still wins.
    expect(detectBrand("custom-relay-deepseek-v4").id).toBe("deepseek");
    // "ollama" contains "llama" — the host must not be read as the model.
    expect(detectBrand("ollama-codellama").id).toBe("ollama");
  });

  it("recognizes the endpoint presets shown in the add-endpoint form", () => {
    // The form badges the selected preset by its id.
    expect(detectBrand("openrouter").id).toBe("openrouter");
    expect(detectBrand("dashscope").id).toBe("qwen");
    expect(detectBrand("zhipu").id).toBe("glm");
    expect(detectBrand("moonshot").id).toBe("kimi");
    expect(detectBrand("ollama").id).toBe("ollama");
    expect(detectBrand("anthropic").id).toBe("anthropic");
    // A relay gateway has no single vendor.
    expect(detectBrand("custom").id).toBe("generic");
  });

  it("returns a neutral badge for anything unknown", () => {
    const brand = detectBrand("custom-internal-model-1");
    expect(brand.id).toBe("generic");
    expect(brand.monogram).toBeTruthy();
  });
});
