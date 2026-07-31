import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_REASONING_EFFORT = "medium";

function preferencePath(): string {
  return join(homedir(), ".grok", "gui", "reasoning-preference.json");
}

export function readReasoningEffortPreference(): string {
  try {
    const raw = readFileSync(preferencePath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    const effort =
      parsed && typeof parsed === "object"
        ? (parsed as { reasoningEffort?: unknown }).reasoningEffort
        : null;
    return typeof effort === "string" && effort.trim()
      ? effort.trim()
      : DEFAULT_REASONING_EFFORT;
  } catch {
    return DEFAULT_REASONING_EFFORT;
  }
}

export function writeReasoningEffortPreference(effort: string): void {
  const normalized = effort.trim();
  if (!normalized) return;
  try {
    const dir = join(homedir(), ".grok", "gui");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      preferencePath(),
      JSON.stringify({ reasoningEffort: normalized, updatedAt: Date.now() }),
      "utf8",
    );
  } catch {
    // Best-effort; the preference still lasts for this app process.
  }
}
