import { describe, expect, it } from "vitest";
import { modelConfigKey } from "../../electron/providers/chatgptModels";
import type { ModelInfo } from "../../electron/preload";
import {
  OAUTH_MODEL_PREFIX,
  groupModels,
  modelGroupId,
} from "./modelGroups";

function model(modelId: string, name = modelId): ModelInfo {
  return { modelId, name };
}

describe("modelGroupId", () => {
  it("matches the keys the main process actually writes", () => {
    // Guards the one piece of knowledge duplicated across the process boundary.
    expect(modelConfigKey("gpt-5.3-codex").startsWith(OAUTH_MODEL_PREFIX)).toBe(
      true,
    );
    expect(modelGroupId(modelConfigKey("gpt-5.3-codex"))).toBe("oauth");
  });

  it("treats anything unprefixed as built-in", () => {
    expect(modelGroupId("grok-4.5")).toBe("builtin");
    expect(modelGroupId("grok-build")).toBe("builtin");
    expect(modelGroupId("custom-deepseek")).toBe("custom");
  });
});

describe("groupModels", () => {
  it("orders built-in, then OAuth, then custom", () => {
    const groups = groupModels([
      model("custom-deepseek", "DeepSeek V4"),
      model("chatgpt-gpt-5-3-codex", "GPT-5.3 Codex (ChatGPT)"),
      model("grok-4.5", "Grok 4.5"),
    ]);

    expect(groups.map((g) => g.id)).toEqual(["builtin", "oauth", "custom"]);
    expect(groups[1]!.models[0]!.name).toBe("GPT-5.3 Codex (ChatGPT)");
  });

  it("keeps the agent's order within a group", () => {
    const groups = groupModels([
      model("grok-4.5"),
      model("grok-build"),
      model("grok-3"),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.models.map((m) => m.modelId)).toEqual([
      "grok-4.5",
      "grok-build",
      "grok-3",
    ]);
  });

  it("omits groups with no models", () => {
    expect(groupModels([model("grok-4.5")]).map((g) => g.id)).toEqual([
      "builtin",
    ]);
    expect(groupModels([])).toEqual([]);
  });
});
