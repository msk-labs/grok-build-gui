import { describe, expect, it } from "vitest";
import type { ToolCallItem } from "../types/chat";
import { classifyTool, toolTextOutputs } from "./toolPresentation";

function tool(overrides: Partial<ToolCallItem>): ToolCallItem {
  return {
    id: "tool-1",
    title: "Tool call",
    status: "completed",
    ...overrides,
  };
}

describe("classifyTool", () => {
  it("prefers structured content over the title", () => {
    expect(
      classifyTool(
        tool({
          title: "Run helper",
          content: [{ type: "diff", path: "a.ts", oldText: "a", newText: "b" }],
        }),
      ),
    ).toBe("edit");
  });

  it("maps ACP kinds to stable presentation categories", () => {
    expect(classifyTool(tool({ kind: "execute" }))).toBe("command");
    expect(classifyTool(tool({ kind: "read" }))).toBe("read");
    expect(classifyTool(tool({ kind: "search" }))).toBe("search");
    expect(classifyTool(tool({ kind: "fetch" }))).toBe("web");
    expect(classifyTool(tool({ kind: "think" }))).toBe("reasoning");
  });

  it("has a safe fallback for unknown tools", () => {
    expect(classifyTool(tool({ title: "Custom integration" }))).toBe("other");
  });
});

describe("toolTextOutputs", () => {
  it("uses structured output and suppresses generated-media metadata", () => {
    const item = tool({
      content: [
        { type: "content", text: "result" },
        {
          type: "content",
          text: '{"type":"ImageGen","path":"/tmp/result.png"}',
        },
      ],
    });
    expect(toolTextOutputs(item)).toEqual(["result"]);
  });
});
