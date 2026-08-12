import { describe, expect, it } from "vitest";
import {
  DEFAULT_GROK_SANDBOX_PROFILE,
  grokAgentStdioArgs,
} from "./agentProcess";

describe("Grok ACP process arguments", () => {
  it("starts ordinary runtimes inside the workspace sandbox", () => {
    expect(DEFAULT_GROK_SANDBOX_PROFILE).toBe("workspace");
    expect(grokAgentStdioArgs(DEFAULT_GROK_SANDBOX_PROFILE)).toEqual([
      "--no-wait-for-background",
      "--sandbox",
      "workspace",
      "agent",
      "stdio",
    ]);
  });

  it("makes the full-access no-sandbox boundary explicit", () => {
    expect(grokAgentStdioArgs("off")).toEqual([
      "--no-wait-for-background",
      "--sandbox",
      "off",
      "agent",
      "stdio",
    ]);
  });
});
