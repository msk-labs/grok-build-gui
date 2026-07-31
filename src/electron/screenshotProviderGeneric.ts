import type { BrowserWindow, NativeImage } from "electron";
import { listCaptureSources } from "./screenshotCapture.js";
import { pickSource } from "./screenshotPicker.js";
import { selectRegion } from "./screenshotSelection.js";
import type { ScreenshotMode } from "./screenshotTypes.js";

/**
 * Fallback provider (e.g. Linux): desktopCapturer + optional picker / region UI.
 * Does not import Windows-only or macOS-only capture backends.
 */
export async function captureGeneric(
  parent: BrowserWindow | null,
  mode: ScreenshotMode,
  hideParent: (
    parent: BrowserWindow | null,
    action: () => Promise<NativeImage>,
    options?: { compositorGraceMs?: number },
  ) => Promise<NativeImage>,
): Promise<NativeImage> {
  const sourceKind = mode === "window" ? "window" : "screen";
  const sources = await listCaptureSources(sourceKind);
  const source = await pickSource(parent, sourceKind, sources);
  if (mode !== "region") return source.thumbnail;
  return hideParent(
    parent,
    () => selectRegion(source.thumbnail, source.display_id),
    { compositorGraceMs: 16 },
  );
}
