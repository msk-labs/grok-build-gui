import { describe, expect, it } from "vitest";
import {
  CHAT_HIGHLIGHT_LANGUAGE_COUNT,
  highlightCode,
} from "./highlightCode";

describe("chat syntax highlighting", () => {
  it("registers the Codex-sized language set", () => {
    expect(CHAT_HIGHLIGHT_LANGUAGE_COUNT).toBe(45);
  });

  it("supports grammar aliases such as tsx and wolfram", () => {
    expect(highlightCode("const view = <main />", "tsx")?.html).toContain(
      "hljs-keyword",
    );
    expect(highlightCode("Plot[x, {x, 0, 1}]", "wolfram")).not.toBeNull();
  });

  it("leaves unknown explicit languages plain", () => {
    expect(highlightCode("some code", "not-a-real-language")).toBeNull();
  });

  it("escapes source markup in highlighted output", () => {
    const result = highlightCode("<script>alert(1)</script>", "html");
    expect(result?.html).toContain("&lt;");
    expect(result?.html).not.toContain("<script>");
  });
});
