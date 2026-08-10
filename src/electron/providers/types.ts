/**
 * Shared provider vocabulary.
 *
 * A "provider" is an upstream model vendor the GUI can sign into. Grok remains
 * the bundled agent; additional providers reach their models through the local
 * relay proxy, so the agent only ever sees an OpenAI-compatible endpoint.
 */

export type ProviderId = "openai";

export type ProviderAuthMode = "oauth";

/** Non-secret account metadata. Safe to send to the renderer. */
export type ProviderAccount = {
  provider: ProviderId;
  authMode: ProviderAuthMode;
  email: string | null;
  /** ChatGPT workspace/account the subscription belongs to. */
  accountId: string | null;
  /** Subscription tier claim, e.g. "plus" / "pro" / "team". */
  planType: string | null;
  /** ISO timestamp of the last successful token refresh. */
  lastRefresh: string | null;
  /** True once a refresh was rejected; the user must sign in again. */
  needsRelogin: boolean;
};

/** OAuth material. Stays in the main process, encrypted at rest. */
export type TokenSet = {
  accessToken: string;
  refreshToken: string;
  idToken: string | null;
};

/**
 * One quota window of a subscription plan (e.g. a 5-hour or weekly limit),
 * normalized so every provider renders through the same UI.
 */
export type UsageWindow = {
  id: string;
  label: string;
  usedPercent: number | null;
  /** ISO timestamp when the window resets, when the upstream reports it. */
  resetsAt: string | null;
};

export type NormalizedUsage = {
  provider: ProviderId;
  ok: boolean;
  planLabel: string;
  windows: UsageWindow[];
  fetchedAt: number;
  error?: string;
};
