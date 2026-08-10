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
};

export const CHATGPT_MODELS: ChatGptModel[] = [
  {
    id: "gpt-5.3-codex",
    label: "GPT-5.3 Codex (ChatGPT)",
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
  },
  {
    id: "gpt-5.3-codex-mini",
    label: "GPT-5.3 Codex mini (ChatGPT)",
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
  },
  {
    id: "gpt-5.2-codex",
    label: "GPT-5.2 Codex (ChatGPT)",
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
  },
];

/** Stable config key for a model, used as the `[model.<id>]` section name. */
export function modelConfigKey(modelId: string): string {
  return `chatgpt-${modelId.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}`;
}
