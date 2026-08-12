/**
 * Models exposed through a ChatGPT subscription.
 *
 * The Codex backend has no discovery endpoint, so this table is maintained by
 * hand. Availability depends on the signed-in plan — an entry the account
 * cannot use simply fails at request time with the upstream error.
 */

export type ChatGptModel = {
  /** Identifier sent upstream. */
  id: string;
  /** Name shown in the model picker. */
  label: string;
  contextWindow: number;
  maxOutputTokens: number;
  reasoningEfforts: readonly string[];
  defaultReasoningEffort: string;
};

export const CHATGPT_MODELS: ChatGptModel[] = [
  {
    id: "gpt-5.6-sol",
    label: "5.6 Sol",
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    defaultReasoningEffort: "high",
  },
  {
    id: "gpt-5.6-terra",
    label: "5.6 Terra",
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    defaultReasoningEffort: "high",
  },
  {
    id: "gpt-5.6-luna",
    label: "5.6 Luna",
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    defaultReasoningEffort: "high",
  },
  {
    id: "gpt-5.5",
    label: "5.5",
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    defaultReasoningEffort: "high",
  },
  {
    id: "gpt-5.2",
    label: "5.2",
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    defaultReasoningEffort: "high",
  },
];

/** Stable config key for a model, used as the `[model.<id>]` section name. */
export function modelConfigKey(modelId: string): string {
  return `chatgpt-${modelId.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}`;
}
