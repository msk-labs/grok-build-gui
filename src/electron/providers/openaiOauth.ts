/**
 * ChatGPT subscription sign-in (OAuth 2.0 + PKCE).
 *
 * Mirrors the public Codex CLI client registration: the redirect URI is fixed
 * to loopback port 1455, so only one sign-in can run at a time on a machine.
 * Tokens never leave the main process — see `tokenStore.ts`.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import { decodeJwtPayload } from "./jwt.js";
import type { TokenSet } from "./types.js";

export const OPENAI_OAUTH = {
  /** OpenAI's public Codex client registration; not configurable. */
  clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
  authorizeUrl: "https://auth.openai.com/oauth/authorize",
  tokenUrl: "https://auth.openai.com/oauth/token",
  /** Registered with OpenAI — the port cannot be changed. */
  redirectPort: 1455,
  redirectPath: "/auth/callback",
  scope: "openid profile email offline_access",
} as const;

export const OPENAI_REDIRECT_URI =
  `http://localhost:${OPENAI_OAUTH.redirectPort}${OPENAI_OAUTH.redirectPath}` as const;

const LOGIN_TIMEOUT_MS = 5 * 60_000;

export type PkcePair = {
  verifier: string;
  challenge: string;
};

function base64Url(buf: Buffer): string {
  return buf.toString("base64url");
}

/** RFC 7636 S256 pair; the verifier is 43 characters of base64url entropy. */
export function createPkcePair(): PkcePair {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function createState(): string {
  return base64Url(randomBytes(24));
}

export function buildAuthorizeUrl(options: {
  challenge: string;
  state: string;
}): string {
  const url = new URL(OPENAI_OAUTH.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", OPENAI_OAUTH.clientId);
  url.searchParams.set("redirect_uri", OPENAI_REDIRECT_URI);
  url.searchParams.set("scope", OPENAI_OAUTH.scope);
  url.searchParams.set("code_challenge", options.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", options.state);
  // Both flags mirror the Codex CLI request. `id_token_add_organizations`
  // is what makes the id_token carry the ChatGPT account/plan claims.
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  return url.toString();
}

export type CallbackResult =
  | { kind: "code"; code: string; state: string }
  | { kind: "error"; message: string }
  | { kind: "ignored" };

/** Classify a request that arrived on the loopback callback server. */
export function parseCallbackRequest(rawUrl: string): CallbackResult {
  let url: URL;
  try {
    url = new URL(rawUrl, `http://localhost:${OPENAI_OAUTH.redirectPort}`);
  } catch {
    return { kind: "ignored" };
  }
  if (url.pathname !== OPENAI_OAUTH.redirectPath) return { kind: "ignored" };

  const error = url.searchParams.get("error");
  if (error) {
    const description = url.searchParams.get("error_description");
    return { kind: "error", message: description?.trim() || error };
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return { kind: "error", message: "Sign-in callback was missing its code." };
  }
  return { kind: "code", code, state };
}

/** Constant-time compare so a callback cannot probe the state value. */
export function statesMatch(expected: string, received: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export type ChatGptIdentity = {
  email: string | null;
  accountId: string | null;
  planType: string | null;
};

const AUTH_CLAIM = "https://api.openai.com/auth";

function readAuthClaim(
  payload: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const claim = payload?.[AUTH_CLAIM];
  if (!claim || typeof claim !== "object" || Array.isArray(claim)) return null;
  return claim as Record<string, unknown>;
}

function readString(
  source: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = source?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Pull the ChatGPT account id / plan out of the issued tokens. The claim rides
 * on the id_token when `id_token_add_organizations` was requested, and on the
 * access token otherwise, so both are consulted.
 */
export function readIdentity(tokens: TokenSet): ChatGptIdentity {
  const idPayload = tokens.idToken ? decodeJwtPayload(tokens.idToken) : null;
  const accessPayload = decodeJwtPayload(tokens.accessToken);
  const idClaim = readAuthClaim(idPayload);
  const accessClaim = readAuthClaim(accessPayload);

  return {
    email:
      readString(idPayload, "email") ?? readString(accessPayload, "email"),
    accountId:
      readString(idClaim, "chatgpt_account_id") ??
      readString(accessClaim, "chatgpt_account_id"),
    planType:
      readString(idClaim, "chatgpt_plan_type") ??
      readString(accessClaim, "chatgpt_plan_type"),
  };
}

export function formatPlanLabel(planType: string | null): string {
  if (!planType) return "ChatGPT";
  const key = planType.toLowerCase().replace(/[\s-]+/g, "_");
  const map: Record<string, string> = {
    free: "ChatGPT Free",
    plus: "ChatGPT Plus",
    pro: "ChatGPT Pro",
    business: "ChatGPT Business",
    team: "ChatGPT Team",
    enterprise: "ChatGPT Enterprise",
    edu: "ChatGPT Edu",
  };
  return (
    map[key] ??
    `ChatGPT ${planType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}`
  );
}

/** Plans whose ChatGPT subscription does not include Codex model access. */
const PLANS_WITHOUT_CODEX = new Set(["free", "anonymous"]);

/**
 * Whether the plan may use Codex models. Unknown plan names fail open — a new
 * paid tier should not be locked out by a stale list; the upstream still has
 * the final say.
 */
export function planSupportsCodex(planType: string | null): boolean {
  if (!planType) return true;
  return !PLANS_WITHOUT_CODEX.has(planType.toLowerCase().replace(/[\s-]+/g, "_"));
}

export class OAuthError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "OAuthError";
    this.code = code;
  }
}

type TokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  id_token?: unknown;
  error?: unknown;
  error_description?: unknown;
};

/** Shape a token endpoint response, raising `OAuthError` on rejection. */
export function parseTokenResponse(
  status: number,
  body: unknown,
  previous?: TokenSet,
): TokenSet {
  const data = (body ?? {}) as TokenResponse;
  if (status < 200 || status >= 300) {
    const code =
      typeof data.error === "string" ? data.error : `http_${status}`;
    const message =
      (typeof data.error_description === "string" && data.error_description) ||
      (typeof data.error === "string" && data.error) ||
      `Token request failed (${status}).`;
    throw new OAuthError(code, message);
  }
  const accessToken =
    typeof data.access_token === "string" ? data.access_token : null;
  if (!accessToken) {
    throw new OAuthError("invalid_response", "Token response had no access token.");
  }
  const refreshToken =
    typeof data.refresh_token === "string"
      ? data.refresh_token
      : (previous?.refreshToken ?? null);
  if (!refreshToken) {
    throw new OAuthError(
      "invalid_response",
      "Token response had no refresh token.",
    );
  }
  return {
    accessToken,
    refreshToken,
    idToken:
      typeof data.id_token === "string"
        ? data.id_token
        : (previous?.idToken ?? null),
  };
}

export type FetchLike = typeof fetch;

async function postForm(
  url: string,
  form: Record<string, string>,
  fetchImpl: FetchLike,
): Promise<{ status: number; body: unknown }> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(form).toString(),
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

export async function exchangeAuthorizationCode(
  options: { code: string; verifier: string },
  fetchImpl: FetchLike = fetch,
): Promise<TokenSet> {
  const { status, body } = await postForm(
    OPENAI_OAUTH.tokenUrl,
    {
      grant_type: "authorization_code",
      code: options.code,
      redirect_uri: OPENAI_REDIRECT_URI,
      client_id: OPENAI_OAUTH.clientId,
      code_verifier: options.verifier,
    },
    fetchImpl,
  );
  return parseTokenResponse(status, body);
}

export async function refreshAccessToken(
  previous: TokenSet,
  fetchImpl: FetchLike = fetch,
): Promise<TokenSet> {
  const { status, body } = await postForm(
    OPENAI_OAUTH.tokenUrl,
    {
      grant_type: "refresh_token",
      refresh_token: previous.refreshToken,
      client_id: OPENAI_OAUTH.clientId,
      scope: OPENAI_OAUTH.scope,
    },
    fetchImpl,
  );
  return parseTokenResponse(status, body, previous);
}

const CALLBACK_PAGE = `<!doctype html>
<meta charset="utf-8">
<title>Signed in</title>
<style>
  body { font: 16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
         color: #2a2c2f; display: grid; place-items: center; height: 100vh; margin: 0; }
  p { color: rgba(42,44,47,.7); }
</style>
<div style="text-align:center">
  <h1>Signed in</h1>
  <p>You can close this tab and return to the app.</p>
</div>`;

export type LoginDeps = {
  openExternal: (url: string) => Promise<void>;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
};

export type LoginHandle = {
  /** Resolves with the issued tokens, or rejects with `OAuthError`. */
  completed: Promise<TokenSet>;
  cancel: () => void;
};

/**
 * Run the browser sign-in. Binds the loopback callback server first so a busy
 * port fails before a browser tab is opened.
 */
export function startLogin(deps: LoginDeps): LoginHandle {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const { verifier, challenge } = createPkcePair();
  const state = createState();

  let server: Server | null = null;
  let timer: NodeJS.Timeout | null = null;
  let settled = false;
  let cancelRef: () => void = () => {};

  const completed = new Promise<TokenSet>((resolve, reject) => {
    function finish(action: () => void): void {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      timer = null;
      server?.close();
      server = null;
      action();
    }

    const httpServer = createServer((req, res) => {
      const result = parseCallbackRequest(req.url ?? "");
      if (result.kind === "ignored") {
        res.writeHead(404).end();
        return;
      }
      if (result.kind === "error") {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(result.message);
        finish(() => reject(new OAuthError("access_denied", result.message)));
        return;
      }
      if (!statesMatch(state, result.state)) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("State mismatch.");
        finish(() =>
          reject(
            new OAuthError(
              "state_mismatch",
              "Sign-in callback did not match this request.",
            ),
          ),
        );
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(CALLBACK_PAGE);

      exchangeAuthorizationCode({ code: result.code, verifier }, fetchImpl).then(
        (tokens) => finish(() => resolve(tokens)),
        (error: unknown) => finish(() => reject(error)),
      );
    });
    server = httpServer;

    httpServer.on("error", (error: NodeJS.ErrnoException) => {
      const message =
        error.code === "EADDRINUSE"
          ? `Port ${OPENAI_OAUTH.redirectPort} is already in use. Close any other ChatGPT or Codex sign-in and try again.`
          : `Could not start the sign-in listener: ${error.message}`;
      finish(() => reject(new OAuthError(error.code ?? "listen_failed", message)));
    });

    httpServer.listen(OPENAI_OAUTH.redirectPort, "127.0.0.1", () => {
      timer = setTimeout(() => {
        finish(() =>
          reject(new OAuthError("timeout", "Sign-in timed out. Please try again.")),
        );
      }, deps.timeoutMs ?? LOGIN_TIMEOUT_MS);
      timer.unref?.();

      deps.openExternal(buildAuthorizeUrl({ challenge, state })).catch(
        (error: unknown) => {
          finish(() =>
            reject(
              new OAuthError(
                "browser_failed",
                error instanceof Error
                  ? `Could not open the sign-in page: ${error.message}`
                  : "Could not open the sign-in page in your browser.",
              ),
            ),
          );
        },
      );
    });

    // Surface cancellation through the same settle path.
    cancelRef = () =>
      finish(() => reject(new OAuthError("cancelled", "Sign-in was canceled.")));
  });

  return { completed, cancel: () => cancelRef() };
}
