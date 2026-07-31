import type { NativeImage } from "electron";
import { captureMacRegion } from "./screenshotCapture.js";

/**
 * macOS region capture provider. Uses system `screencapture -i` only — no
 * Windows-only modules (multi-display overlay / Win32 snap) are imported.
 */
export async function captureDarwinRegion(): Promise<NativeImage> {
  return captureMacRegion();
}
