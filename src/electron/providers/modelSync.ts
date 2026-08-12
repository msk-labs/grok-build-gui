/**
 * Single owner of the agent's managed model configuration.
 *
 * Two sources feed it — subscription models behind the local relay, and
 * user-added endpoints — and they share one marker-delimited block in
 * `config.toml`. Writing must therefore go through here: if each source wrote
 * its own entries, whichever ran last would erase the other's.
 */

import path from "node:path";
import { app } from "electron";
import { safeStorage } from "electron";
import { ensureChatGptModels } from "./chatgptProvider.js";
import {
  CustomEndpointStore,
  type CustomEndpoint,
  type CustomEndpointInput,
} from "./customEndpoints.js";
import { syncManagedModels } from "./customModels.js";
import {
  discoverModels,
  type DiscoveryResult,
} from "./modelDiscovery.js";
import { plaintextVault, type SecretVault } from "./tokenStore.js";

let endpointStore: CustomEndpointStore | null = null;

function createVault(): SecretVault {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return {
        encrypted: true,
        encrypt: (plain) => safeStorage.encryptString(plain),
        decrypt: (payload) => safeStorage.decryptString(payload),
      };
    }
  } catch {
    // Fall through to the plaintext vault below.
  }
  return plaintextVault;
}

function getEndpointStore(): CustomEndpointStore {
  if (!endpointStore) {
    endpointStore = new CustomEndpointStore({
      dir: path.join(app.getPath("userData"), "providers"),
      vault: createVault(),
    });
  }
  return endpointStore;
}

/**
 * Rewrite the managed block from both sources. Must run before the agent is
 * spawned: the relay's port and token change on every launch.
 */
export async function syncManagedModelConfig(): Promise<void> {
  const subscription = await ensureChatGptModels();
  syncManagedModels([...subscription, ...getEndpointStore().managedModels()]);
}

/**
 * Credentials for the agent process. Vendor keys travel in the environment so
 * they never reach `config.toml`, which users copy and share.
 */
export function managedModelEnvironment(): Record<string, string> {
  return getEndpointStore().environment();
}

export function listEndpoints(): CustomEndpoint[] {
  return getEndpointStore().list();
}

export async function saveEndpoint(
  input: CustomEndpointInput,
): Promise<{ ok: true; endpoint: CustomEndpoint } | { ok: false; error: string }> {
  if (!input.baseUrl.trim()) {
    return { ok: false, error: "An endpoint URL is required." };
  }
  try {
    const endpoint = getEndpointStore().upsert(input);
    await syncManagedModelConfig();
    return { ok: true, endpoint };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function removeEndpoint(endpointId: string): Promise<void> {
  getEndpointStore().remove(endpointId);
  await syncManagedModelConfig();
}

/**
 * Probe an endpoint's catalog. A saved endpoint may omit the key to reuse the
 * stored one, so the form never has to round-trip a secret.
 */
export function discoverEndpointModels(options: {
  endpointId?: string;
  baseUrl: string;
  apiKey?: string;
  apiBackend: CustomEndpointInput["apiBackend"];
  presetId?: string;
}): Promise<DiscoveryResult> {
  const stored = options.endpointId
    ? getEndpointStore().getApiKey(options.endpointId)
    : null;
  return discoverModels({
    baseUrl: options.baseUrl,
    apiKey: options.apiKey ?? stored ?? "",
    apiBackend: options.apiBackend,
    presetId: options.presetId,
  });
}
