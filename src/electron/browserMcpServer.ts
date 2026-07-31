import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";

type JsonRpcId = string | number | null;
type JsonRpcRequest = {
  jsonrpc?: unknown;
  id?: JsonRpcId;
  method?: unknown;
  params?: unknown;
};

type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

const bridgeUrl = process.env.GROK_GUI_BROWSER_BRIDGE_URL ?? "";
const bridgeToken = process.env.GROK_GUI_BROWSER_BRIDGE_TOKEN ?? "";
const bridgeClientId = randomUUID();

const browserIdProperty = {
  type: "string",
  description:
    "Optional GUI browser slot id. Omit to control the right-side browser pane.",
};

const tools: ToolDefinition[] = [
  {
    name: "browser_open",
    description:
      "Open or focus the GUI's visible embedded browser. Use this when a task requires interacting with a live webpage; do not use it for ordinary factual questions that do not require page interaction.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Optional initial URL." },
        browserId: browserIdProperty,
      },
      additionalProperties: false,
    },
  },
  {
    name: "browser_snapshot",
    description:
      "Read a compact accessibility snapshot of the visible browser page. Interactive elements receive refs such as e1; call this before click or fill and again after navigation or major page changes.",
    inputSchema: {
      type: "object",
      properties: { browserId: browserIdProperty },
      additionalProperties: false,
    },
  },
  {
    name: "browser_navigate",
    description: "Navigate the visible GUI browser to a URL.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        browserId: browserIdProperty,
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "browser_click",
    description:
      "Click an element ref from the latest browser_snapshot using trusted Chromium input events. Sensitive submit, purchase, send, or delete actions require user approval.",
    inputSchema: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Element ref from browser_snapshot." },
        browserId: browserIdProperty,
      },
      required: ["ref"],
      additionalProperties: false,
    },
  },
  {
    name: "browser_fill",
    description:
      "Replace the value of an editable element ref using Chromium keyboard input. Filling password fields requires user approval.",
    inputSchema: {
      type: "object",
      properties: {
        ref: { type: "string" },
        value: { type: "string" },
        browserId: browserIdProperty,
      },
      required: ["ref", "value"],
      additionalProperties: false,
    },
  },
  {
    name: "browser_press_key",
    description:
      "Press a key in the visible browser, for example Enter, Tab, Escape, ArrowDown, or a single character.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string" },
        browserId: browserIdProperty,
      },
      required: ["key"],
      additionalProperties: false,
    },
  },
  {
    name: "browser_scroll",
    description: "Scroll the visible browser page with a Chromium mouse-wheel event.",
    inputSchema: {
      type: "object",
      properties: {
        deltaY: { type: "number", description: "Vertical pixels; positive scrolls down." },
        deltaX: { type: "number", description: "Horizontal pixels." },
        browserId: browserIdProperty,
      },
      additionalProperties: false,
    },
  },
  {
    name: "browser_screenshot",
    description: "Capture a PNG screenshot of the visible embedded browser page.",
    inputSchema: {
      type: "object",
      properties: { browserId: browserIdProperty },
      additionalProperties: false,
    },
  },
  {
    name: "browser_wait_for",
    description:
      "Wait until page text appears and/or the current URL contains a value. The timeout is capped at 30 seconds.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        urlContains: { type: "string" },
        timeoutMs: { type: "number", minimum: 100, maximum: 30000 },
        browserId: browserIdProperty,
      },
      additionalProperties: false,
    },
  },
];

function write(message: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function result(id: JsonRpcId, value: unknown): void {
  write({ jsonrpc: "2.0", id, result: value });
}

function failure(id: JsonRpcId, code: number, message: string): void {
  write({ jsonrpc: "2.0", id, error: { code, message } });
}

async function callBridge(
  tool: string,
  args: Record<string, unknown>,
): Promise<{
  text: string;
  image?: { data: string; mimeType: string };
}> {
  if (!bridgeUrl || !bridgeToken) {
    throw new Error("The GUI browser bridge is not configured.");
  }
  const response = await fetch(bridgeUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${bridgeToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ clientId: bridgeClientId, tool, arguments: args }),
  });
  const payload = (await response.json()) as {
    ok?: boolean;
    result?: { text?: unknown; image?: { data?: unknown; mimeType?: unknown } };
    error?: unknown;
  };
  if (!response.ok || !payload.ok || !payload.result) {
    throw new Error(
      typeof payload.error === "string"
        ? payload.error
        : `Browser bridge failed with HTTP ${response.status}.`,
    );
  }
  const text = typeof payload.result.text === "string" ? payload.result.text : "Done.";
  const image = payload.result.image;
  return {
    text,
    ...(image && typeof image.data === "string" && typeof image.mimeType === "string"
      ? { image: { data: image.data, mimeType: image.mimeType } }
      : {}),
  };
}

async function handle(request: JsonRpcRequest): Promise<void> {
  const method = typeof request.method === "string" ? request.method : "";
  const hasId = Object.prototype.hasOwnProperty.call(request, "id");
  const id = request.id ?? null;

  if (method === "notifications/initialized" || method === "notifications/cancelled") {
    return;
  }
  if (!hasId) return;

  if (method === "initialize") {
    const params = request.params as { protocolVersion?: unknown } | undefined;
    result(id, {
      protocolVersion:
        typeof params?.protocolVersion === "string"
          ? params.protocolVersion
          : "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "grok-gui-browser", version: "0.1.0" },
    });
    return;
  }
  if (method === "ping") {
    result(id, {});
    return;
  }
  if (method === "tools/list") {
    result(id, { tools });
    return;
  }
  if (method === "tools/call") {
    const params = request.params as
      | { name?: unknown; arguments?: unknown }
      | undefined;
    const name = typeof params?.name === "string" ? params.name : "";
    if (!tools.some((tool) => tool.name === name)) {
      failure(id, -32602, `Unknown browser tool: ${name || "<missing>"}`);
      return;
    }
    try {
      const args =
        params?.arguments && typeof params.arguments === "object"
          ? (params.arguments as Record<string, unknown>)
          : {};
      const bridgeResult = await callBridge(name, args);
      const content: Array<Record<string, unknown>> = [
        { type: "text", text: bridgeResult.text },
      ];
      if (bridgeResult.image) {
        content.push({
          type: "image",
          data: bridgeResult.image.data,
          mimeType: bridgeResult.image.mimeType,
        });
      }
      result(id, { content });
    } catch (error) {
      result(id, {
        isError: true,
        content: [
          {
            type: "text",
            text: error instanceof Error ? error.message : String(error),
          },
        ],
      });
    }
    return;
  }
  failure(id, -32601, `Method not found: ${method}`);
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let request: JsonRpcRequest;
  try {
    request = JSON.parse(trimmed) as JsonRpcRequest;
  } catch {
    failure(null, -32700, "Parse error");
    return;
  }
  void handle(request).catch((error) => {
    if (Object.prototype.hasOwnProperty.call(request, "id")) {
      failure(
        request.id ?? null,
        -32603,
        error instanceof Error ? error.message : String(error),
      );
    }
  });
});
