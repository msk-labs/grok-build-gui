import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const automationMock = vi.hoisted(() => ({
  instances: [] as unknown[],
  invoke: vi.fn(
    async (tool: string, _instance: unknown, _args: Record<string, unknown>) => ({
      text: `${tool} ok`,
    }),
  ),
}));

vi.mock("./browserAutomation.js", () => {
  class MockBrowserAutomation {
    constructor(_requestPermission: unknown) {
      automationMock.instances.push(this);
    }

    open(args: Record<string, unknown>) {
      return automationMock.invoke("browser_open", this, args);
    }

    snapshot(args: Record<string, unknown>) {
      return automationMock.invoke("browser_snapshot", this, args);
    }

    navigate(args: Record<string, unknown>) {
      return automationMock.invoke("browser_navigate", this, args);
    }

    click(args: Record<string, unknown>) {
      return automationMock.invoke("browser_click", this, args);
    }

    fill(args: Record<string, unknown>) {
      return automationMock.invoke("browser_fill", this, args);
    }

    pressKey(args: Record<string, unknown>) {
      return automationMock.invoke("browser_press_key", this, args);
    }

    scroll(args: Record<string, unknown>) {
      return automationMock.invoke("browser_scroll", this, args);
    }

    screenshot(args: Record<string, unknown>) {
      return automationMock.invoke("browser_screenshot", this, args);
    }

    waitFor(args: Record<string, unknown>) {
      return automationMock.invoke("browser_wait_for", this, args);
    }
  }

  return { BrowserAutomation: MockBrowserAutomation };
});

import { startBrowserBridge, stopBrowserBridge } from "./browserBridge";

type BridgeConfig = {
  url: string;
  token: string;
};

function bridgeConfig(
  value: Awaited<ReturnType<typeof startBrowserBridge>>,
): BridgeConfig {
  const env = new Map(value.env?.map((item) => [item.name, item.value]));
  return {
    url: env.get("GROK_GUI_BROWSER_BRIDGE_URL") ?? "",
    token: env.get("GROK_GUI_BROWSER_BRIDGE_TOKEN") ?? "",
  };
}

async function post(
  config: BridgeConfig,
  body: unknown,
  overrides: {
    token?: string;
    url?: string;
    method?: string;
  } = {},
) {
  return fetch(overrides.url ?? config.url, {
    method: overrides.method ?? "POST",
    headers: {
      authorization: `Bearer ${overrides.token ?? config.token}`,
      "content-type": "application/json",
    },
    ...(overrides.method === "GET" ? {} : { body: JSON.stringify(body) }),
  });
}

describe("browser bridge", () => {
  const requestPermission = vi.fn(async () => true);

  beforeEach(() => {
    vi.clearAllMocks();
    automationMock.instances.length = 0;
    automationMock.invoke.mockImplementation(
      async (tool: string) => ({ text: `${tool} ok` }),
    );
  });

  afterEach(async () => {
    await stopBrowserBridge();
  });

  it("binds to loopback and returns a private MCP process configuration", async () => {
    const value = await startBrowserBridge(
      "D:\\fixture\\browserMcpServer.js",
      requestPermission,
    );
    const config = bridgeConfig(value);
    const parsed = new URL(config.url);

    expect(parsed.hostname).toBe("127.0.0.1");
    expect(parsed.pathname).toBe("/call");
    expect(Number(parsed.port)).toBeGreaterThan(0);
    expect(config.token).toMatch(/^[a-f0-9]{64}$/);
    expect(value).toMatchObject({
      name: "browser",
      command: process.execPath,
      args: ["D:\\fixture\\browserMcpServer.js"],
    });
    expect(value.env).toContainEqual({
      name: "ELECTRON_RUN_AS_NODE",
      value: "1",
    });
  });

  it("rejects the wrong token, path, and HTTP method without invoking automation", async () => {
    const config = bridgeConfig(
      await startBrowserBridge("server.js", requestPermission),
    );
    const wrongPath = new URL(config.url);
    wrongPath.pathname = "/other";

    const badToken = await post(
      config,
      { tool: "browser_open" },
      { token: "wrong" },
    );
    const badPath = await post(
      config,
      { tool: "browser_open" },
      { url: wrongPath.toString() },
    );
    const badMethod = await post(
      config,
      { tool: "browser_open" },
      { method: "GET" },
    );

    expect(badToken.status).toBe(404);
    expect(badPath.status).toBe(404);
    expect(badMethod.status).toBe(404);
    expect(automationMock.invoke).not.toHaveBeenCalled();
  });

  it("returns bounded JSON errors for invalid JSON and unknown tools", async () => {
    const config = bridgeConfig(
      await startBrowserBridge("server.js", requestPermission),
    );
    const invalid = await fetch(config.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
      },
      body: "{not-json",
    });
    const unknown = await post(config, { tool: "browser_unknown" });

    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({ ok: false });
    expect(unknown.status).toBe(400);
    await expect(unknown.json()).resolves.toEqual({
      ok: false,
      error: "Unknown browser tool: browser_unknown",
    });
  });

  it("enforces the one-megabyte request limit", async () => {
    const config = bridgeConfig(
      await startBrowserBridge("server.js", requestPermission),
    );

    await expect(
      post(config, {
        tool: "browser_fill",
        arguments: { value: "x".repeat(1024 * 1024) },
      }),
    ).rejects.toThrow();
    expect(automationMock.invoke).not.toHaveBeenCalled();
  });

  it("keeps BrowserAutomation state isolated by client id", async () => {
    const config = bridgeConfig(
      await startBrowserBridge("server.js", requestPermission),
    );

    await post(config, {
      clientId: "client-a",
      tool: "browser_snapshot",
      arguments: {},
    });
    await post(config, {
      clientId: "client-a",
      tool: "browser_click",
      arguments: { ref: "e1" },
    });
    await post(config, {
      clientId: "client-b",
      tool: "browser_snapshot",
      arguments: {},
    });

    expect(automationMock.instances).toHaveLength(2);
    expect(automationMock.invoke.mock.calls[0]?.[1]).toBe(
      automationMock.invoke.mock.calls[1]?.[1],
    );
    expect(automationMock.invoke.mock.calls[2]?.[1]).not.toBe(
      automationMock.invoke.mock.calls[0]?.[1],
    );
  });

  it("serializes mutating calls even after a previous mutation fails", async () => {
    const config = bridgeConfig(
      await startBrowserBridge("server.js", requestPermission),
    );
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    automationMock.invoke.mockImplementation(async (tool, _instance, args) => {
      if (tool === "browser_navigate" && args.order === 1) {
        await firstGate;
        throw new Error("first failed");
      }
      return { text: `${tool} ${String(args.order)}` };
    });

    const first = post(config, {
      clientId: "client-a",
      tool: "browser_navigate",
      arguments: { order: 1 },
    });
    await vi.waitFor(() => {
      expect(automationMock.invoke).toHaveBeenCalledTimes(1);
    });
    const second = post(config, {
      clientId: "client-a",
      tool: "browser_click",
      arguments: { order: 2 },
    });
    await Promise.resolve();
    expect(automationMock.invoke).toHaveBeenCalledTimes(1);

    releaseFirst();
    const [firstResponse, secondResponse] = await Promise.all([first, second]);

    expect(firstResponse.status).toBe(400);
    expect(secondResponse.status).toBe(200);
    expect(automationMock.invoke.mock.calls.map(([tool]) => tool)).toEqual([
      "browser_navigate",
      "browser_click",
    ]);
  });

  it("allows read-only work to proceed while a mutation is pending", async () => {
    const config = bridgeConfig(
      await startBrowserBridge("server.js", requestPermission),
    );
    let releaseMutation!: () => void;
    const mutationGate = new Promise<void>((resolve) => {
      releaseMutation = resolve;
    });
    automationMock.invoke.mockImplementation(async (tool) => {
      if (tool === "browser_navigate") await mutationGate;
      return { text: `${tool} ok` };
    });

    const mutation = post(config, {
      tool: "browser_navigate",
      arguments: {},
    });
    await vi.waitFor(() => {
      expect(automationMock.invoke).toHaveBeenCalledWith(
        "browser_navigate",
        expect.anything(),
        {},
      );
    });
    const snapshot = post(config, {
      tool: "browser_snapshot",
      arguments: {},
    });

    await expect(snapshot).resolves.toMatchObject({ status: 200 });
    expect(automationMock.invoke.mock.calls.map(([tool]) => tool)).toContain(
      "browser_snapshot",
    );
    releaseMutation();
    await mutation;
  });

  it("prevents multiple bridge instances and permits a clean restart", async () => {
    await startBrowserBridge("server.js", requestPermission);

    await expect(
      startBrowserBridge("server.js", requestPermission),
    ).rejects.toThrow("already running");

    await stopBrowserBridge();
    const restarted = await startBrowserBridge(
      "server.js",
      requestPermission,
    );
    expect(bridgeConfig(restarted).url).toContain("127.0.0.1");
  });
});
