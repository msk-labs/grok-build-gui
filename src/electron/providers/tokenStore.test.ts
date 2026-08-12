import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OAuthError } from "./openaiOauth";
import {
  ChatGptTokenStore,
  TokenStoreError,
  plaintextVault,
  type SecretVault,
} from "./tokenStore";
import type { TokenSet } from "./types";

const claim = "https://api.openai.com/auth";
const dirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-gui-tokens-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode(payload)}.sig`;
}

function tokens(expSeconds: number, overrides: Partial<TokenSet> = {}): TokenSet {
  return {
    accessToken: jwt({
      exp: expSeconds,
      email: "user@example.com",
      [claim]: { chatgpt_account_id: "acc-1", chatgpt_plan_type: "plus" },
    }),
    refreshToken: "rt-1",
    idToken: null,
    ...overrides,
  };
}

const NOW = 1_700_000_000_000;
const now = () => NOW;

describe("ChatGptTokenStore", () => {
  it("reports no account before sign-in", async () => {
    const store = new ChatGptTokenStore({
      dir: tempDir(),
      vault: plaintextVault,
      refresh: async () => {
        throw new Error("should not refresh");
      },
      now,
    });
    expect(store.hasAccount()).toBe(false);
    expect(store.getAccount()).toBeNull();
    await expect(store.getAccessToken()).rejects.toMatchObject({
      code: "not_signed_in",
    });
  });

  it("saves derived account metadata and returns a live token unchanged", async () => {
    const store = new ChatGptTokenStore({
      dir: tempDir(),
      vault: plaintextVault,
      refresh: async () => {
        throw new Error("should not refresh");
      },
      now,
    });
    const live = tokens(NOW / 1000 + 3600);
    const account = store.save(live);

    expect(account).toMatchObject({
      email: "user@example.com",
      accountId: "acc-1",
      planType: "plus",
      needsRelogin: false,
    });
    expect(store.planLabel()).toBe("ChatGPT Plus");
    await expect(store.getAccessToken()).resolves.toBe(live.accessToken);
  });

  it("refreshes proactively inside the expiry skew window", async () => {
    const refreshed = tokens(NOW / 1000 + 3600, {
      accessToken: jwt({ exp: NOW / 1000 + 3600, sub: "fresh" }),
      refreshToken: "rt-2",
    });
    const refresh = vi.fn<(previous: TokenSet) => Promise<TokenSet>>(
      async () => refreshed,
    );
    const store = new ChatGptTokenStore({
      dir: tempDir(),
      vault: plaintextVault,
      refresh,
      now,
    });
    // Expires in 60s — inside the 120s skew, so it must refresh first.
    store.save(tokens(NOW / 1000 + 60));

    await expect(store.getAccessToken()).resolves.toBe(refreshed.accessToken);
    expect(refresh).toHaveBeenCalledTimes(1);
    // The rotated refresh token is what a later refresh must use.
    expect(refresh.mock.calls[0]![0]).toMatchObject({ refreshToken: "rt-1" });
    await expect(store.getAccessToken()).resolves.toBe(refreshed.accessToken);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("collapses concurrent refreshes into a single upstream call", async () => {
    let release!: (value: TokenSet) => void;
    const pending = new Promise<TokenSet>((resolve) => {
      release = resolve;
    });
    const refresh = vi.fn(() => pending);
    const store = new ChatGptTokenStore({
      dir: tempDir(),
      vault: plaintextVault,
      refresh,
      now,
    });
    store.save(tokens(NOW / 1000 + 60));

    const all = Promise.all([
      store.getAccessToken(),
      store.getAccessToken(),
      store.refreshNow(),
    ]);
    release(tokens(NOW / 1000 + 3600, { accessToken: jwt({ exp: NOW / 1000 + 3600 }) }));
    const results = await all;

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(new Set(results).size).toBe(1);
  });

  it("marks the account for re-login when the grant is gone", async () => {
    const store = new ChatGptTokenStore({
      dir: tempDir(),
      vault: plaintextVault,
      refresh: async () => {
        throw new OAuthError("invalid_grant", "refresh token expired");
      },
      now,
    });
    store.save(tokens(NOW / 1000 + 60));

    await expect(store.getAccessToken()).rejects.toMatchObject({
      code: "needs_relogin",
    });
    expect(store.getAccount()).toMatchObject({ needsRelogin: true });
    // The account card stays visible so the user knows who to sign back in as.
    expect(store.getAccount()).toMatchObject({ email: "user@example.com" });
    await expect(store.getAccessToken()).rejects.toMatchObject({
      code: "needs_relogin",
    });
  });

  it("keeps transient refresh failures retryable", async () => {
    const refresh = vi
      .fn<(previous: TokenSet) => Promise<TokenSet>>()
      .mockRejectedValueOnce(new OAuthError("http_503", "upstream down"))
      .mockResolvedValueOnce(
        tokens(NOW / 1000 + 3600, { accessToken: jwt({ exp: NOW / 1000 + 3600 }) }),
      );
    const store = new ChatGptTokenStore({
      dir: tempDir(),
      vault: plaintextVault,
      refresh,
      now,
    });
    store.save(tokens(NOW / 1000 + 60));

    await expect(store.getAccessToken()).rejects.toMatchObject({
      code: "http_503",
    });
    expect(store.getAccount()).toMatchObject({ needsRelogin: false });
    await expect(store.getAccessToken()).resolves.toBeTruthy();
  });

  it("encrypts the token file through the vault", () => {
    const dir = tempDir();
    const vault: SecretVault = {
      encrypted: true,
      encrypt: (plain) => Buffer.from(plain, "utf8").reverse(),
      decrypt: (payload) => Buffer.from(payload).reverse().toString("utf8"),
    };
    const store = new ChatGptTokenStore({
      dir,
      vault,
      refresh: async () => {
        throw new Error("should not refresh");
      },
      now,
    });
    store.save(tokens(NOW / 1000 + 3600));

    const onDisk = fs.readFileSync(path.join(dir, "chatgpt-tokens.bin"), "utf8");
    expect(onDisk).not.toContain("rt-1");
    expect(fs.readFileSync(path.join(dir, "chatgpt-account.json"), "utf8")).toContain(
      "user@example.com",
    );

    const reopened = new ChatGptTokenStore({
      dir,
      vault,
      refresh: async () => {
        throw new Error("should not refresh");
      },
      now,
    });
    expect(reopened.getAccount()).toMatchObject({ accountId: "acc-1" });
  });

  it("reports undecryptable credentials instead of silently signing out", async () => {
    const dir = tempDir();
    const store = new ChatGptTokenStore({
      dir,
      vault: plaintextVault,
      refresh: async () => {
        throw new Error("should not refresh");
      },
      now,
    });
    store.save(tokens(NOW / 1000 + 3600));
    fs.writeFileSync(path.join(dir, "chatgpt-tokens.bin"), "corrupted");

    const reopened = new ChatGptTokenStore({
      dir,
      vault: plaintextVault,
      refresh: async () => {
        throw new Error("should not refresh");
      },
      now,
    });
    await expect(reopened.getAccessToken()).rejects.toBeInstanceOf(
      TokenStoreError,
    );
  });

  it("removes both files on sign-out", () => {
    const dir = tempDir();
    const store = new ChatGptTokenStore({
      dir,
      vault: plaintextVault,
      refresh: async () => {
        throw new Error("should not refresh");
      },
      now,
    });
    store.save(tokens(NOW / 1000 + 3600));
    store.clear();

    expect(store.hasAccount()).toBe(false);
    expect(fs.existsSync(path.join(dir, "chatgpt-tokens.bin"))).toBe(false);
  });
});
