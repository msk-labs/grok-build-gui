import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import { activityGroupLabel, toolSummaryLabel } from "./toolActivitySummary";
import type { ToolCallItem } from "../../types/chat";

const t = ((key: string, values?: Record<string, unknown>) => {
  if (key === "tools.activityRunningCommand") return "Running command";
  if (key === "tools.runningSummary") return `Running · ${values?.title}`;
  return key;
}) as TFunction<"translation">;

const runningCommand: ToolCallItem = {
  id: "command-1",
  title: "npm run dev -- --host 0.0.0.0",
  status: "running",
  kind: "execute",
};

describe("tool activity summaries", () => {
  it("hides a live command line from the collapsed group summary", () => {
    expect(activityGroupLabel([runningCommand], t)).toBe("Running command");
  });

  it("keeps the command line available in the expanded tool summary", () => {
    expect(toolSummaryLabel(runningCommand, t)).toContain("npm run dev");
  });
});
