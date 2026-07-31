import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readlineMock = vi.hoisted(() => ({
  lineHandlers: [] as Array<(line: string) => void>,
}));

vi.mock("node:readline", () => ({
  createInterface: vi.fn(() => ({
    on: vi.fn((event: string, handler: (line: string) => void) => {
      if (event === "line") readlineMock.lineHandlers.push(handler);
    }),
  })),
}));

type JsonMessage = {
  id?: string | number | null;
  result?: {
    tools?: Array<{
      name: string;
      inputSchema: Record<string, unknown>;
    }>;
    content?: Array<Record<string, unknown>>;
    isError?: boolean;
    protocolVersion?: string;
  };
  error?: { code?: number; message?: string };
};

function messages(
  stdoutSpy: ReturnType<typeof vi.spyOn>,
): JsonMessage[] {
  const calls = stdoutSpy.mock.calls as unknown[][];
  return calls.map((call) =>
    JSON.parse(String(call[0]).trim()) as JsonMessage,
  );
}

async function loadServer(
  stdoutSpy: ReturnType<typeof vi.spyOn>,
  options: { configured?: boolean } = {},
) {
  vi.resetModules();
  readlineMock.lineHandlers.length = 0;
  if (options.configured === false) {
    delete process.env.GROK_GUI_BROWSER_BRIDGE_URL;
    delete process.env.GROK_GUI_BROWSER_BRIDGE_TOKEN;
  } else {
    process.env.GROK_GUI_BROWSER_BRIDGE_URL =
      "http://127.0.0.1:43210/call";
    process.env.GROK_GUI_BROWSER_BRIDGE_TOKEN = "fixture-token";
  }
  await import("./browserMcpServer");
  expect(readlineMock.lineHandlers).toHaveLength(1);
  const line = readlineMock.lineHandlers[0]!;
  return {
    async send(value: unknown) {
      const count = stdoutSpy.mock.calls.length;
      line(typeof value === "string" ? value : JSON.stringify(value));
      await vi.waitFor(() => {
        expect(stdoutSpy.mock.calls.length).toBeGreaterThan(count);
      });
      return messages(stdoutSpy).at(-1)!;
    },
    sendNotification(value: unknown) {
      line(JSON.stringify(value));
    },
  };
}

describe("browser MCP stdio server", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((() => true) as typeof process.stdout.write);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            ok: true,
            result: { text: "Done." },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    );
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    vi.unstubAllGlobals();
    delete process.env.GROK_GUI_BROWSER_BRIDGE_URL;
    delete process.env.GROK_GUI_BROWSER_BRIDGE_TOKEN;
  });

  it("implements initialize, ping, notifications, and method errors", async () => {
    const server = await loadServer(stdoutSpy);

    const initialized = await server.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18" },
    });
    const ping = await server.send({
      jsonrpc: "2.0",
      id: 2,
      method: "ping",
    });
    const beforeNotification = stdoutSpy.mock.calls.length;
    server.sendNotification({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    server.sendNotification({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
    });
    await Promise.resolve();
    const unknown = await server.send({
      jsonrpc: "2.0",
      id: 3,
      method: "unknown",
    });

    expect(initialized).toMatchObject({
      id: 1,
      result: { protocolVersion: "2025-06-18" },
    });
    expect(ping).toEqual({ jsonrpc: "2.0", id: 2, result: {} });
    expect(stdoutSpy.mock.calls.length).toBe(beforeNotification + 1);
    expect(unknown.error).toEqual({
      code: -32601,
      message: "Method not found: unknown",
    });
  });

  it("publishes schemas that match every implemented browser tool", async () => {
    const server = await loadServer(stdoutSpy);

    const listed = await server.send({
      jsonrpc: "2.0",
      id: "tools",
      method: "tools/list",
    });
    const tools = listed.result?.tools ?? [];

    expect(tools.map((tool) => tool.name)).toEqual([
      "browser_open",
      "browser_snapshot",
      "browser_navigate",
      "browser_click",
      "browser_fill",
      "browser_press_key",
      "browser_scroll",
      "browser_screenshot",
      "browser_wait_for",
    ]);
    for (const tool of tools) {
      expect(tool.inputSchema).toMatchObject({
        type: "object",
        additionalProperties: false,
      });
    }
    expect(
      tools.find((tool) => tool.name === "browser_navigate")?.inputSchema,
    ).toMatchObject({ required: ["url"] });
    expect(
      tools.find((tool) => tool.name === "browser_fill")?.inputSchema,
    ).toMatchObject({ required: ["ref", "value"] });
    expect(
      tools.find((tool) => tool.name === "browser_wait_for")?.inputSchema,
    ).toMatchObject({
      properties: {
        timeoutMs: { minimum: 100, maximum: 30000 },
      },
    });
  });

  it("forwards calls with authorization and returns text plus image content", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          result: {
            text: "Screenshot ready",
            image: { data: "cG5n", mimeType: "image/png" },
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const server = await loadServer(stdoutSpy);

    const called = await server.send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "browser_screenshot",
        arguments: { browserId: "right-1" },
      },
    });

    expect(called.result?.content).toEqual([
      { type: "text", text: "Screenshot ready" },
      { type: "image", data: "cG5n", mimeType: "image/png" },
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:43210/call");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        authorization: "Bearer fixture-token",
        "content-type": "application/json",
      },
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      tool: "browser_screenshot",
      arguments: { browserId: "right-1" },
      clientId: expect.any(String),
    });
  });

  it("returns protocol errors for parse failures and unknown tools", async () => {
    const server = await loadServer(stdoutSpy);

    const parseFailure = await server.send("{not-json");
    const unknownTool = await server.send({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "browser_unknown" },
    });

    expect(parseFailure.error).toEqual({
      code: -32700,
      message: "Parse error",
    });
    expect(unknownTool.error).toEqual({
      code: -32602,
      message: "Unknown browser tool: browser_unknown",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("converts bridge failures into MCP tool error content", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ok: false, error: "fixture bridge failed" }),
        {
          status: 400,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const server = await loadServer(stdoutSpy);

    const failed = await server.send({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "browser_open", arguments: {} },
    });

    expect(failed.result).toEqual({
      isError: true,
      content: [{ type: "text", text: "fixture bridge failed" }],
    });
  });

  it("reports missing bridge configuration as a tool error", async () => {
    const server = await loadServer(stdoutSpy, { configured: false });

    const failed = await server.send({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "browser_open" },
    });

    expect(failed.result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "The GUI browser bridge is not configured.",
        },
      ],
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
