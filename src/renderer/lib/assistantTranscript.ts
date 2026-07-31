/**
 * Flatten assistant blocks into a plain ACP-order transcript.
 * Used by “Show Markdown” — no folds, cards, or rendered markdown.
 */

import type { AssistantBlock, ToolCallItem, ToolContent } from "../types/chat";
import { isImageResultMetaText } from "./toolImages";

/** Chronological plain text for one assistant turn (block order preserved). */
export function formatAssistantTranscript(blocks: AssistantBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === "text") {
      const t = block.text;
      if (t) parts.push(t);
      continue;
    }
    if (block.type === "thought") {
      const t = block.text;
      if (t) parts.push(t);
      continue;
    }
    if (block.type === "tool") {
      const toolText = formatToolTranscript(block.tool);
      if (toolText) parts.push(toolText);
    }
  }
  return parts.join("\n\n");
}

function formatToolTranscript(tool: ToolCallItem): string {
  const lines: string[] = [];
  const title = tool.title?.trim() || tool.id;
  const status = tool.status?.trim();
  lines.push(status ? `${title} (${status})` : title);

  if (tool.kind?.trim()) {
    lines.push(`kind: ${tool.kind.trim()}`);
  }

  for (const loc of tool.locations ?? []) {
    if (!loc.path) continue;
    lines.push(
      typeof loc.line === "number" ? `${loc.path}:${loc.line}` : loc.path,
    );
  }

  for (const c of tool.content ?? []) {
    const chunk = formatToolContent(c);
    if (chunk) lines.push(chunk);
  }

  const preview = tool.contentPreview?.trim();
  if (
    preview &&
    !isImageResultMetaText(preview) &&
    !(tool.content ?? []).some(
      (c) => c.type === "content" && c.text.trim() === preview,
    )
  ) {
    lines.push(preview);
  }

  return lines.join("\n");
}

function formatToolContent(c: ToolContent): string | null {
  if (c.type === "content") {
    const t = c.text.trim();
    if (!t || isImageResultMetaText(t)) return null;
    return c.text;
  }
  if (c.type === "diff") {
    const parts = [`diff ${c.path}`];
    if (c.oldText != null && c.oldText !== "") {
      parts.push("--- old");
      parts.push(c.oldText);
    } else {
      parts.push("--- (new file)");
    }
    parts.push("+++ new");
    parts.push(c.newText ?? "");
    return parts.join("\n");
  }
  if (c.type === "image") {
    if (c.path) return `[image] ${c.path}`;
    if (c.filename) return `[image] ${c.filename}`;
    if (c.data) return `[image] ${c.mimeType || "embedded"}`;
    return "[image]";
  }
  if (c.type === "video") {
    if (c.path) return `[video] ${c.path}`;
    if (c.uploadedUrl) return `[video] ${c.uploadedUrl}`;
    if (c.filename) return `[video] ${c.filename}`;
    return "[video]";
  }
  return null;
}
