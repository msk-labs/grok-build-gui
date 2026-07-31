import type {
  ToolCallItem,
  ToolImageContent,
  ToolVideoContent,
} from "../types/chat";

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v|mkv)$/i;

/** True for image-only imagine tools (not video). */
export function isImageTool(tool: ToolCallItem): boolean {
  if (isVideoTool(tool)) return false;
  const title = (tool.title || "").trim().toLowerCase();
  if (/^(image_edit|image_gen)\b/.test(title)) return true;
  if (/^imagine[-_]?(edit|gen|image)?\b/.test(title)) return true;
  if (/\b(image_edit|image_gen|imagine-edit|imagine-gen)\b/.test(title)) {
    return true;
  }
  return toolImages(tool).length > 0;
}

/** True for video generation tools (`image_to_video`, `reference_to_video`, …). */
export function isVideoTool(tool: ToolCallItem): boolean {
  const title = (tool.title || "").trim().toLowerCase();
  if (
    /^(image_to_video|reference_to_video|video_gen|imagine[-_]?video)\b/.test(
      title,
    )
  ) {
    return true;
  }
  if (/\b(image_to_video|reference_to_video|video_gen)\b/.test(title)) {
    return true;
  }
  return toolVideos(tool).length > 0;
}

/** Images attached to a tool call (embedded bytes and/or disk paths). */
export function toolImages(tool: ToolCallItem): ToolImageContent[] {
  return (tool.content ?? []).filter(
    (c): c is ToolImageContent => c.type === "image",
  );
}

/** Videos attached to a tool call (disk paths and/or remote URLs). */
export function toolVideos(tool: ToolCallItem): ToolVideoContent[] {
  return (tool.content ?? []).filter(
    (c): c is ToolVideoContent => c.type === "video",
  );
}

export function mimeFromPath(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".mp4") || lower.endsWith(".m4v")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".mkv")) return "video/x-matroska";
  return "image/png";
}

export function isImagePath(filePath: string): boolean {
  return IMAGE_EXT.test(filePath);
}

export function isVideoPath(filePath: string): boolean {
  return VIDEO_EXT.test(filePath);
}

/** data: URL when embedded base64 is present. */
export function toolImageDataUrl(img: ToolImageContent): string | null {
  if (img.data && img.mimeType) {
    return `data:${img.mimeType};base64,${img.data}`;
  }
  return null;
}

/**
 * Skip tool text that is only imagine metadata JSON (path/filename) — the
 * image/video itself is shown instead of the raw payload.
 */
export function isImageResultMetaText(text: string): boolean {
  return isMediaResultMetaText(text);
}

/** Imagine metadata JSON for images or videos (path / uploaded_url). */
export function isMediaResultMetaText(text: string): boolean {
  const t = text.trim();
  if (!t.startsWith("{") || (!t.includes("path") && !t.includes("uploaded_url"))) {
    return false;
  }
  try {
    const o = JSON.parse(t) as Record<string, unknown>;
    if (typeof o.path === "string" && (isImagePath(o.path) || isVideoPath(o.path))) {
      return true;
    }
    if (typeof o.uploaded_url === "string" && o.uploaded_url.trim()) {
      return true;
    }
    // Typed raw_output shape without extension on empty path.
    const type = typeof o.type === "string" ? o.type : "";
    if (
      type === "ImageToVideo" ||
      type === "ReferenceToVideo" ||
      type === "ImageGen" ||
      type === "ImageEdit"
    ) {
      return typeof o.path === "string" || typeof o.uploaded_url === "string";
    }
    return false;
  } catch {
    return false;
  }
}
