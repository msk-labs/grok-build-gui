import { describe, expect, it } from "vitest";
import {
  BUILTIN_SLASH_COMMANDS,
  normalizeAgentSlashCommands,
} from "./slashCommands";

describe("ACP slash commands", () => {
  it("offers /goal before the first session publishes capabilities", () => {
    expect(BUILTIN_SLASH_COMMANDS).toContainEqual(
      expect.objectContaining({
        name: "goal",
        inputHint: expect.stringContaining("<objective>"),
      }),
    );
  });

  it("normalizes the agent command list and preserves input hints", () => {
    expect(
      normalizeAgentSlashCommands([
        {
          name: "goal",
          description: "Set, manage, or check an autonomous goal",
          input: {
            hint:
              "<objective> [--budget <tokens>] | status | pause | resume | clear",
          },
        },
        { name: "../unsafe", description: "bad" },
      ]),
    ).toEqual([
      {
        name: "goal",
        description: "Set, manage, or check an autonomous goal",
        inputHint:
          "<objective> [--budget <tokens>] | status | pause | resume | clear",
        source: "agent",
        plugin: null,
      },
    ]);
  });
});
