import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  OAuthError,
  OPENAI_OAUTH,
  OPENAI_REDIRECT_URI,
  buildAuthorizeUrl,
  createPkcePair,
  formatPlanLabel,
  parseCallbackRequest,
  parseTokenResponse,
  planSupportsCodex,
  readIdentity,
  statesMatch,
} from "./openaiOauth";

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode(payload)}.sig`;
}

describe("createPkcePair", () => {
  it("derives an S256 challenge from the verifier", () => {
    const { verifier, challenge } = createPkcePair();
    expect(verifier).toHaveLength(43);
    expect(challenge).toBe(
      createHash("sha256").update(verifier).digest("base64url"),
    );
  });

  it("does not repeat verifiers", () => {
    expect(createPkcePair().verifier).not.toBe(createPkcePair().verifier);
  });
});

describe("buildAuthorizeUrl", () => {
  it("requests the registered loopback redirect with PKCE", () => {
    const url = new URL(
      buildAuthorizeUrl({ challenge: "chal", state: "st" }),
    );
    expect(url.origin + url.pathname).toBe(OPENAI_OAUTH.authorizeUrl);
    expect(url.searchParams.get("client_id")).toBe(OPENAI_OAUTH.clientId);
    expect(url.searchParams.get("redirect_uri")).toBe(OPENAI_REDIRECT_URI);
    expect(url.searchParams.get("code_challenge")).toBe("chal");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("id_token_add_organizations")).toBe("true");
  });
});

describe("parseCallbackRequest", () => {
  it("reads the code and state from the callback path", () => {
    expect(parseCallbackRequest("/auth/callback?code=abc&state=xyz")).toEqual({
      kind: "code",
      code: "abc",
      state: "xyz",
    });
  });

  it("surfaces a denied authorization", () => {
    expect(
      parseCallbackRequest(
        "/auth/callback?error=access_denied&error_description=User%20said%20no",
      ),
    ).toEqual({ kind: "error", message: "User said no" });
  });

  it("treats a callback without a code as an error", () => {
    expect(parseCallbackRequest("/auth/callback?state=xyz").kind).toBe("error");
  });

  it("ignores unrelated paths such as favicon probes", () => {
    expect(parseCallbackRequest("/favicon.ico").kind).toBe("ignored");
    expect(parseCallbackRequest("").kind).toBe("ignored");
  });
});

describe("statesMatch", () => {
  it("accepts an identical state and rejects anything else", () => {
    expect(statesMatch("abcd", "abcd")).toBe(true);
    expect(statesMatch("abcd", "abce")).toBe(false);
    expect(statesMatch("abcd", "abc")).toBe(false);
  });
});

describe("parseTokenResponse", () => {
  it("returns the issued token set", () => {
    expect(
      parseTokenResponse(200, {
        access_token: "at",
        refresh_token: "rt",
        id_token: "it",
      }),
    ).toEqual({ accessToken: "at", refreshToken: "rt", idToken: "it" });
  });

  it("keeps the previous refresh and id tokens when the response omits them", () => {
    expect(
      parseTokenResponse(
        200,
        { access_token: "at2" },
        { accessToken: "at", refreshToken: "rt", idToken: "it" },
      ),
    ).toEqual({ accessToken: "at2", refreshToken: "rt", idToken: "it" });
  });

  it("raises the upstream error code so a dead grant can be detected", () => {
    try {
      parseTokenResponse(400, {
        error: "invalid_grant",
        error_description: "refresh token expired",
      });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(OAuthError);
      expect((error as OAuthError).code).toBe("invalid_grant");
      expect((error as OAuthError).message).toBe("refresh token expired");
    }
  });

  it("rejects a success response with no access token", () => {
    expect(() => parseTokenResponse(200, { refresh_token: "rt" })).toThrow(
      OAuthError,
    );
  });
});

describe("readIdentity", () => {
  const claim = "https://api.openai.com/auth";

  it("prefers the id_token claims", () => {
    expect(
      readIdentity({
        accessToken: jwt({
          email: "stale@example.com",
          [claim]: { chatgpt_account_id: "acc-old" },
        }),
        refreshToken: "rt",
        idToken: jwt({
          email: "user@example.com",
          [claim]: { chatgpt_account_id: "acc-1", chatgpt_plan_type: "pro" },
        }),
      }),
    ).toEqual({
      email: "user@example.com",
      accountId: "acc-1",
      planType: "pro",
    });
  });

  it("falls back to the access token when no id_token was issued", () => {
    expect(
      readIdentity({
        accessToken: jwt({
          email: "user@example.com",
          [claim]: { chatgpt_account_id: "acc-2", chatgpt_plan_type: "plus" },
        }),
        refreshToken: "rt",
        idToken: null,
      }),
    ).toEqual({
      email: "user@example.com",
      accountId: "acc-2",
      planType: "plus",
    });
  });

  it("tolerates tokens without the ChatGPT claim", () => {
    expect(
      readIdentity({ accessToken: "not-a-jwt", refreshToken: "rt", idToken: null }),
    ).toEqual({ email: null, accountId: null, planType: null });
  });
});

describe("planSupportsCodex", () => {
  it("rejects plans known to exclude Codex", () => {
    expect(planSupportsCodex("free")).toBe(false);
    expect(planSupportsCodex("Free")).toBe(false);
    expect(planSupportsCodex("anonymous")).toBe(false);
  });

  it("accepts paid plans", () => {
    for (const plan of ["plus", "pro", "team", "business", "enterprise"]) {
      expect(planSupportsCodex(plan)).toBe(true);
    }
  });

  it("fails open for unknown or missing plans", () => {
    // A newly introduced paid tier must not be locked out by a stale list.
    expect(planSupportsCodex("plus_v2")).toBe(true);
    expect(planSupportsCodex(null)).toBe(true);
  });
});

describe("formatPlanLabel", () => {
  it("maps known plans and titles unknown ones", () => {
    expect(formatPlanLabel("plus")).toBe("ChatGPT Plus");
    expect(formatPlanLabel("pro")).toBe("ChatGPT Pro");
    expect(formatPlanLabel("some_new_plan")).toBe("ChatGPT Some New Plan");
    expect(formatPlanLabel(null)).toBe("ChatGPT");
  });
});
