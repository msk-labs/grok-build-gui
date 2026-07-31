import type { ToolCallItem } from "../../types/chat";
import type { TFunction } from "i18next";
import { toolPrimaryPath } from "../../lib/fileChanges";
import { basename } from "../../lib/lineDiff";
import { isImageTool } from "../../lib/toolImages";
import {
  classifyTool,
  type ToolPresentationKind,
} from "../../lib/toolPresentation";

type ActivityKind = ToolPresentationKind;

export function isToolActive(status: string): boolean {
  const normalized = status.toLowerCase();
  return (
    normalized === "pending" ||
    normalized === "in_progress" ||
    normalized === "running" ||
    normalized === "inprogress"
  );
}

export function statusLabel(status: string, t: TFunction<"translation">): string {
  const normalized = status.toLowerCase();
  if (
    normalized === "completed" ||
    normalized === "completed_success" ||
    normalized === "success"
  ) {
    return t("tools.done");
  }
  if (
    normalized === "in_progress" ||
    normalized === "running" ||
    normalized === "inprogress"
  ) {
    return t("tools.running");
  }
  if (normalized === "pending") return t("tools.pending");
  if (normalized === "failed" || normalized === "error") {
    return t("tools.failed");
  }
  if (normalized === "cancelled" || normalized === "canceled") {
    return t("tools.cancelled");
  }
  return status;
}

export function toolSummaryLabel(
  tool: ToolCallItem,
  t: TFunction<"translation">,
): string {
  // Image tools: never surface the full imagine prompt in the summary row.
  if (isImageTool(tool)) {
    return isToolActive(tool.status)
      ? t("tools.activityGeneratingImage")
      : t("tools.activityGeneratedImage");
  }

  const active = isToolActive(tool.status);
  const path = toolPrimaryPath(tool);
  const file = path ? basename(path) : "";
  const title = displayToolTitle(tool, t);

  if (active) {
    const running = t("tools.runningSummary", { title });
    return file ? `${running} · ${file}` : running;
  }
  const status = statusLabel(tool.status, t);
  if (status === t("tools.done")) {
    return file ? `${title} · ${file}` : title;
  }
  return file ? `${status} · ${title} · ${file}` : `${status} · ${title}`;
}

/**
 * One-line summary for a process activity group.
 * Completed titles describe tool categories only (not thoughts).
 * While live: prefer the active tool, else "Thinking" when reasoning is live.
 */
export function activityGroupLabel(
  tools: ToolCallItem[],
  t: TFunction<"translation">,
  opts?: { liveThought?: boolean },
): string {
  const active = [...tools].reverse().find((tool) => isToolActive(tool.status));
  if (active) return activeActivityLabel(active, t);
  if (opts?.liveThought) return t("tools.thinking");

  if (tools.length === 0) {
    return t("tools.thought");
  }

  const counts = new Map<ActivityKind, number>();
  const order: ActivityKind[] = [];
  for (const tool of tools) {
    const kind = activityKind(tool);
    // Thoughts never contribute to the group title (option A).
    if (kind === "reasoning") continue;
    if (!counts.has(kind)) order.push(kind);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }

  if (order.length === 0) {
    return t("tools.thought");
  }

  return order
    .map((kind) => completedActivityLabel(kind, counts.get(kind) ?? 1, t))
    .join(" · ");
}

function activeActivityLabel(
  tool: ToolCallItem,
  t: TFunction<"translation">,
): string {
  const title = displayToolTitle(tool, t);
  switch (activityKind(tool)) {
    case "read":
      return t("tools.activityReading", { title });
    case "edit":
      return t("tools.activityEditing", { title });
    case "search":
      return t("tools.activitySearching", { title });
    case "command":
      // The full command remains available inside the explicit L2 expansion.
      // Keep the live collapsed summary generic so streaming updates do not
      // expose command arguments before the user asks for details.
      return t("tools.activityRunningCommand");
    case "web":
      return t("tools.activityFetching", { title });
    case "reasoning":
      return t("tools.thinking");
    case "media":
      return t("tools.activityGeneratingImage");
    case "other":
      return t("tools.activityUsing", { title });
  }
}

function displayToolTitle(
  tool: ToolCallItem,
  t: TFunction<"translation">,
): string {
  if (isImageTool(tool)) return t("tools.imageTool");
  const raw =
    (tool.title || tool.kind || t("tools.tool")).trim() || t("tools.tool");
  return raw === "Tool call" ? t("tools.tool") : raw;
}

function completedActivityLabel(
  kind: ActivityKind,
  count: number,
  t: TFunction<"translation">,
): string {
  switch (kind) {
    case "read":
      return t(count === 1 ? "tools.activityReadOne" : "tools.activityReadMany");
    case "edit":
      return t(
        count === 1 ? "tools.activityEditedOne" : "tools.activityEditedMany",
      );
    case "search":
      return t("tools.activitySearched");
    case "command":
      return t(
        count === 1 ? "tools.activityRanOne" : "tools.activityRanMany",
      );
    case "web":
      return t("tools.activityFetched");
    case "reasoning":
      return t("tools.thought");
    case "media":
      return t(
        count === 1
          ? "tools.activityGeneratedImage"
          : "tools.activityGeneratedImages",
      );
    case "other":
      return t(
        count === 1 ? "tools.activityUsedOne" : "tools.activityUsedMany",
      );
  }
}

function activityKind(tool: ToolCallItem): ActivityKind {
  return classifyTool(tool);
}
