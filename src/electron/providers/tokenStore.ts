/**
 * On-disk home for ChatGPT subscription credentials.
 *
 * Metadata (email, plan, refresh time) is plain JSON so the renderer can show
 * an account card; the token set itself is encrypted through an injected vault.
 * Refreshes are single-flight because OpenAI rotates refresh tokens — two
 * concurrent refreshes would invalidate each other and sign the user out.
 */

import fs from "node:fs";
import path from "node:path";
import { OAuthError, formatPlanLabel, readIdentity } from "./openaiOauth.js";
import { jwtExpiresAt } from "./jwt.js";
import type { ProviderAccount, TokenSet } from "./types.js";

/** Refresh this far ahead of the real expiry to absorb clock skew and latency. */
const REFRESH_SKEW_MS = 120_000;

const ACCOUNT_FILE = "chatgpt-account.json";
const TOKEN_FILE = "chatgpt-tokens.bin";

export interface SecretVault {
  /** False when the OS keychain is unavailable and storage falls back to plaintext. */
  readonly encrypted: boolean;
  encrypt(plain: string): Buffer;
  decrypt(payload: Buffer): string;
}

/** Last-resort vault for platforms without an OS keychain. */
export const plaintextVault: SecretVault = {
  encrypted: false,
  encrypt: (plain) => Buffer.from(plain, "utf8"),
  decrypt: (payload) => payload.toString("utf8"),
};

export class TokenStoreError extends Error {
  readonly code: "not_signed_in" | "needs_relogin" | "unreadable";

  constructor(code: TokenStoreError["code"], message: string) {
    super(message);
    this.name = "TokenStoreError";
    this.code = code;
  }
}

export type TokenStoreOptions = {
  /** Directory that holds the account and token files. */
  dir: string;
  vault: SecretVault;
  refresh: (previous: TokenSet) => Promise<TokenSet>;
  now?: () => number;
};

type AccountFile = {
  email: string | null;
  accountId: string | null;
  planType: string | null;
  lastRefresh: string | null;
  needsRelogin: boolean;
};

function writeFileAtomic(file: string, data: Buffer): void {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export class ChatGptTokenStore {
  private readonly options: TokenStoreOptions;
  private readonly now: () => number;
  private inflight: Promise<string> | null = null;
  private cached: TokenSet | null = null;

  constructor(options: TokenStoreOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
  }

  private accountPath(): string {
    return path.join(this.options.dir, ACCOUNT_FILE);
  }

  private tokenPath(): string {
    return path.join(this.options.dir, TOKEN_FILE);
  }

  private readAccountFile(): AccountFile | null {
    try {
      const raw = fs.readFileSync(this.accountPath(), "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      const data = parsed as Partial<AccountFile>;
      return {
        email: typeof data.email === "string" ? data.email : null,
        accountId: typeof data.accountId === "string" ? data.accountId : null,
        planType: typeof data.planType === "string" ? data.planType : null,
        lastRefresh:
          typeof data.lastRefresh === "string" ? data.lastRefresh : null,
        needsRelogin: data.needsRelogin === true,
      };
    } catch {
      return null;
    }
  }

  private writeAccountFile(account: AccountFile): void {
    fs.mkdirSync(this.options.dir, { recursive: true });
    writeFileAtomic(
      this.accountPath(),
      Buffer.from(`${JSON.stringify(account, null, 2)}\n`, "utf8"),
    );
  }

  private readTokens(): TokenSet | null {
    if (this.cached) return this.cached;
    let payload: Buffer;
    try {
      payload = fs.readFileSync(this.tokenPath());
    } catch {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(this.options.vault.decrypt(payload));
      if (!parsed || typeof parsed !== "object") return null;
      const data = parsed as Partial<TokenSet>;
      if (
        typeof data.accessToken !== "string" ||
        typeof data.refreshToken !== "string"
      ) {
        return null;
      }
      this.cached = {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        idToken: typeof data.idToken === "string" ? data.idToken : null,
      };
      return this.cached;
    } catch {
      throw new TokenStoreError(
        "unreadable",
        "Stored ChatGPT credentials could not be decrypted. Please sign in again.",
      );
    }
  }

  private writeTokens(tokens: TokenSet): void {
    fs.mkdirSync(this.options.dir, { recursive: true });
    writeFileAtomic(
      this.tokenPath(),
      this.options.vault.encrypt(JSON.stringify(tokens)),
    );
    this.cached = tokens;
  }

  /** True when a stored account exists, even if it needs a fresh sign-in. */
  hasAccount(): boolean {
    return this.readAccountFile() !== null;
  }

  /** Non-secret account view for the renderer. */
  getAccount(): ProviderAccount | null {
    const file = this.readAccountFile();
    if (!file) return null;
    return {
      provider: "openai",
      authMode: "oauth",
      email: file.email,
      accountId: file.accountId,
      planType: file.planType,
      lastRefresh: file.lastRefresh,
      needsRelogin: file.needsRelogin,
    };
  }

  planLabel(): string {
    return formatPlanLabel(this.readAccountFile()?.planType ?? null);
  }

  /** Persist a freshly issued token set and refresh the derived metadata. */
  save(tokens: TokenSet): ProviderAccount {
    const identity = readIdentity(tokens);
    this.writeTokens(tokens);
    this.writeAccountFile({
      email: identity.email,
      accountId: identity.accountId,
      planType: identity.planType,
      lastRefresh: new Date(this.now()).toISOString(),
      needsRelogin: false,
    });
    return this.getAccount()!;
  }

  clear(): void {
    this.cached = null;
    this.inflight = null;
    fs.rmSync(this.accountPath(), { force: true });
    fs.rmSync(this.tokenPath(), { force: true });
  }

  /** Valid access token, refreshing proactively when it is close to expiry. */
  async getAccessToken(): Promise<string> {
    const account = this.readAccountFile();
    if (!account) {
      throw new TokenStoreError(
        "not_signed_in",
        "No ChatGPT account is signed in.",
      );
    }
    if (account.needsRelogin) {
      throw new TokenStoreError(
        "needs_relogin",
        "The ChatGPT session expired. Please sign in again.",
      );
    }
    const tokens = this.readTokens();
    if (!tokens) {
      throw new TokenStoreError(
        "not_signed_in",
        "No ChatGPT credentials are stored.",
      );
    }
    const expiresAt = jwtExpiresAt(tokens.accessToken);
    if (expiresAt !== null && expiresAt - this.now() <= REFRESH_SKEW_MS) {
      return this.refreshNow();
    }
    return tokens.accessToken;
  }

  /**
   * Force a refresh. Concurrent callers share one request so the rotating
   * refresh token is never spent twice.
   */
  refreshNow(): Promise<string> {
    if (this.inflight) return this.inflight;
    const run = this.performRefresh().finally(() => {
      this.inflight = null;
    });
    this.inflight = run;
    return run;
  }

  private async performRefresh(): Promise<string> {
    const previous = this.readTokens();
    if (!previous) {
      throw new TokenStoreError(
        "not_signed_in",
        "No ChatGPT credentials are stored.",
      );
    }
    try {
      const next = await this.options.refresh(previous);
      const identity = readIdentity(next);
      const existing = this.readAccountFile();
      this.writeTokens(next);
      this.writeAccountFile({
        email: identity.email ?? existing?.email ?? null,
        accountId: identity.accountId ?? existing?.accountId ?? null,
        planType: identity.planType ?? existing?.planType ?? null,
        lastRefresh: new Date(this.now()).toISOString(),
        needsRelogin: false,
      });
      return next.accessToken;
    } catch (error) {
      if (error instanceof OAuthError && isFatalRefreshError(error.code)) {
        this.markNeedsRelogin();
        throw new TokenStoreError(
          "needs_relogin",
          "The ChatGPT session expired. Please sign in again.",
        );
      }
      throw error;
    }
  }

  private markNeedsRelogin(): void {
    const existing = this.readAccountFile();
    if (!existing) return;
    this.cached = null;
    this.writeAccountFile({ ...existing, needsRelogin: true });
  }
}

/** Refresh failures that cannot be retried — the grant itself is gone. */
function isFatalRefreshError(code: string): boolean {
  return (
    code === "invalid_grant" ||
    code === "invalid_client" ||
    code === "unauthorized_client" ||
    code === "http_400" ||
    code === "http_401"
  );
}
