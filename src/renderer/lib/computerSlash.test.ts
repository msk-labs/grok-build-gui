import { describe, expect, it } from "vitest";
import { parseComputerSlash } from "./computerSlash";

describe("parseComputerSlash", () => {
  it("routes a desktop task through the Open Computer Use protocol", () => {
    const result = parseComputerSlash(
      "/computer replace the Notepad contents with hello",
    );

    expect(result.kind).toBe("prompt");
    if (result.kind !== "prompt") return;
    expect(result.agentText).toContain("Use the Open Computer Use MCP tools");
    expect(result.agentText).toContain(
      "Do not claim completion from an action result alone",
    );
    expect(result.agentText).toContain(
      "terminal tool for command execution",
    );
    expect(
      result.agentText.endsWith(
        "replace the Notepad contents with hello",
      ),
    ).toBe(true);
  });

  it("asks for a target when submitted without a task", () => {
    const result = parseComputerSlash("  /computer  ");

    expect(result.kind).toBe("prompt");
    if (result.kind !== "prompt") return;
    expect(result.agentText).toContain("List the available applications");
    expect(result.agentText).toContain("ask which application I want to control");
  });

  it.each([
    "",
    "control the computer",
    "/computerize",
    "/computer-use",
    "prefix /computer",
  ])("does not consume non-computer command %s", (input) => {
    expect(parseComputerSlash(input)).toEqual({ kind: "none" });
  });
});
