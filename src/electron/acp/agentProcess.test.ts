import { describe, expect, it } from "vitest";
import { GROK_AGENT_STDIO_ARGS } from "./agentProcess";

describe("Grok ACP process arguments", () => {
  it("does not hold a completed turn open for background processes", () => {
    expect(GROK_AGENT_STDIO_ARGS).toEqual([
      "--no-wait-for-background",
      "agent",
      "stdio",
    ]);
  });
});
