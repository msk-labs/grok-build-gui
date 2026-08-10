import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TokenSet } from "./types";

const dirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

const hoisted = vi.hoisted(() => ({
  userData: "",
  loginResult: null as TokenSet | null,
  loginError: null as Error | null,
}));

vi.mock("electron", () => ({
  app: { getPath: () => hoisted.userData },
  safeStorage: { isEncryptionAvailable: () => false },
  shell: { openExternal: async () => {} },
}));

vi.mock("./openaiOauth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./openaiOauth")>();
  return {
    ...actual,
    startLogin: () => ({
      completed: hoisted.loginError
        ? Promise.reject(hoisted.loginError)
        : Promise.resolve(hoisted.loginResult!),
      cancel: () => {},
    }),
  };
});

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode(payload)}.sig`;
}

function tokensForPlan(planType: string): TokenSet {
  const claim = {
    exp: Math.floor(Date.now() / 1000) + 3600,
    email: "user@example.com",
    "https://api.openai.com/auth": {
      chatgpt_account_id: "acc-1",
      chatgpt_plan_type: planType,
    },
  };
  return { accessToken: jwt(claim), refreshToken: "rt-1", idToken: null };
}

/** Fresh module state per test — the provider keeps singletons. */
async function loadProvider() {
  vi.resetModules();
  return import("./chatgptProvider.js");
}

/** Publishing models to the agent is `modelSync`'s job, not the provider's. */
async function syncConfig() {
  const { syncManagedModelConfig } = await import("./modelSync.js");
  await syncManagedModelConfig();
}

function accountFile(): string {
  return path.join(hoisted.userData, "providers", "chatgpt-account.json");
}

beforeEach(() => {
  hoisted.userData = tempDir("grok-gui-userdata-");
  hoisted.loginError = null;
  // Keep config.toml writes inside the test sandbox, never the real ~/.grok.
  process.env.GROK_HOME = tempDir("grok-gui-grokhome-");
});

afterEach(async () => {
  const provider = await import("./chatgptProvider.js");
  await provider.shutdownChatGptProvider().catch(() => {});
  delete process.env.GROK_HOME;
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("loginToChatGpt", () => {
  it("refuses a free plan and stores nothing", async () => {
    hoisted.loginResult = tokensForPlan("free");
    const provider = await loadProvider();

    const result = await provider.loginToChatGpt();

    expect(result.ok).toBe(false);
    expect(result.status.account).toBeNull();
    expect(result.status.rejectedPlanLabel).toBe("ChatGPT Free");
    expect(result.error).toContain("does not include Codex");
    // Nothing on disk: no credential file, no model entries for the agent.
    expect(fs.existsSync(accountFile())).toBe(false);
    expect(fs.existsSync(path.join(process.env.GROK_HOME!, "config.toml"))).toBe(
      false,
    );
  });

  it("keeps a paid plan signed in", async () => {
    hoisted.loginResult = tokensForPlan("pro");
    const provider = await loadProvider();

    const result = await provider.loginToChatGpt();

    expect(result.ok).toBe(true);
    expect(result.status.account).toMatchObject({
      email: "user@example.com",
      planType: "pro",
    });
    expect(result.status.rejectedPlanLabel).toBeNull();
    expect(fs.existsSync(accountFile())).toBe(true);

    await syncConfig();
    const config = fs.readFileSync(
      path.join(process.env.GROK_HOME!, "config.toml"),
      "utf8",
    );
    expect(config).toContain("[model.chatgpt-");
    expect(config).toContain("http://127.0.0.1:");
  });

  it("reports an aborted sign-in without claiming a plan problem", async () => {
    hoisted.loginResult = null;
    hoisted.loginError = new Error("Sign-in was canceled.");
    const provider = await loadProvider();

    const result = await provider.loginToChatGpt();

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Sign-in was canceled.");
    expect(result.status.rejectedPlanLabel).toBeNull();
  });
});

describe("stored account eligibility", () => {
  it("signs out a plan that can no longer use Codex", async () => {
    // A paid account signs in, then the plan claim downgrades on refresh.
    hoisted.loginResult = tokensForPlan("pro");
    const provider = await loadProvider();
    await provider.loginToChatGpt();
    expect(fs.existsSync(accountFile())).toBe(true);

    fs.writeFileSync(
      accountFile(),
      JSON.stringify({
        email: "user@example.com",
        accountId: "acc-1",
        planType: "free",
        lastRefresh: null,
        needsRelogin: false,
      }),
      "utf8",
    );

    const status = provider.getChatGptStatus();

    expect(status.account).toBeNull();
    expect(status.rejectedPlanLabel).toBe("ChatGPT Free");
    expect(fs.existsSync(accountFile())).toBe(false);
  });

  it("drops the agent's model entries when the account is purged", async () => {
    hoisted.loginResult = tokensForPlan("plus");
    const provider = await loadProvider();
    await provider.loginToChatGpt();
    await syncConfig();

    const configPath = path.join(process.env.GROK_HOME!, "config.toml");
    expect(fs.readFileSync(configPath, "utf8")).toContain("[model.chatgpt-");

    fs.writeFileSync(
      accountFile(),
      JSON.stringify({
        email: "user@example.com",
        accountId: "acc-1",
        planType: "free",
        lastRefresh: null,
        needsRelogin: false,
      }),
      "utf8",
    );
    await syncConfig();

    expect(fs.readFileSync(configPath, "utf8")).not.toContain("chatgpt");
  });
});
