import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyManagedBlock,
  renderManagedBlock,
  syncManagedModels,
  tomlString,
  type ManagedModel,
} from "./customModels";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});

function tempConfig(contents?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-gui-config-"));
  dirs.push(dir);
  const file = path.join(dir, "config.toml");
  if (contents !== undefined) fs.writeFileSync(file, contents, "utf8");
  return file;
}

const model: ManagedModel = {
  key: "chatgpt-gpt-5-3-codex",
  model: "gpt-5.3-codex",
  name: "GPT-5.3 Codex (ChatGPT)",
  baseUrl: "http://127.0.0.1:51234/v1",
  apiKey: "relay-token",
  apiBackend: "responses",
  contextWindow: 272_000,
  maxCompletionTokens: 128_000,
};

const USER_CONFIG = `# my settings
[models]
default = "grok-build"

[model.local-llama]
model = "llama-3.1-70b"
base_url = "http://localhost:8080/v1"
`;

describe("tomlString", () => {
  it("escapes quotes, backslashes, and control characters", () => {
    expect(tomlString('a"b')).toBe('"a\\"b"');
    expect(tomlString("a\\b")).toBe('"a\\\\b"');
    expect(tomlString("a\nb")).toBe('"a\\nb"');
    expect(tomlString("ab")).toBe('"a\\u0001b"');
  });
});

describe("renderManagedBlock", () => {
  it("emits a model section the agent can load", () => {
    const block = renderManagedBlock([model]);
    expect(block).toContain("[model.chatgpt-gpt-5-3-codex]");
    expect(block).toContain('model = "gpt-5.3-codex"');
    expect(block).toContain('base_url = "http://127.0.0.1:51234/v1"');
    expect(block).toContain('api_backend = "responses"');
    expect(block).toContain("context_window = 272000");
    expect(block).toContain("max_completion_tokens = 128000");
  });

  it("declares reasoning efforts so the agent offers the control", () => {
    const block = renderManagedBlock([
      { ...model, reasoningEfforts: ["high", "medium", "low"] },
    ]);

    expect(block).toContain("supports_reasoning_effort = true");
    // First entry is the default; values double as ids for the agent's menu.
    expect(block).toContain(
      'reasoning_efforts = [{ id = "high", value = "high", label = "High", default = true }, ' +
        '{ id = "medium", value = "medium", label = "Medium", default = false }, ' +
        '{ id = "low", value = "low", label = "Low", default = false }]',
    );
  });

  it("says nothing about reasoning effort when the endpoint did not opt in", () => {
    const block = renderManagedBlock([model]);
    expect(block).not.toContain("reasoning_effort");
  });

  it("omits an unset output cap", () => {
    const { maxCompletionTokens: _drop, ...rest } = model;
    expect(renderManagedBlock([rest])).not.toContain("max_completion_tokens");
  });
});

describe("applyManagedBlock", () => {
  it("appends to a config that has no managed region", () => {
    const result = applyManagedBlock(USER_CONFIG, renderManagedBlock([model]));
    expect(result).toContain('default = "grok-build"');
    expect(result).toContain("[model.local-llama]");
    expect(result).toContain("[model.chatgpt-gpt-5-3-codex]");
  });

  it("replaces the previous managed region in place", () => {
    const first = applyManagedBlock(USER_CONFIG, renderManagedBlock([model]));
    const second = applyManagedBlock(
      first,
      renderManagedBlock([
        { ...model, baseUrl: "http://127.0.0.1:60000/v1", apiKey: "new-token" },
      ]),
    );

    expect(second).toContain("http://127.0.0.1:60000/v1");
    expect(second).not.toContain("51234");
    expect(second).not.toContain("relay-token");
    // Exactly one managed region, and the user's config still intact.
    expect(second.match(/grok-gui managed models — edited/g)).toHaveLength(1);
    expect(second).toContain("[model.local-llama]");
  });

  it("preserves user content written after the managed region", () => {
    const withBlock = applyManagedBlock("", renderManagedBlock([model]));
    const appended = `${withBlock}\n[model.later]\nmodel = "later"\n`;
    const result = applyManagedBlock(appended, renderManagedBlock([model]));

    expect(result).toContain("[model.later]");
    expect(result.indexOf("[model.later]")).toBeGreaterThan(
      result.indexOf("[model.chatgpt-gpt-5-3-codex]"),
    );
  });

  it("removes the region on sign-out and leaves the rest alone", () => {
    const withBlock = applyManagedBlock(USER_CONFIG, renderManagedBlock([model]));
    const cleared = applyManagedBlock(withBlock, null);

    expect(cleared).not.toContain("chatgpt-gpt-5-3-codex");
    expect(cleared).not.toContain("grok-gui managed");
    expect(cleared).toContain('default = "grok-build"');
    expect(cleared).toContain("[model.local-llama]");
  });

  it("is a no-op when clearing a config that was never managed", () => {
    expect(applyManagedBlock(USER_CONFIG, null)).toBe(USER_CONFIG);
  });
});

describe("syncManagedModels", () => {
  it("creates the config when the CLI has never written one", () => {
    const file = tempConfig();
    syncManagedModels([model], file);
    expect(fs.readFileSync(file, "utf8")).toContain(
      "[model.chatgpt-gpt-5-3-codex]",
    );
  });

  it("does not rewrite the file when nothing changed", () => {
    const file = tempConfig(USER_CONFIG);
    syncManagedModels([model], file);
    const first = fs.statSync(file).mtimeMs;
    const contents = fs.readFileSync(file, "utf8");

    syncManagedModels([model], file);

    expect(fs.statSync(file).mtimeMs).toBe(first);
    expect(fs.readFileSync(file, "utf8")).toBe(contents);
  });

  it("clears the region when signed out", () => {
    const file = tempConfig(USER_CONFIG);
    syncManagedModels([model], file);
    syncManagedModels([], file);

    const contents = fs.readFileSync(file, "utf8");
    expect(contents).not.toContain("chatgpt");
    expect(contents).toContain("[model.local-llama]");
  });

  it("leaves no temp file behind", () => {
    const file = tempConfig(USER_CONFIG);
    syncManagedModels([model], file);
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
  });
});
