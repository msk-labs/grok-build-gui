import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CustomEndpointStore,
  customModelConfigKey,
  endpointEnvKey,
  normalizeBaseUrl,
} from "./customEndpoints";
import { plaintextVault, type SecretVault } from "./tokenStore";

const dirs: string[] = [];

function store(vault: SecretVault = plaintextVault): CustomEndpointStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-gui-endpoints-"));
  dirs.push(dir);
  return new CustomEndpointStore({ dir, vault });
}

afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});

const relay = {
  label: "My relay",
  baseUrl: "https://relay.example.com/v1",
  apiBackend: "chat_completions" as const,
  presetId: "custom",
  apiKey: "sk-relay-secret",
  models: [
    { id: "deepseek-chat", label: "DeepSeek V4", contextWindow: 128_000 },
    { id: "glm-5.2", label: "GLM-5.2", contextWindow: 200_000 },
  ],
};

describe("helpers", () => {
  it("builds stable config keys and env names", () => {
    expect(customModelConfigKey("deepseek-chat")).toBe("custom-deepseek-chat");
    expect(customModelConfigKey("meta/llama-3.1:70b")).toBe(
      "custom-meta-llama-3-1-70b",
    );
    expect(endpointEnvKey("a1b2-c3")).toBe("GROKGUI_ENDPOINT_A1B2C3");
  });

  it("trims trailing slashes from the base URL", () => {
    expect(normalizeBaseUrl(" https://x.example/v1/ ")).toBe(
      "https://x.example/v1",
    );
  });
});

describe("CustomEndpointStore", () => {
  it("starts empty", () => {
    expect(store().list()).toEqual([]);
  });

  it("saves an endpoint without exposing its key", () => {
    const s = store();
    const saved = s.upsert(relay);

    expect(saved.id).toBeTruthy();
    expect(saved.hasApiKey).toBe(true);
    expect(saved).not.toHaveProperty("apiKey");
    expect(s.getApiKey(saved.id)).toBe("sk-relay-secret");
    expect(s.list()).toHaveLength(1);
  });

  it("keeps the stored key when an edit omits it", () => {
    const s = store();
    const saved = s.upsert(relay);

    s.upsert({ ...relay, id: saved.id, label: "Renamed", apiKey: undefined });

    expect(s.list()[0]!.label).toBe("Renamed");
    expect(s.getApiKey(saved.id)).toBe("sk-relay-secret");
  });

  it("clears the key when an edit passes an empty string", () => {
    const s = store();
    const saved = s.upsert(relay);

    s.upsert({ ...relay, id: saved.id, apiKey: "" });

    expect(s.getApiKey(saved.id)).toBeNull();
    expect(s.list()[0]!.hasApiKey).toBe(false);
  });

  it("encrypts keys at rest", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-gui-endpoints-"));
    dirs.push(dir);
    const vault: SecretVault = {
      encrypted: true,
      encrypt: (plain) => Buffer.from(plain, "utf8").reverse(),
      decrypt: (payload) => Buffer.from(payload).reverse().toString("utf8"),
    };
    const s = new CustomEndpointStore({ dir, vault });
    s.upsert(relay);

    const onDisk = fs.readFileSync(
      path.join(dir, "custom-endpoint-keys.bin"),
      "utf8",
    );
    expect(onDisk).not.toContain("sk-relay-secret");
    // Metadata stays readable so the settings list can render it.
    expect(
      fs.readFileSync(path.join(dir, "custom-endpoints.json"), "utf8"),
    ).toContain("relay.example.com");
  });

  it("removes an endpoint and its key", () => {
    const s = store();
    const saved = s.upsert(relay);

    s.remove(saved.id);

    expect(s.list()).toEqual([]);
    expect(s.getApiKey(saved.id)).toBeNull();
  });

  it("generates model entries that reference the key by environment", () => {
    const s = store();
    const saved = s.upsert(relay);
    const models = s.managedModels();

    expect(models).toHaveLength(2);
    expect(models[0]).toMatchObject({
      key: "custom-deepseek-chat",
      model: "deepseek-chat",
      name: "DeepSeek V4",
      baseUrl: "https://relay.example.com/v1",
      envKey: endpointEnvKey(saved.id),
      apiBackend: "chat_completions",
      contextWindow: 128_000,
    });
    // The secret must never appear in something written to config.toml.
    expect(JSON.stringify(models)).not.toContain("sk-relay-secret");
  });

  it("leaves reasoning effort off unless the endpoint opts in", () => {
    // A provider that rejects unknown request fields would fail every prompt,
    // so this must never be enabled by default.
    const s = store();
    s.upsert(relay);

    expect(s.list()[0]!.supportsReasoningEffort).toBe(false);
    expect(s.managedModels()[0]).not.toHaveProperty("reasoningEfforts");
  });

  it("lets verified model metadata override the endpoint fallback", () => {
    const s = store();
    s.upsert({
      ...relay,
      supportsReasoningEffort: true,
      models: [
        {
          ...relay.models[0],
          supportsReasoningEffort: true,
          reasoningEfforts: ["low", "high", "max"],
          defaultReasoningEffort: "high",
        },
        {
          ...relay.models[1],
          supportsReasoningEffort: false,
        },
        {
          id: "relay-unknown",
          label: "Relay unknown",
          contextWindow: 64_000,
        },
      ],
    });

    const saved = s.list()[0]!;
    expect(saved.models[0]).toMatchObject({
      supportsReasoningEffort: true,
      reasoningEfforts: ["low", "high", "max"],
      defaultReasoningEffort: "high",
    });
    expect(saved.models[1]!.supportsReasoningEffort).toBe(false);

    const models = s.managedModels();
    expect(models[0]!.reasoningEfforts).toEqual(["low", "high", "max"]);
    expect(models[0]!.defaultReasoningEffort).toBe("high");
    expect(models[1]).not.toHaveProperty("reasoningEfforts");
    expect(models[2]!.reasoningEfforts).toEqual(["high", "medium", "low"]);
  });

  it("can turn reasoning effort back off", () => {
    const s = store();
    const saved = s.upsert({ ...relay, supportsReasoningEffort: true });

    s.upsert({ ...relay, id: saved.id, supportsReasoningEffort: false });

    expect(s.list()[0]!.supportsReasoningEffort).toBe(false);
    expect(s.managedModels()[0]).not.toHaveProperty("reasoningEfforts");
  });

  it("disambiguates the same model served by two endpoints", () => {
    const s = store();
    s.upsert(relay);
    s.upsert({ ...relay, label: "Second relay", apiKey: "sk-other" });

    const keys = s.managedModels().map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("custom-deepseek-chat");
  });

  it("exposes keys for the agent environment", () => {
    const s = store();
    const saved = s.upsert(relay);

    expect(s.environment()).toEqual({
      [endpointEnvKey(saved.id)]: "sk-relay-secret",
    });
  });

  it("omits endpoints that have no key from the environment", () => {
    const s = store();
    s.upsert({ ...relay, apiKey: "" });
    expect(s.environment()).toEqual({});
  });

  it("survives a corrupted metadata file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-gui-endpoints-"));
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, "custom-endpoints.json"), "{not json");
    const s = new CustomEndpointStore({ dir, vault: plaintextVault });

    expect(s.list()).toEqual([]);
    expect(() => s.upsert(relay)).not.toThrow();
  });
});
