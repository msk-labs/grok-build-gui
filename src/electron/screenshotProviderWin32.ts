import type { BrowserWindow, NativeImage } from "electron";
import { captureMultiDisplayRegion } from "./screenshotMultiRegion.js";

export type Win32RegionOptions = {
  /** Compositor grace after parent hide, overlapped with overlay prep. */
  delayFreezeMs?: number;
};

/**
 * Windows region capture provider: getUserMedia freeze + multi-display overlay
 * + Win32 (koffi) window snap. Dynamically imported only on win32.
 */
export async function captureWin32Region(
  _parent: BrowserWindow | null,
  options?: Win32RegionOptions,
): Promise<NativeImage> {
  return captureMultiDisplayRegion({
    delayFreezeMs: options?.delayFreezeMs ?? 0,
  });
}
