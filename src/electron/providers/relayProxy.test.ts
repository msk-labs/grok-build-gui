import { afterEach, describe, expect, it, vi } from "vitest";
import { startRelayProxy, type RelayProxy } from "./relayProxy";
import type { UsageWindow } from "./types";

const running: RelayProxy[] = [];

afterEach(async () => {
  while (running.length) await running.pop()!.close();
});

type Harness = {
  proxy: RelayProxy;
  fetchImpl: ReturnType<typeof vi.fn>;
  usage: UsageWindow[][];
  getAccessToken: ReturnType<typeof vi.fn>;
  refreshAccessToken: ReturnType<typeof vi.fn>;
  post: (body: unknown, token?: string) => Promise<Response>;
};

async function harness(
  responder: (call: number, request: Request) => Response | Promise<Response>,
  overrides: { getAccessToken?: () => Promise<string> } = {},
): Promise<Harness> {
  let call = 0;
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    call += 1;
    return responder(call, new Request(url, init));
  });
  const usage: UsageWindow[][] = [];
  const getAccessToken = vi.fn(
    overrides.getAccessToken ?? (async () => "access-1"),
  );
  const refreshAccessToken = vi.fn(async () => "access-2");

  const proxy = await startRelayProxy({
    getAccessToken,
    refreshAccessToken,
    getAccountId: () => "acc-1",
    fetchImpl: fetchImpl as unknown as typeof fetch,
    onUsage: (windows) => usage.push(windows),
  });
  running.push(proxy);

  return {
    proxy,
    fetchImpl,
    usage,
    getAccessToken,
    refreshAccessToken,
    post: (body, token = proxy.token) =>
      fetch(`${proxy.baseUrl}/responses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      }),
  };
}

function sse(body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream", ...headers },
  });
}

describe("startRelayProxy", () => {
  it("binds loopback on an ephemeral port", async () => {
    const { proxy } = await harness(() => sse("data: {}\n\n"));
    expect(proxy.port).toBeGreaterThan(0);
    expect(proxy.baseUrl).toBe(`http://127.0.0.1:${proxy.port}/v1`);
    expect(proxy.token).toHaveLength(43);
  });

  it("rejects requests without the relay token", async () => {
    const { proxy, post, fetchImpl } = await harness(() => sse("data: {}\n\n"));

    const noAuth = await fetch(`${proxy.baseUrl}/models`);
    expect(noAuth.status).toBe(401);

    const wrongToken = await post({ model: "gpt-5.3-codex" }, "not-the-token");
    expect(wrongToken.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("serves the model catalog to an authorized caller", async () => {
    const { proxy } = await harness(() => sse("data: {}\n\n"));
    const response = await fetch(`${proxy.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${proxy.token}` },
    });
    const body = (await response.json()) as { data: Array<{ id: string }> };

    expect(response.status).toBe(200);
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0]).toMatchObject({ object: "model" });
  });

  it("answers the health probe without a token", async () => {
    const { proxy } = await harness(() => sse("data: {}\n\n"));
    const response = await fetch(`http://127.0.0.1:${proxy.port}/healthz`);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("attaches ChatGPT headers and the translated body upstream", async () => {
    let seen: Request | null = null;
    const { post } = await harness((_call, request) => {
      seen = request;
      return sse("data: done\n\n");
    });

    const response = await post({ model: "gpt-5.3-codex", store: true });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("data: done\n\n");

    const request = seen as unknown as Request;
    expect(request.url).toBe("https://chatgpt.com/backend-api/codex/responses");
    expect(request.headers.get("Authorization")).toBe("Bearer access-1");
    expect(request.headers.get("chatgpt-account-id")).toBe("acc-1");
    expect(request.headers.get("originator")).toBe("codex_cli_rs");
    expect(request.headers.get("session_id")).toBeTruthy();
    expect(await request.json()).toMatchObject({ store: false, stream: true });
  });

  it("refreshes once and replays after an upstream 401", async () => {
    const seen: string[] = [];
    const { post, refreshAccessToken } = await harness((call, request) => {
      seen.push(request.headers.get("Authorization") ?? "");
      return call === 1
        ? new Response("{}", { status: 401 })
        : sse("data: ok\n\n");
    });

    const response = await post({ model: "gpt-5.3-codex" });

    expect(response.status).toBe(200);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(["Bearer access-1", "Bearer access-2"]);
  });

  it("passes a second 401 through instead of looping", async () => {
    const { post, fetchImpl, refreshAccessToken } = await harness(
      () => new Response(JSON.stringify({ error: "nope" }), { status: 401 }),
    );

    const response = await post({ model: "gpt-5.3-codex" });

    expect(response.status).toBe(401);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it("reports a dead grant as 401 rather than a transport failure", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      return new Response("{}", { status: 401 });
    });
    const proxy = await startRelayProxy({
      getAccessToken: async () => "access-1",
      refreshAccessToken: async () => {
        throw new Error("The ChatGPT session expired. Please sign in again.");
      },
      getAccountId: () => "acc-1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    running.push(proxy);

    const response = await fetch(`${proxy.baseUrl}/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${proxy.token}`,
      },
      body: JSON.stringify({ model: "gpt-5.3-codex" }),
    });
    const body = (await response.json()) as {
      error: { message: string; code: string };
    };

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("needs_relogin");
    expect(body.error.message).toContain("sign in again");
    expect(call).toBe(1);
  });

  it("reports a signed-out store as 401 without calling upstream", async () => {
    const { post, fetchImpl } = await harness(() => sse("data: {}\n\n"), {
      getAccessToken: async () => {
        throw new Error("No ChatGPT account is signed in.");
      },
    });

    const response = await post({ model: "gpt-5.3-codex" });
    const body = (await response.json()) as { error: { message: string } };

    expect(response.status).toBe(401);
    expect(body.error.message).toContain("No ChatGPT account is signed in.");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("captures plan usage from the response headers", async () => {
    const { post, usage } = await harness(() =>
      sse("data: ok\n\n", {
        "x-codex-primary-used-percent": "37",
        "x-codex-primary-window-minutes": "300",
      }),
    );

    await post({ model: "gpt-5.3-codex" });

    expect(usage).toHaveLength(1);
    expect(usage[0]![0]).toMatchObject({
      id: "primary",
      label: "5h window",
      usedPercent: 37,
    });
  });

  it("preserves upstream error status codes", async () => {
    const { post } = await harness(
      () =>
        new Response(JSON.stringify({ error: { message: "slow down" } }), {
          status: 429,
          headers: { "Content-Type": "application/json" },
        }),
    );

    const response = await post({ model: "gpt-5.3-codex" });
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({
      error: { message: "slow down" },
    });
  });

  it("returns 502 when the upstream is unreachable", async () => {
    const { post } = await harness(() => {
      throw new Error("connect ECONNREFUSED");
    });

    const response = await post({ model: "gpt-5.3-codex" });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: { code: "upstream_unreachable" },
    });
  });

  it("rejects a malformed body", async () => {
    const { proxy, fetchImpl } = await harness(() => sse("data: {}\n\n"));
    const response = await fetch(`${proxy.baseUrl}/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${proxy.token}`,
      },
      body: "{not json",
    });

    expect(response.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("404s unknown routes", async () => {
    const { proxy } = await harness(() => sse("data: {}\n\n"));
    const response = await fetch(`${proxy.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${proxy.token}` },
      body: "{}",
    });
    expect(response.status).toBe(404);
  });
});
