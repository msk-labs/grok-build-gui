import type { ToolCallItem, ToolDiff } from "../types/chat";
import { isImageResultMetaText, toolImages, toolVideos } from "./toolImages";

export type ToolPresentationKind =
  | "command"
  | "read"
  | "edit"
  | "search"
  | "web"
  | "media"
  | "reasoning"
  | "other";

/** Prefer structured ACP fields; title matching is compatibility fallback only. */
export function classifyTool(tool: ToolCallItem): ToolPresentationKind {
  if (toolImages(tool).length > 0 || toolVideos(tool).length > 0) return "media";
  if (toolDiffs(tool).length > 0) return "edit";

  switch (tool.kind?.trim().toLowerCase()) {
    case "execute":
    case "command":
      return "command";
    case "read":
    case "list":
    case "list_dir":
    case "inspect":
      return "read";
    case "edit":
    case "write":
    case "create":
    case "delete":
    case "move":
    case "patch":
      return "edit";
    case "search":
      return "search";
    case "fetch":
    case "web_fetch":
    case "web_search":
      return "web";
    case "think":
    case "reasoning":
      return "reasoning";
  }

  const title = tool.title.toLowerCase();
  if (/\b(image|video|imagine)\b/.test(title)) return "media";
  if (/\b(edit|write|create|delete|move|patch)\b/.test(title)) return "edit";
  if (/\b(read|list|inspect|open)\b/.test(title)) return "read";
  if (/\b(search|find|grep|glob)\b/.test(title)) return "search";
  if (/\b(fetch|download|request|browse|web)\b/.test(title)) return "web";
  if (/\b(run|exec|test|build|lint|command|shell)\b/.test(title)) {
    return "command";
  }
  if (/\b(think|reason)\b/.test(title)) return "reasoning";
  return "other";
}

export function toolDiffs(tool: ToolCallItem): ToolDiff[] {
  return (tool.content ?? []).filter(
    (item): item is ToolDiff => item.type === "diff",
  );
}

export function toolTextOutputs(tool: ToolCallItem): string[] {
  const content = (tool.content ?? [])
    .filter(
      (item): item is { type: "content"; text: string } =>
        item.type === "content",
    )
    .map((item) => item.text.trim())
    .filter(Boolean)
    .filter((text) => !isImageResultMetaText(text));

  if (content.length > 0) return content;
  const preview = tool.contentPreview?.trim();
  return preview && !isImageResultMetaText(preview) ? [preview] : [];
}
