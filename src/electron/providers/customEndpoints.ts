/**
 * User-added model endpoints: a vendor API or a relay gateway that fronts many
 * vendors behind one OpenAI-compatible base URL.
 *
 * Endpoint metadata is plain JSON so the settings UI can render it. API keys
 * are encrypted through the shared vault and never written to the agent's
 * `config.toml` — the generated model entries reference an environment variable
 * that is injected when the agent is spawned.
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ManagedModel } from "./customModels.js";
import type { SecretVault } from "./tokenStore.js";

export type ApiBackend = "chat_completions" | "responses" | "messages";

export type CustomModel = {
  /** Identifier sent upstream, e.g. `deepseek-chat`. */
  id: string;
  label: string;
  contextWindow: number;
  maxCompletionTokens?: number;
};

/** Effort levels offered when an endpoint opts into reasoning effort. */
export const REASONING_EFFORTS = ["high", "medium", "low"] as const;

export type CustomEndpoint = {
  id: string;
  label: string;
  baseUrl: string;
  apiBackend: ApiBackend;
  /** Preset this was created from, for re-editing. */
  presetId: string;
  models: CustomModel[];
  /** True when a key is stored; the key itself never leaves the main process. */
  hasApiKey: boolean;
  /**
   * Whether this endpoint accepts a `reasoning_effort` field. Opt-in: providers
   * that reject unknown request fields would fail on every prompt.
   */
  supportsReasoningEffort: boolean;
};

export type CustomEndpointInput = {
  id?: string;
  label: string;
  baseUrl: string;
  apiBackend: ApiBackend;
  presetId: string;
  models: CustomModel[];
  /** Omit to keep the stored key; empty string clears it. */
  apiKey?: string;
  supportsReasoningEffort?: boolean;
};

const ENDPOINTS_FILE = "custom-endpoints.json";
const KEYS_FILE = "custom-endpoint-keys.bin";

export const DEFAULT_CONTEXT_WINDOW = 128_000;

/** Environment variable the agent reads a given endpoint's key from. */
export function endpointEnvKey(endpointId: string): string {
  return `GROKGUI_ENDPOINT_${endpointId.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()}`;
}

/** `[model.<key>]` section name for a custom model. */
export function customModelConfigKey(modelId: string): string {
  return `custom-${modelId.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase().replace(/^-|-$/g, "")}`;
}

export function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

function writeFileAtomic(file: string, data: Buffer): void {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export class CustomEndpointStore {
  private readonly dir: string;
  private readonly vault: SecretVault;

  constructor(options: { dir: string; vault: SecretVault }) {
    this.dir = options.dir;
    this.vault = options.vault;
  }

  private endpointsPath(): string {
    return path.join(this.dir, ENDPOINTS_FILE);
  }

  private keysPath(): string {
    return path.join(this.dir, KEYS_FILE);
  }

  list(): CustomEndpoint[] {
    try {
      const parsed: unknown = JSON.parse(
        fs.readFileSync(this.endpointsPath(), "utf8"),
      );
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isEndpoint);
    } catch {
      return [];
    }
  }

  private writeEndpoints(endpoints: CustomEndpoint[]): void {
    fs.mkdirSync(this.dir, { recursive: true });
    writeFileAtomic(
      this.endpointsPath(),
      Buffer.from(`${JSON.stringify(endpoints, null, 2)}\n`, "utf8"),
    );
  }

  private readKeys(): Record<string, string> {
    try {
      const payload = fs.readFileSync(this.keysPath());
      const parsed: unknown = JSON.parse(this.vault.decrypt(payload));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {};
      }
      return parsed as Record<string, string>;
    } catch {
      return {};
    }
  }

  private writeKeys(keys: Record<string, string>): void {
    fs.mkdirSync(this.dir, { recursive: true });
    writeFileAtomic(this.keysPath(), this.vault.encrypt(JSON.stringify(keys)));
  }

  getApiKey(endpointId: string): string | null {
    return this.readKeys()[endpointId] ?? null;
  }

  /** Create or replace an endpoint, returning its stored form. */
  upsert(input: CustomEndpointInput): CustomEndpoint {
    const id = input.id ?? randomUUID();
    const keys = this.readKeys();
    if (input.apiKey !== undefined) {
      if (input.apiKey) keys[id] = input.apiKey;
      else delete keys[id];
      this.writeKeys(keys);
    }

    const endpoint: CustomEndpoint = {
      id,
      label: input.label.trim() || input.baseUrl,
      baseUrl: normalizeBaseUrl(input.baseUrl),
      apiBackend: input.apiBackend,
      presetId: input.presetId,
      models: input.models.map((model) => ({
        id: model.id.trim(),
        label: model.label.trim() || model.id.trim(),
        contextWindow: model.contextWindow || DEFAULT_CONTEXT_WINDOW,
        ...(model.maxCompletionTokens
          ? { maxCompletionTokens: model.maxCompletionTokens }
          : {}),
      })),
      hasApiKey: Boolean(keys[id]),
      supportsReasoningEffort: input.supportsReasoningEffort === true,
    };

    const endpoints = this.list();
    const index = endpoints.findIndex((existing) => existing.id === id);
    if (index >= 0) endpoints[index] = endpoint;
    else endpoints.push(endpoint);
    this.writeEndpoints(endpoints);
    return endpoint;
  }

  remove(endpointId: string): void {
    this.writeEndpoints(this.list().filter((e) => e.id !== endpointId));
    const keys = this.readKeys();
    if (endpointId in keys) {
      delete keys[endpointId];
      this.writeKeys(keys);
    }
  }

  /**
   * Model entries for the agent's config. Keys are deduplicated across
   * endpoints: two gateways may well both expose `deepseek-chat`.
   */
  managedModels(): ManagedModel[] {
    const used = new Set<string>();
    const managed: ManagedModel[] = [];

    for (const endpoint of this.list()) {
      for (const model of endpoint.models) {
        let key = customModelConfigKey(model.id);
        if (used.has(key)) {
          key = `${key}-${endpoint.id.slice(0, 4)}`;
          if (used.has(key)) continue;
        }
        used.add(key);
        managed.push({
          key,
          model: model.id,
          name: model.label,
          baseUrl: endpoint.baseUrl,
          envKey: endpointEnvKey(endpoint.id),
          apiBackend: endpoint.apiBackend,
          contextWindow: model.contextWindow,
          ...(model.maxCompletionTokens
            ? { maxCompletionTokens: model.maxCompletionTokens }
            : {}),
          ...(endpoint.supportsReasoningEffort
            ? { reasoningEfforts: REASONING_EFFORTS }
            : {}),
        });
      }
    }
    return managed;
  }

  /** Credentials to inject into the agent process environment. */
  environment(): Record<string, string> {
    const keys = this.readKeys();
    const env: Record<string, string> = {};
    for (const endpoint of this.list()) {
      const key = keys[endpoint.id];
      if (key) env[endpointEnvKey(endpoint.id)] = key;
    }
    return env;
  }
}

function isEndpoint(value: unknown): value is CustomEndpoint {
  if (!value || typeof value !== "object") return false;
  const e = value as Partial<CustomEndpoint>;
  return (
    typeof e.id === "string" &&
    typeof e.label === "string" &&
    typeof e.baseUrl === "string" &&
    Array.isArray(e.models)
  );
}
