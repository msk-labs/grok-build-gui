/**
 * Starting points for the "add endpoint" form.
 *
 * A preset only fills in the fields a user would otherwise copy from vendor
 * docs; anything can still be edited afterwards. Relay gateways (one-api,
 * new-api, sub2api, …) use the "custom" entry — they expose one OpenAI-shaped
 * base URL for many vendors, which is exactly what this form models.
 */

export type EndpointPreset = {
  id: string;
  label: string;
  /** Empty for `custom`: the user supplies the URL. */
  baseUrl: string;
  apiBackend: "chat_completions" | "responses" | "messages";
  /** Where to get a key, shown as a link next to the field. */
  docsUrl?: string;
  /** Provider-specific headers the agent must send verbatim. */
  extraHeaders?: Record<string, string>;
};

export const ENDPOINT_PRESETS: EndpointPreset[] = [
  {
    id: "custom",
    label: "Custom / relay gateway",
    baseUrl: "",
    apiBackend: "chat_completions",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    apiBackend: "chat_completions",
    docsUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    id: "moonshot",
    label: "Moonshot / Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    apiBackend: "chat_completions",
    docsUrl: "https://platform.moonshot.cn/console/api-keys",
  },
  {
    id: "zhipu",
    label: "Zhipu GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    apiBackend: "chat_completions",
    docsUrl: "https://open.bigmodel.cn/usercenter/apikeys",
  },
  {
    id: "minimax",
    label: "MiniMax",
    baseUrl: "https://api.minimax.chat/v1",
    apiBackend: "chat_completions",
    docsUrl: "https://platform.minimaxi.com/user-center/basic-information",
  },
  {
    id: "dashscope",
    label: "Alibaba Qwen (DashScope)",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiBackend: "chat_completions",
    docsUrl: "https://bailian.console.aliyun.com/?tab=model#/api-key",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiBackend: "chat_completions",
    docsUrl: "https://openrouter.ai/keys",
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    apiBackend: "chat_completions",
    docsUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    apiBackend: "messages",
    docsUrl: "https://console.anthropic.com/settings/keys",
    // Anthropic authenticates with x-api-key, not a bearer token.
    extraHeaders: { "anthropic-version": "2023-06-01" },
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    baseUrl: "http://localhost:11434/v1",
    apiBackend: "chat_completions",
  },
];

export function findPreset(id: string): EndpointPreset | null {
  return ENDPOINT_PRESETS.find((preset) => preset.id === id) ?? null;
}
