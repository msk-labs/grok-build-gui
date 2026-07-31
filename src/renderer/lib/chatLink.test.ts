import { describe, expect, it } from "vitest";
import { classifyChatLink, isSafeExternalUrl } from "./chatLink";

describe("classifyChatLink", () => {
  it("allows normal external links", () => {
    expect(classifyChatLink("https://example.com/docs")).toEqual({
      kind: "external",
      href: "https://example.com/docs",
    });
    expect(isSafeExternalUrl("mailto:team@example.com")).toBe(true);
  });

  it("blocks executable URL schemes", () => {
    expect(classifyChatLink("javascript:alert(1)")).toEqual({ kind: "blocked" });
    expect(classifyChatLink("data:text/html,hello")).toEqual({ kind: "blocked" });
  });

  it("treats relative and file URLs as file references", () => {
    expect(classifyChatLink("src/App.tsx")).toEqual({
      kind: "file",
      path: "src/App.tsx",
    });
    expect(classifyChatLink("file:///tmp/a%20b.ts")).toEqual({
      kind: "file",
      path: "/tmp/a b.ts",
    });
  });
});
