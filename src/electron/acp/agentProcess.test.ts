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
      "--no-memory",
      "--sandbox",
      "workspace",
      "agent",
      "stdio",
    ]);
  });

  it("makes the full-access no-sandbox boundary explicit", () => {
    expect(grokAgentStdioArgs("off")).toEqual([
      "--no-wait-for-background",
      "--no-memory",
      "--sandbox",
      "off",
      "agent",
      "stdio",
    ]);
  });

  it("force-disables cross-session memory for every GUI runtime", () => {
    expect(grokAgentStdioArgs("workspace")).toContain("--no-memory");
    expect(grokAgentStdioArgs("strict")).toContain("--no-memory");
  });
});
