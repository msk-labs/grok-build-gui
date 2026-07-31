import { describe, expect, it } from "vitest";
import { extractGrokLoginUrl } from "./grokAuthUrl";

describe("extractGrokLoginUrl", () => {
  it("extracts the loopback login URL printed after browser launch fails", () => {
    expect(
      extractGrokLoginUrl(
        "OIDC: failed to open browser\nOpen this URL to sign in:\n" +
          "https://accounts.x.ai/authorize?client_id=grok&state=abc\n",
      ),
    ).toBe(
      "https://accounts.x.ai/authorize?client_id=grok&state=abc",
    );
  });

  it("supports the device-auth fallback prompt", () => {
    expect(
      extractGrokLoginUrl(
        "Could not open a browser. Open this URL manually:\n" +
          "  https://accounts.x.ai/device?user_code=ABCD-1234\n",
      ),
    ).toBe("https://accounts.x.ai/device?user_code=ABCD-1234");
  });

  it("waits for a complete URL and ignores unrelated links", () => {
    expect(extractGrokLoginUrl("Open this URL to sign in:\nhttps://")).toBeNull();
    expect(
      extractGrokLoginUrl("See https://example.com before signing in."),
    ).toBeNull();
    expect(
      extractGrokLoginUrl("Open this URL to sign in:\nhttp://example.com"),
    ).toBeNull();
  });
});
