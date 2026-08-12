/**
 * Loopback relay that lets the agent use a ChatGPT subscription.
 *
 * The agent is configured with `base_url = http://127.0.0.1:<port>/v1`, so it
 * only ever speaks plain OpenAI Responses. This server attaches the OAuth
 * bearer plus the ChatGPT-specific headers, refreshes on 401, and streams the
 * SSE response straight back.
 *
 * Security: bound to 127.0.0.1 on an ephemeral port, and every request must
 * carry a per-launch bearer token so other local processes cannot borrow the
 * signed-in subscription.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { CHATGPT_MODELS, type ChatGptModel } from "./chatgptModels.js";
import { createCodexStreamAdapter } from "./codexStream.js";
import {
  extractRateLimitWindows,
  translateResponsesRequest,
} from "./codexTranslate.js";
import type { UsageWindow } from "./types.js";

const DEFAULT_UPSTREAM = "https://chatgpt.com/backend-api/codex";
/** Guard against a runaway request body; real prompts stay far below this. */
const MAX_BODY_BYTES = 32 * 1024 * 1024;
/** Enough to retain ChatGPT's structured JSON error without buffering prompts. */
const MAX_ERROR_BODY_BYTES = 256 * 1024;

/** The relay only posts to one fixed URL. Keeping this narrow lets Electron's
 * proxy-aware `net.fetch` and the standard fetch interoperate. */
export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export type RelayProxyDeps = {
  /** Current access token; may refresh internally when close to expiry. */
  getAccessToken: () => Promise<string>;
  /** Force a refresh after the upstream rejected the token. */
  refreshAccessToken: () => Promise<string>;
  getAccountId: () => string | null;
  models?: ChatGptModel[];
  upstreamUrl?: string;
  fetchImpl?: FetchLike;
  onUsage?: (windows: UsageWindow[]) => void;
  onLog?: (message: string) => void;
};

export type RelayProxy = {
  port: number;
  /** Bearer the agent must present. Regenerated on every launch. */
  token: string;
  /** Value to write into the agent's `base_url`. */
  baseUrl: string;
  close: () => Promise<void>;
};

type RelayDiagnostic = {
  at: string;
  request: {
    keys: string[];
    model: unknown;
    reasoning: unknown;
    include: unknown;
    toolTypes: string[];
    inputTypes: string[];
    inputRoles: string[];
  };
  upstream?: {
    status: number;
    error: string;
    requestId: string | null;
  };
};

function diagnosticForRequest(
  body: Record<string, unknown>,
): RelayDiagnostic {
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const input = Array.isArray(body.input) ? body.input : [];
  return {
    at: new Date().toISOString(),
    request: {
      keys: Object.keys(body).sort(),
      model: body.model,
      reasoning: body.reasoning,
      include: body.include,
      toolTypes: tools.map((tool) =>
        tool && typeof tool === "object"
          ? String((tool as Record<string, unknown>).type ?? "object")
          : typeof tool,
      ),
      inputTypes: input.map((item) => {
        if (!item || typeof item !== "object") return typeof item;
        const row = item as Record<string, unknown>;
        return String(row.type ?? row.role ?? "object");
      }),
      inputRoles: input.map((item) =>
        item && typeof item === "object"
          ? String((item as Record<string, unknown>).role ?? "")
          : "",
      ),
    },
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body), "utf8");
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(payload.byteLength),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function sendError(
  res: ServerResponse,
  status: number,
  message: string,
  code: string,
): void {
  sendJson(res, status, {
    error: { message, type: "grok_gui_relay_error", code },
  });
}

async function readUpstreamError(upstream: Response): Promise<Buffer> {
  if (!upstream.body) return Buffer.alloc(0);
  const reader = upstream.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (total < MAX_ERROR_BODY_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    const remaining = MAX_ERROR_BODY_BYTES - total;
    chunks.push(chunk.subarray(0, remaining));
    total += Math.min(chunk.byteLength, remaining);
  }
  if (total >= MAX_ERROR_BODY_BYTES) await reader.cancel();
  return Buffer.concat(chunks);
}

function upstreamErrorSummary(payload: Buffer): string {
  const raw = payload.toString("utf8").trim();
  if (!raw) return "empty response body";
  try {
    const parsed = JSON.parse(raw) as {
      error?: { message?: unknown; code?: unknown; type?: unknown } | unknown;
      detail?: unknown;
      message?: unknown;
    };
    if (parsed.error && typeof parsed.error === "object") {
      const error = parsed.error as Record<string, unknown>;
      return [error.type, error.code, error.message]
        .filter((part) => typeof part === "string" && part)
        .join(": ");
    }
    const message = parsed.detail ?? parsed.message ?? parsed.error;
    if (typeof message === "string") return message;
  } catch {
    // Keep plain-text upstream errors useful too.
  }
  return raw.slice(0, 1_000);
}

function bearerMatches(header: string | undefined, expected: string): boolean {
  if (!header) return false;
  const prefix = "bearer ";
  if (!header.toLowerCase().startsWith(prefix)) return false;
  const provided = Buffer.from(header.slice(prefix.length).trim());
  const wanted = Buffer.from(expected);
  if (provided.length !== wanted.length) return false;
  return timingSafeEqual(provided, wanted);
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.byteLength;
    if (total > MAX_BODY_BYTES) {
      throw new Error("Request body is too large.");
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

function upstreamHeaders(
  accessToken: string,
  accountId: string | null,
  sessionId: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    // Header set mirrors the Codex CLI; the backend rejects unknown clients.
    "OpenAI-Beta": "responses=experimental",
    originator: "codex_cli_rs",
    session_id: sessionId,
    "User-Agent": "codex_cli_rs/0.0.0 (grok-gui)",
  };
  if (accountId) headers["chatgpt-account-id"] = accountId;
  return headers;
}

export async function startRelayProxy(
  deps: RelayProxyDeps,
): Promise<RelayProxy> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const upstreamUrl = deps.upstreamUrl ?? DEFAULT_UPSTREAM;
  const models = deps.models ?? CHATGPT_MODELS;
  const token = randomBytes(32).toString("base64url");
  let lastDiagnostic: RelayDiagnostic | null = null;

  async function forwardResponses(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    let body: unknown;
    try {
      const raw = await readBody(req);
      body = raw.byteLength ? JSON.parse(raw.toString("utf8")) : {};
    } catch (error) {
      sendError(
        res,
        400,
        error instanceof Error ? error.message : "Invalid request body.",
        "invalid_request",
      );
      return;
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      sendError(res, 400, "Request body must be a JSON object.", "invalid_request");
      return;
    }

    const translated = translateResponsesRequest(
      body as Record<string, unknown>,
    );
    lastDiagnostic = diagnosticForRequest(translated);
    const payload = JSON.stringify(translated);
    const sessionId =
      typeof (body as Record<string, unknown>).session_id === "string"
        ? ((body as Record<string, unknown>).session_id as string)
        : randomBytes(16).toString("hex");

    const abort = new AbortController();
    const abortUpstream = () => {
      if (!res.writableEnded) abort.abort();
    };
    // `IncomingMessage.close` can describe a normally completed request body;
    // abort only when the caller actually abandons the request/response.
    req.once("aborted", abortUpstream);
    res.once("close", abortUpstream);

    let accessToken: string;
    try {
      accessToken = await deps.getAccessToken();
    } catch (error) {
      sendError(
        res,
        401,
        error instanceof Error ? error.message : "Not signed in to ChatGPT.",
        "not_signed_in",
      );
      return;
    }

    const call = (bearer: string) =>
      fetchImpl(`${upstreamUrl}/responses`, {
        method: "POST",
        headers: upstreamHeaders(bearer, deps.getAccountId(), sessionId),
        body: payload,
        signal: abort.signal,
      });

    /** Report a transport failure, unless the client simply hung up. */
    function failUpstream(error: unknown): void {
      if (abort.signal.aborted) {
        if (!res.writableEnded) res.destroy();
        return;
      }
      deps.onLog?.(
        `relay upstream request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      sendError(
        res,
        502,
        error instanceof Error ? error.message : "Upstream request failed.",
        "upstream_unreachable",
      );
    }

    let upstream: Response;
    try {
      upstream = await call(accessToken);
    } catch (error) {
      failUpstream(error);
      return;
    }

    if (upstream.status === 401) {
      // The token may have expired mid-flight; refresh once and replay.
      let refreshed: string;
      try {
        refreshed = await deps.refreshAccessToken();
      } catch (error) {
        // A dead grant is an auth problem, not a transport one — say so, so
        // the caller stops instead of retrying a request that cannot succeed.
        sendError(
          res,
          401,
          error instanceof Error
            ? error.message
            : "The ChatGPT session could not be refreshed.",
          "needs_relogin",
        );
        return;
      }
      try {
        upstream = await call(refreshed);
      } catch (error) {
        failUpstream(error);
        return;
      }
    }

    const usage = extractRateLimitWindows((name) =>
      upstream.headers.get(name),
    );
    if (usage.length > 0) deps.onUsage?.(usage);

    if (!upstream.ok) {
      const payload = await readUpstreamError(upstream);
      const summary = upstreamErrorSummary(payload);
      if (lastDiagnostic) {
        lastDiagnostic.upstream = {
          status: upstream.status,
          error: summary,
          requestId:
            upstream.headers.get("x-request-id") ??
            upstream.headers.get("request-id"),
        };
      }
      deps.onLog?.(
        `relay upstream HTTP ${upstream.status}: ${summary}`,
      );
      res.writeHead(upstream.status, {
        "Content-Type":
          upstream.headers.get("content-type") ??
          "application/json; charset=utf-8",
        "Content-Length": String(payload.byteLength),
        "Cache-Control": "no-store",
      });
      res.end(payload);
      return;
    }

    res.writeHead(upstream.status, {
      "Content-Type":
        upstream.headers.get("content-type") ?? "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    });

    if (!upstream.body) {
      res.end();
      return;
    }

    try {
      // `upstream.body` is a web stream; the DOM and node:stream/web types for
      // it differ, so narrow to the Node shape `fromWeb` expects.
      await pipeline(
        Readable.fromWeb(upstream.body as NodeReadableStream<Uint8Array>),
        createCodexStreamAdapter(),
        res,
      );
    } catch (error) {
      if (!abort.signal.aborted) {
        deps.onLog?.(
          `relay stream error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (!res.writableEnded) res.destroy();
    }
  }

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      if (req.method === "GET" && url.pathname === "/healthz") {
        sendJson(res, 200, { ok: true });
        return;
      }

      if (!bearerMatches(req.headers.authorization, token)) {
        sendError(res, 401, "Missing or invalid relay token.", "unauthorized");
        return;
      }

      if (req.method === "GET" && url.pathname === "/v1/models") {
        sendJson(res, 200, {
          object: "list",
          data: models.map((model) => ({
            id: model.id,
            object: "model",
            owned_by: "openai",
            context_window: model.contextWindow,
          })),
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/v1/diagnostics") {
        sendJson(res, 200, { last: lastDiagnostic });
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/responses") {
        await forwardResponses(req, res);
        return;
      }

      sendError(res, 404, `Unsupported relay route: ${url.pathname}`, "not_found");
    })().catch((error: unknown) => {
      deps.onLog?.(
        `relay handler error: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (!res.headersSent) {
        sendError(res, 500, "Relay failed to handle the request.", "internal");
      } else if (!res.writableEnded) {
        res.destroy();
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Relay proxy did not bind to a TCP port.");
  }

  return {
    port: address.port,
    token,
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
