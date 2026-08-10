/**
 * Electron-facing wiring for the ChatGPT subscription provider.
 *
 * Owns the singletons the rest of the main process talks to: the encrypted
 * token store, the loopback relay, and the managed block in the agent's
 * `config.toml`. Everything below this module is pure and unit-tested.
 */

import path from "node:path";
import { app, safeStorage, shell } from "electron";
import { CHATGPT_MODELS, modelConfigKey } from "./chatgptModels.js";
import type { ManagedModel } from "./customModels.js";
import {
  OAuthError,
  formatPlanLabel,
  planSupportsCodex,
  readIdentity,
  refreshAccessToken,
  startLogin,
  type LoginHandle,
} from "./openaiOauth.js";
import { startRelayProxy, type RelayProxy } from "./relayProxy.js";
import {
  ChatGptTokenStore,
  plaintextVault,
  type SecretVault,
} from "./tokenStore.js";
import type { NormalizedUsage, ProviderAccount, UsageWindow } from "./types.js";

export type ChatGptStatus = {
  account: ProviderAccount | null;
  planLabel: string;
  /** False when the OS keychain is unavailable and tokens sit in a 0600 file. */
  encryptedAtRest: boolean;
  relayPort: number | null;
  /**
   * Plan label of a sign-in that was rejected (or signed out again) because it
   * cannot use Codex models. Keeping such an account would register models that
   * always fail, which just looks like the picker reverting on its own.
   */
  rejectedPlanLabel: string | null;
};

export type ChatGptActionResult = {
  ok: boolean;
  status: ChatGptStatus;
  error?: string;
};

let store: ChatGptTokenStore | null = null;
let relay: RelayProxy | null = null;
let activeLogin: LoginHandle | null = null;
let vaultEncrypted = false;
let latestUsage: { windows: UsageWindow[]; fetchedAt: number } | null = null;
let onUsageChanged: (() => void) | null = null;
let rejectedPlanLabel: string | null = null;

function createVault(): SecretVault {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      vaultEncrypted = true;
      return {
        encrypted: true,
        encrypt: (plain) => safeStorage.encryptString(plain),
        decrypt: (payload) => safeStorage.decryptString(payload),
      };
    }
  } catch {
    // Fall through to the plaintext vault below.
  }
  vaultEncrypted = false;
  return plaintextVault;
}

function getStore(): ChatGptTokenStore {
  if (!store) {
    store = new ChatGptTokenStore({
      dir: path.join(app.getPath("userData"), "providers"),
      vault: createVault(),
      refresh: (previous) => refreshAccessToken(previous),
    });
  }
  return store;
}

/** Register a callback fired whenever fresh plan usage is observed. */
export function onChatGptUsage(listener: (() => void) | null): void {
  onUsageChanged = listener;
}

function managedModels(proxy: RelayProxy): ManagedModel[] {
  return CHATGPT_MODELS.map((model) => ({
    key: modelConfigKey(model.id),
    model: model.id,
    name: model.label,
    baseUrl: proxy.baseUrl,
    apiKey: proxy.token,
    apiBackend: "responses" as const,
    contextWindow: model.contextWindow,
    maxCompletionTokens: model.maxOutputTokens,
  }));
}

async function startRelay(): Promise<RelayProxy> {
  const current = getStore();
  const proxy = await startRelayProxy({
    getAccessToken: () => current.getAccessToken(),
    refreshAccessToken: () => current.refreshNow(),
    getAccountId: () => current.getAccount()?.accountId ?? null,
    onUsage: (windows) => {
      latestUsage = { windows, fetchedAt: Date.now() };
      onUsageChanged?.();
    },
  });
  return proxy;
}

async function stopRelay(): Promise<void> {
  const current = relay;
  relay = null;
  if (current) await current.close();
}

/**
 * Bring the relay and the agent's managed model entries in line with the
 * current sign-in state. Safe to call repeatedly; must run before the agent is
 * spawned because the relay port and token change on every launch.
 */
/**
 * Bring the relay in line with the sign-in state and return the model entries
 * the agent should get. Writing them out belongs to `modelSync`, which merges
 * these with user-added endpoints into one managed config block.
 */
export async function ensureChatGptModels(): Promise<ManagedModel[]> {
  purgeIneligibleAccount();
  if (!getStore().hasAccount()) {
    await stopRelay();
    return [];
  }
  if (!relay) relay = await startRelay();
  return managedModels(relay);
}

/**
 * Sign out an account whose plan cannot use Codex. Reached only by credentials
 * stored before the plan was checked at sign-in, or if a plan is downgraded.
 */
function purgeIneligibleAccount(): void {
  const account = getStore().getAccount();
  if (!account || planSupportsCodex(account.planType)) return;
  rejectedPlanLabel = formatPlanLabel(account.planType);
  getStore().clear();
  latestUsage = null;
}

export function getChatGptStatus(): ChatGptStatus {
  purgeIneligibleAccount();
  const current = getStore();
  const account = current.getAccount();
  return {
    account,
    planLabel: account ? current.planLabel() : "Not signed in",
    encryptedAtRest: vaultEncrypted,
    relayPort: relay?.port ?? null,
    rejectedPlanLabel,
  };
}

function failure(error: string): ChatGptActionResult {
  return { ok: false, status: getChatGptStatus(), error };
}

export async function loginToChatGpt(): Promise<ChatGptActionResult> {
  if (activeLogin) {
    return failure("A ChatGPT sign-in is already in progress.");
  }
  const handle = startLogin({
    openExternal: (url) => shell.openExternal(url),
  });
  activeLogin = handle;
  try {
    const tokens = await handle.completed;
    const identity = readIdentity(tokens);
    if (!planSupportsCodex(identity.planType)) {
      // Never persist credentials for an account that cannot use the models —
      // signing the user straight back out is clearer than a dead sign-in.
      rejectedPlanLabel = formatPlanLabel(identity.planType);
      return failure(
        `${rejectedPlanLabel} does not include Codex model access.`,
      );
    }
    rejectedPlanLabel = null;
    getStore().save(tokens);
    latestUsage = null;
    // Rebuild the relay so the new account owns it; the caller then syncs the
    // agent's config, which is what actually publishes the models.
    await stopRelay();
    await ensureChatGptModels();
    return { ok: true, status: getChatGptStatus() };
  } catch (error) {
    if (error instanceof OAuthError) return failure(error.message);
    return failure(error instanceof Error ? error.message : String(error));
  } finally {
    if (activeLogin === handle) activeLogin = null;
  }
}

export function cancelChatGptLogin(): boolean {
  if (!activeLogin) return false;
  activeLogin.cancel();
  return true;
}

export async function logoutFromChatGpt(): Promise<ChatGptActionResult> {
  if (activeLogin) {
    return failure("Cancel the current sign-in before signing out.");
  }
  try {
    getStore().clear();
    latestUsage = null;
    rejectedPlanLabel = null;
    await stopRelay();
    return { ok: true, status: getChatGptStatus() };
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Plan usage as last reported by the upstream. There is no standalone usage
 * endpoint for a ChatGPT subscription — the limits ride on inference responses,
 * so this stays empty until the first request goes out.
 */
export function getChatGptUsage(): NormalizedUsage {
  const status = getChatGptStatus();
  if (!status.account) {
    return {
      provider: "openai",
      ok: false,
      planLabel: status.planLabel,
      windows: [],
      fetchedAt: Date.now(),
      error: "No ChatGPT account is signed in.",
    };
  }
  if (status.account.needsRelogin) {
    return {
      provider: "openai",
      ok: false,
      planLabel: status.planLabel,
      windows: [],
      fetchedAt: Date.now(),
      error: "The ChatGPT session expired. Please sign in again.",
    };
  }
  if (!latestUsage) {
    return {
      provider: "openai",
      ok: false,
      planLabel: status.planLabel,
      windows: [],
      fetchedAt: Date.now(),
      error: "Plan usage appears after the first message on a ChatGPT model.",
    };
  }
  return {
    provider: "openai",
    ok: true,
    planLabel: status.planLabel,
    windows: latestUsage.windows,
    fetchedAt: latestUsage.fetchedAt,
  };
}

export async function shutdownChatGptProvider(): Promise<void> {
  activeLogin?.cancel();
  activeLogin = null;
  await stopRelay();
}
