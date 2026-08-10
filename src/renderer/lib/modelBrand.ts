/**
 * Maps a model to the vendor it comes from, for the picker's badges.
 *
 * Matching is on the id first and the display name second, because a relay
 * gateway names models after the upstream vendor (`deepseek-chat`) while the
 * label is free text the user can edit.
 */

export type BrandId =
  | "grok"
  | "openai"
  | "anthropic"
  | "deepseek"
  | "kimi"
  | "glm"
  | "minimax"
  | "qwen"
  | "gemini"
  | "llama"
  | "mistral"
  | "ollama"
  | "openrouter"
  | "generic";

export type Brand = {
  id: BrandId;
  label: string;
  /** 1–2 characters shown in the badge. */
  monogram: string;
  color: string;
};

/**
 * Colours are each vendor's own accent where that is well established, and the
 * app's neutral ink where it is not — several of these marks are black anyway,
 * and a guessed brand colour looks worse than a deliberate neutral one.
 */
const INK = "#2a2c2f";

export const BRANDS: Record<BrandId, Brand> = {
  grok:      { id: "grok",      label: "Grok",      monogram: "G",  color: INK },
  openai:    { id: "openai",    label: "OpenAI",    monogram: "AI", color: "#10a37f" },
  anthropic: { id: "anthropic", label: "Claude",    monogram: "C",  color: "#d97757" },
  deepseek:  { id: "deepseek",  label: "DeepSeek",  monogram: "DS", color: "#4d6bfe" },
  kimi:      { id: "kimi",      label: "Kimi",      monogram: "K",  color: INK },
  glm:       { id: "glm",       label: "GLM",       monogram: "GL", color: INK },
  minimax:   { id: "minimax",   label: "MiniMax",   monogram: "M",  color: INK },
  qwen:      { id: "qwen",      label: "Qwen",      monogram: "Q",  color: "#615ced" },
  gemini:    { id: "gemini",    label: "Gemini",    monogram: "GM", color: "#4285f4" },
  llama:     { id: "llama",     label: "Llama",     monogram: "L",  color: "#0866ff" },
  mistral:   { id: "mistral",   label: "Mistral",   monogram: "MI", color: "#fa520f" },
  ollama:    { id: "ollama",    label: "Ollama",    monogram: "OL", color: INK },
  openrouter:{ id: "openrouter",label: "OpenRouter",monogram: "OR", color: INK },
  generic:   { id: "generic",   label: "Model",     monogram: "•",  color: "#6b7280" },
};

/**
 * Ordered patterns — the first hit wins, so more specific vendors come before
 * families that share a substring.
 */
const PATTERNS: Array<[BrandId, RegExp]> = [
  ["grok", /\bgrok\b|xai/],
  ["deepseek", /deepseek/],
  ["kimi", /kimi|moonshot/],
  ["glm", /\bglm\b|zhipu|bigmodel|chatglm/],
  ["minimax", /minimax|abab/],
  ["qwen", /qwen|tongyi|dashscope/],
  ["gemini", /gemini|palm/],
  // Ollama must precede Llama: "ollama" contains "llama".
  ["ollama", /ollama/],
  ["llama", /llama/],
  ["mistral", /mistral|mixtral|codestral/],
  ["openrouter", /openrouter/],
  ["anthropic", /claude|anthropic|sonnet|opus|haiku/],
  ["openai", /openai|chatgpt|\bgpt\b|gpt-|codex|\bo[134]\b|davinci/],
];

export function detectBrand(modelId: string, name?: string): Brand {
  const haystack = `${modelId} ${name ?? ""}`.toLowerCase();
  for (const [id, pattern] of PATTERNS) {
    if (pattern.test(haystack)) return BRANDS[id];
  }
  return BRANDS.generic;
}
