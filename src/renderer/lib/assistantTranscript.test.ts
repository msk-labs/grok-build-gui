import { describe, expect, it } from "vitest";
import { formatAssistantTranscript } from "./assistantTranscript";
import type { AssistantBlock } from "../types/chat";

describe("formatAssistantTranscript", () => {
  it("flattens text, thought, and tool blocks in order without UI chrome", () => {
    const blocks: AssistantBlock[] = [
      { type: "thought", id: "t1", text: "planning next step" },
      {
        type: "tool",
        tool: {
          id: "tc1",
          title: "Read foo.ts",
          status: "completed",
          kind: "read",
          locations: [{ path: "/tmp/foo.ts", line: 3 }],
          content: [{ type: "content", text: "const x = 1;" }],
        },
      },
      { type: "text", id: "m1", text: "Here is the **answer**." },
    ];

    const out = formatAssistantTranscript(blocks);
    expect(out).toContain("planning next step");
    expect(out).toContain("Read foo.ts (completed)");
    expect(out).toContain("kind: read");
    expect(out).toContain("/tmp/foo.ts:3");
    expect(out).toContain("const x = 1;");
    expect(out).toContain("Here is the **answer**.");
    // Blocks separated by blank lines, chronological.
    expect(out.indexOf("planning")).toBeLessThan(out.indexOf("Read foo"));
    expect(out.indexOf("Read foo")).toBeLessThan(out.indexOf("**answer**"));
  });

  it("includes full diffs in plain text", () => {
    const blocks: AssistantBlock[] = [
      {
        type: "tool",
        tool: {
          id: "tc2",
          title: "Edit a.txt",
          status: "completed",
          content: [
            {
              type: "diff",
              path: "a.txt",
              oldText: "old",
              newText: "new",
            },
          ],
        },
      },
    ];
    const out = formatAssistantTranscript(blocks);
    expect(out).toContain("diff a.txt");
    expect(out).toContain("old");
    expect(out).toContain("new");
  });
});
