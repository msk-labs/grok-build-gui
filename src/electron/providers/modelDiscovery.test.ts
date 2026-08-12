import { describe, expect, it, vi } from "vitest";
import { discoverModels, parseModelList } from "./modelDiscovery";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("parseModelList", () => {
  it("reads the OpenAI list shape", () => {
    expect(
      parseModelList({
        object: "list",
        data: [{ id: "gpt-4o" }, { id: "deepseek-chat" }],
      }),
    ).toEqual([
      { id: "deepseek-chat", contextWindow: null },
      { id: "gpt-4o", contextWindow: null },
    ]);
  });

  it("accepts gateway variations", () => {
    // Some relays return `models`, a bare array, or plain strings.
    expect(parseModelList({ models: [{ id: "a" }] })).toHaveLength(1);
    expect(parseModelList([{ name: "b" }])).toEqual([
      { id: "b", contextWindow: null },
    ]);
    expect(parseModelList(["c"])).toEqual([{ id: "c", contextWindow: null }]);
  });

  it("picks up an advertised context window", () => {
    expect(
      parseModelList({ data: [{ id: "a", context_length: 200_000 }] })[0],
    ).toEqual({ id: "a", contextWindow: 200_000 });
  });

  it("reads OpenRouter reasoning metadata", () => {
    expect(
      parseModelList({
        data: [
          {
            id: "vendor/model",
            supported_parameters: ["temperature", "reasoning_effort"],
            reasoning: {
              supported_efforts: ["high", "none"],
              default_effort: "high",
            },
          },
        ],
      }),
    ).toEqual([
      {
        id: "vendor/model",
        contextWindow: null,
        supportedParameters: ["temperature", "reasoning_effort"],
        advertisedReasoningEfforts: ["high", "none"],
        advertisedDefaultReasoningEffort: "high",
      },
    ]);
  });

  it("drops duplicates and unusable rows", () => {
    expect(
      parseModelList({ data: [{ id: "a" }, { id: "a" }, {}, { id: "  " }, 5] }),
    ).toEqual([{ id: "a", contextWindow: null }]);
  });

  it("returns nothing for a non-list payload", () => {
    expect(parseModelList({ error: "nope" })).toEqual([]);
    expect(parseModelList(null)).toEqual([]);
  });
});

describe("discoverModels", () => {
  const endpoint = {
    baseUrl: "https://relay.example.com/v1/",
    apiKey: "sk-1",
    apiBackend: "chat_completions" as const,
  };

  it("calls /models with a bearer token", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: [{ id: "a" }] }));

    const result = await discoverModels(
      endpoint,
      fetchImpl as unknown as typeof fetch,
    );

    expect(result).toEqual({
      ok: true,
      models: [{ id: "a", contextWindow: null }],
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://relay.example.com/v1/models");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer sk-1",
    );
  });

  it("enriches discovered models with provider-specific reasoning metadata", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: [{ id: "deepseek-v4-flash" }] }),
    );

    const result = await discoverModels(
      { ...endpoint, presetId: "deepseek" },
      fetchImpl as unknown as typeof fetch,
    );

    expect(result).toEqual({
      ok: true,
      models: [
        {
          id: "deepseek-v4-flash",
          contextWindow: null,
          supportsReasoningEffort: true,
          reasoningEfforts: ["low", "high", "max"],
          defaultReasoningEffort: "high",
        },
      ],
    });
  });

  it("uses x-api-key for Anthropic-style endpoints", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: [{ id: "a" }] }));

    await discoverModels(
      { ...endpoint, apiBackend: "messages" },
      fetchImpl as unknown as typeof fetch,
    );

    const headers = (
      fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    )[1].headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-1");
    expect(headers.Authorization).toBeUndefined();
  });

  it("explains a rejected key", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 401));
    await expect(
      discoverModels(endpoint, fetchImpl as unknown as typeof fetch),
    ).resolves.toEqual({
      ok: false,
      error: "The endpoint rejected this API key.",
    });
  });

  it("suggests the /v1 suffix on a 404", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 404));
    const result = await discoverModels(
      endpoint,
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("/v1");
  });

  it("reports an unreachable host", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    });
    const result = await discoverModels(
      endpoint,
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("Could not reach");
  });

  it("rejects an empty catalog rather than saving nothing", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: [] }));
    const result = await discoverModels(
      endpoint,
      fetchImpl as unknown as typeof fetch,
    );
    expect(result).toEqual({
      ok: false,
      error: "The endpoint listed no models.",
    });
  });

  it("requires a URL", async () => {
    const fetchImpl = vi.fn();
    const result = await discoverModels(
      { ...endpoint, baseUrl: "  " },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
