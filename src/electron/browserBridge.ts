import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  BrowserAutomation,
  type BrowserPermissionRequest,
  type BrowserToolResult,
} from "./browserAutomation.js";
import type { ClientMcpStdio } from "./acp/sessionManager.js";

type BridgeRequest = {
  clientId?: unknown;
  tool?: unknown;
  arguments?: unknown;
};

let bridgeServer: Server | null = null;

function readBody(request: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error("Browser bridge request is too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

async function invoke(
  automations: Map<string, BrowserAutomation>,
  requestPermission: BrowserPermissionRequest,
  payload: BridgeRequest,
): Promise<BrowserToolResult> {
  const clientId =
    typeof payload.clientId === "string" && payload.clientId
      ? payload.clientId
      : "default";
  let automation = automations.get(clientId);
  if (!automation) {
    automation = new BrowserAutomation(requestPermission);
    automations.set(clientId, automation);
  }
  const tool = typeof payload.tool === "string" ? payload.tool : "";
  const args =
    payload.arguments && typeof payload.arguments === "object"
      ? (payload.arguments as Record<string, unknown>)
      : {};
  switch (tool) {
    case "browser_open":
      return automation.open(args);
    case "browser_snapshot":
      return automation.snapshot(args);
    case "browser_navigate":
      return automation.navigate(args);
    case "browser_click":
      return automation.click(args);
    case "browser_fill":
      return automation.fill(args);
    case "browser_press_key":
      return automation.pressKey(args);
    case "browser_scroll":
      return automation.scroll(args);
    case "browser_screenshot":
      return automation.screenshot(args);
    case "browser_wait_for":
      return automation.waitFor(args);
    default:
      throw new Error(`Unknown browser tool: ${tool || "<missing>"}`);
  }
}

export async function startBrowserBridge(
  mcpEntryPath: string,
  requestPermission: BrowserPermissionRequest,
): Promise<ClientMcpStdio> {
  if (bridgeServer) throw new Error("Browser bridge is already running.");
  const token = randomBytes(32).toString("hex");
  const automations = new Map<string, BrowserAutomation>();
  let callChain: Promise<void> = Promise.resolve();

  const server = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json; charset=utf-8");
    if (
      request.method !== "POST" ||
      request.url !== "/call" ||
      request.headers.authorization !== `Bearer ${token}`
    ) {
      response.statusCode = 404;
      response.end(JSON.stringify({ ok: false, error: "Not found" }));
      return;
    }
    try {
      const raw = await readBody(request);
      const payload = JSON.parse(raw) as BridgeRequest;
      const readOnly =
        payload.tool === "browser_wait_for" ||
        payload.tool === "browser_snapshot" ||
        payload.tool === "browser_screenshot";
      let result: BrowserToolResult;
      if (readOnly) {
        result = await invoke(automations, requestPermission, payload);
      } else {
        let queuedResult!: BrowserToolResult;
        const task = callChain.then(async () => {
          queuedResult = await invoke(automations, requestPermission, payload);
        });
        callChain = task.catch(() => undefined);
        await task;
        result = queuedResult;
      }
      response.statusCode = 200;
      response.end(JSON.stringify({ ok: true, result }));
    } catch (error) {
      response.statusCode = 400;
      response.end(
        JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  bridgeServer = server;
  const address = server.address() as AddressInfo;

  return {
    name: "browser",
    command: process.execPath,
    args: [mcpEntryPath],
    env: [
      { name: "ELECTRON_RUN_AS_NODE", value: "1" },
      {
        name: "GROK_GUI_BROWSER_BRIDGE_URL",
        value: `http://127.0.0.1:${address.port}/call`,
      },
      { name: "GROK_GUI_BROWSER_BRIDGE_TOKEN", value: token },
    ],
  };
}

export async function stopBrowserBridge(): Promise<void> {
  const server = bridgeServer;
  bridgeServer = null;
  if (!server) return;
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
