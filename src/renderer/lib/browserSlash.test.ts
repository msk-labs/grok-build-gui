import { describe, expect, it } from "vitest";
import { parseBrowserSlash } from "./browserSlash";

describe("parseBrowserSlash", () => {
  it.each(["/browser", "  /browser  ", "/browser on", "/browser open", "/browser show"])(
    "opens the embedded browser for %s",
    (input) => {
      expect(parseBrowserSlash(input)).toEqual({ kind: "open" });
    },
  );

  it.each(["/browser off", "/browser close", "/browser hide"])(
    "closes the embedded browser for %s",
    (input) => {
      expect(parseBrowserSlash(input)).toEqual({ kind: "close" });
    },
  );

  it("normalizes a www URL and preserves the remaining agent prompt", () => {
    expect(
      parseBrowserSlash("/browser www.example.com fill the search field"),
    ).toEqual({
      kind: "open",
      url: "https://www.example.com",
      agentText: "fill the search field",
    });
  });

  it.each([
    [
      "/browser https://example.com/path?q=1",
      { kind: "open", url: "https://example.com/path?q=1", agentText: undefined },
    ],
    [
      "/browser example.com/path click Sign in",
      {
        kind: "open",
        url: "example.com/path",
        agentText: "click Sign in",
      },
    ],
    [
      "/browser inspect the current page",
      { kind: "open", agentText: "inspect the current page" },
    ],
  ])("routes %s", (input, expected) => {
    expect(parseBrowserSlash(input)).toEqual(expected);
  });

  it.each([
    "",
    "open the browser",
    "/browserish",
    "/browser-off",
    "prefix /browser",
  ])("does not consume non-browser command %s", (input) => {
    expect(parseBrowserSlash(input)).toEqual({ kind: "none" });
  });
});
