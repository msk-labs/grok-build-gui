/**
 * Read local Grok Build login (~/.grok/auth.json) and fetch subscription usage.
 *
 * Auth: ~/.grok/auth.json (or $GROK_HOME/auth.json)
 * Usage: https://cli-chat-proxy.grok.com/v1/billing?format=credits
 *
 * Matches official Grok CLI /usage: weekly/monthly limit percent + next reset.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type GrokAccount = {
  loggedIn: boolean;
  email: string | null;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  userId: string | null;
  teamId: string | null;
  /** JWT `tier` claim when present (numeric or string). */
  tier: string | number | null;
  /** Human-readable plan label derived from tier / auth. */
  planLabel: string;
  profileImageUrl: string | null;
  authMode: string | null;
  expiresAt: string | null;
  error?: string;
};

export type GrokUsage = {
  ok: boolean;
  email: string | null;
  planLabel: string;
  tier: string | number | null;
  /** 0–100 credit usage for the current Grok Build period. */
  creditUsagePercent: number | null;
  periodType: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  productUsage: Array<{ product: string; usagePercent: number }>;
  prepaidBalance: number | null;
  onDemandCap: number | null;
  onDemandUsed: number | null;
  isUnifiedBillingUser: boolean;
  /** Monthly dollar amounts (from dollars endpoint), when available. */
  monthlyUsedCents: number | null;
  monthlyLimitCents: number | null;
  monthlyPeriodStart: string | null;
  monthlyPeriodEnd: string | null;
  fetchedAt: number;
  error?: string;
};

type GrokAuthEntry = {
  key?: string;
  auth_mode?: string;
  user_id?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  profile_image_asset_id?: string;
  team_id?: string;
  refresh_token?: string;
  expires_at?: string;
  oidc_issuer?: string;
  oidc_client_id?: string;
  principal_type?: string;
  principal_id?: string;
};

type BillingCreditsConfig = {
  currentPeriod?: {
    type?: string;
    start?: string;
    end?: string;
  };
  creditUsagePercent?: number;
  onDemandCap?: { val?: number };
  onDemandUsed?: { val?: number };
  productUsage?: Array<{ product?: string; usagePercent?: number }>;
  isUnifiedBillingUser?: boolean;
  prepaidBalance?: { val?: number };
  billingPeriodStart?: string;
  billingPeriodEnd?: string;
};

const BILLING_CREDITS_URL =
  "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
const ASSETS_BASE = "https://assets.grok.com";

function grokHome(): string {
  const fromEnv =
    process.env.GROK_HOME?.trim() || process.env.GROK_CONFIG_DIR?.trim();
  if (fromEnv) return fromEnv;
  return path.join(os.homedir(), ".grok");
}

function authPath(): string {
  return path.join(grokHome(), "auth.json");
}

/** Remove the local Grok credential cache after an explicit user sign-out. */
export function clearGrokAuthFile(): void {
  fs.rmSync(authPath(), { force: true });
}

/**
 * Bearer for xAI APIs (STT, etc.). Prefer env `XAI_API_KEY`, else `auth.json` key.
 * Does not refresh OIDC tokens — callers should surface re-login on 401.
 */
export function getGrokAccessToken(): string | null {
  const fromEnv = process.env.XAI_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const { entry } = readAuthFile();
  const key = entry?.key?.trim();
  return key || null;
}

function readAuthFile(): {
  entry: GrokAuthEntry | null;
  scope: string | null;
  error?: string;
} {
  const file = authPath();
  try {
    if (!fs.existsSync(file)) {
      return {
        entry: null,
        scope: null,
        error: "Grok is not signed in (missing ~/.grok/auth.json).",
      };
    }
    const raw = fs.readFileSync(file, "utf8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    // Prefer OIDC / accounts.x.ai scopes; fall back to first object entry.
    const keys = Object.keys(data);
    const preferred =
      keys.find((k) => k.includes("auth.x.ai")) ||
      keys.find((k) => k.includes("accounts.x.ai")) ||
      keys[0];
    if (!preferred) {
      return {
        entry: null,
        scope: null,
        error: "Grok auth.json has no credentials.",
      };
    }
    const entry = data[preferred];
    if (!entry || typeof entry !== "object") {
      return {
        entry: null,
        scope: preferred,
        error: "Grok auth.json entry is invalid.",
      };
    }
    return { entry: entry as GrokAuthEntry, scope: preferred };
  } catch (e) {
    return {
      entry: null,
      scope: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function decodeJwtPayload(
  token: string,
): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const b64 = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const pad = "=".repeat((4 - (b64.length % 4)) % 4);
    const json = Buffer.from(b64 + pad, "base64").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Map JWT tier / known subscription strings to a display label. */
export function formatGrokPlanLabel(
  tier: string | number | null | undefined,
): string {
  if (tier == null || tier === "") return "Unknown plan";

  if (typeof tier === "number" || /^\d+$/.test(String(tier))) {
    const n = Number(tier);
    // Observed JWT claim is numeric; common mapping in Grok Build:
    // 0 free, 1 SuperGrok-class, higher = heavier plans.
    if (n <= 0) return "Free";
    if (n === 1) return "SuperGrok";
    if (n === 2) return "SuperGrok Heavy";
    if (n === 3) return "SuperGrok Lite";
    return `Tier ${n}`;
  }

  const key = String(tier).toLowerCase().replace(/[\s-]+/g, "_");
  const map: Record<string, string> = {
    free: "Free",
    x_basic: "X Basic",
    x_premium: "X Premium",
    x_premium_plus: "X Premium+",
    supergrok: "SuperGrok",
    super_grok: "SuperGrok",
    supergrok_lite: "SuperGrok Lite",
    super_grok_lite: "SuperGrok Lite",
    supergrok_heavy: "SuperGrok Heavy",
    super_grok_heavy: "SuperGrok Heavy",
    api_key: "API Key",
    tier1: "SuperGrok",
    tier2: "SuperGrok Heavy",
    tier3: "SuperGrok Lite",
  };
  return (
    map[key] ??
    String(tier)
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

function profileImageUrl(assetId: string | null | undefined): string | null {
  if (!assetId || typeof assetId !== "string") return null;
  const id = assetId.replace(/^\/+/, "");
  return `${ASSETS_BASE}/${id}`;
}

function fullName(first: string | null, last: string | null): string | null {
  const parts = [first, last].map((s) => s?.trim()).filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

export function getGrokAccount(): GrokAccount {
  const { entry, error } = readAuthFile();
  if (!entry) {
    return {
      loggedIn: false,
      email: null,
      name: null,
      firstName: null,
      lastName: null,
      userId: null,
      teamId: null,
      tier: null,
      planLabel: "Not signed in",
      profileImageUrl: null,
      authMode: null,
      expiresAt: null,
      error,
    };
  }

  const access = entry.key?.trim() || null;
  if (!access) {
    return {
      loggedIn: false,
      email: entry.email ?? null,
      name: fullName(entry.first_name ?? null, entry.last_name ?? null),
      firstName: entry.first_name ?? null,
      lastName: entry.last_name ?? null,
      userId: entry.user_id ?? null,
      teamId: entry.team_id ?? null,
      tier: null,
      planLabel: "Not signed in",
      profileImageUrl: profileImageUrl(entry.profile_image_asset_id),
      authMode: entry.auth_mode ?? null,
      expiresAt: entry.expires_at ?? null,
      error: "Grok auth.json has no access token.",
    };
  }

  const payload = decodeJwtPayload(access);
  const tierClaim = payload?.tier;
  const tier =
    typeof tierClaim === "number" || typeof tierClaim === "string"
      ? tierClaim
      : null;

  return {
    loggedIn: true,
    email: entry.email ?? null,
    name: fullName(entry.first_name ?? null, entry.last_name ?? null),
    firstName: entry.first_name ?? null,
    lastName: entry.last_name ?? null,
    userId: entry.user_id ?? entry.principal_id ?? null,
    teamId: entry.team_id ?? null,
    tier,
    planLabel: formatGrokPlanLabel(tier),
    profileImageUrl: profileImageUrl(entry.profile_image_asset_id),
    authMode: entry.auth_mode ?? null,
    expiresAt: entry.expires_at ?? null,
  };
}

function numVal(v: { val?: number } | number | null | undefined): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "object" && typeof v.val === "number" && Number.isFinite(v.val)) {
    return v.val;
  }
  return null;
}

function emptyUsage(
  error: string,
  account: GrokAccount,
): GrokUsage {
  return {
    ok: false,
    email: account.email,
    planLabel: account.planLabel,
    tier: account.tier,
    creditUsagePercent: null,
    periodType: null,
    periodStart: null,
    periodEnd: null,
    productUsage: [],
    prepaidBalance: null,
    onDemandCap: null,
    onDemandUsed: null,
    isUnifiedBillingUser: false,
    monthlyUsedCents: null,
    monthlyLimitCents: null,
    monthlyPeriodStart: null,
    monthlyPeriodEnd: null,
    fetchedAt: Date.now(),
    error,
  };
}

async function fetchJson(
  url: string,
  token: string,
): Promise<{ ok: true; data: unknown } | { ok: false; status: number; hint: string }> {
  const resp = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": "GrokGUI/0.1 (Grok usage)",
      "x-grok-client-mode": "cli",
    },
  });
  if (!resp.ok) {
    const status = resp.status;
    let hint = `Billing request failed (${status}).`;
    if (status === 401 || status === 403) {
      hint = "Grok session expired or rejected. Run `grok login` to re-authenticate.";
    }
    return { ok: false, status, hint };
  }
  return { ok: true, data: await resp.json() };
}

export async function fetchGrokUsage(): Promise<GrokUsage> {
  const account = getGrokAccount();
  if (!account.loggedIn) {
    return emptyUsage(account.error || "Grok is not signed in.", account);
  }

  const { entry, error } = readAuthFile();
  const access = entry?.key?.trim();
  if (!access) {
    return emptyUsage(error || "Missing Grok access token.", account);
  }

  try {
    const creditsRes = await fetchJson(BILLING_CREDITS_URL, access);

    if (!creditsRes.ok) {
      return emptyUsage(creditsRes.hint, account);
    }

    const creditsRoot =
      creditsRes.data && typeof creditsRes.data === "object"
        ? (creditsRes.data as { config?: BillingCreditsConfig }).config ?? null
        : null;

    const creditUsagePercent =
      creditsRoot && typeof creditsRoot.creditUsagePercent === "number"
        ? Math.max(0, Math.min(100, creditsRoot.creditUsagePercent))
        : null;

    const productUsage = (creditsRoot?.productUsage ?? [])
      .filter((row) => row && typeof row.product === "string")
      .map((row) => ({
        product: row.product as string,
        usagePercent:
          typeof row.usagePercent === "number"
            ? Math.max(0, Math.min(100, row.usagePercent))
            : 0,
      }));

    const period = creditsRoot?.currentPeriod;
    // Keep raw period type (e.g. USAGE_PERIOD_TYPE_WEEKLY) for label matching.
    const periodType =
      period && typeof period.type === "string" ? period.type : null;

    return {
      ok: true,
      email: account.email,
      planLabel: account.planLabel,
      tier: account.tier,
      creditUsagePercent,
      periodType,
      periodStart:
        (period && typeof period.start === "string" && period.start) ||
        (typeof creditsRoot?.billingPeriodStart === "string"
          ? creditsRoot.billingPeriodStart
          : null),
      periodEnd:
        (period && typeof period.end === "string" && period.end) ||
        (typeof creditsRoot?.billingPeriodEnd === "string"
          ? creditsRoot.billingPeriodEnd
          : null),
      productUsage,
      prepaidBalance: numVal(creditsRoot?.prepaidBalance),
      onDemandCap: numVal(creditsRoot?.onDemandCap),
      onDemandUsed: numVal(creditsRoot?.onDemandUsed),
      isUnifiedBillingUser: !!creditsRoot?.isUnifiedBillingUser,
      monthlyUsedCents: null,
      monthlyLimitCents: null,
      monthlyPeriodStart: null,
      monthlyPeriodEnd: null,
      fetchedAt: Date.now(),
    };
  } catch (e) {
    return emptyUsage(e instanceof Error ? e.message : String(e), account);
  }
}
