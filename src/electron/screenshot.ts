import { BrowserWindow, type NativeImage } from "electron";
import {
  ScreenshotCancelled,
  toCapturedImage,
  type CapturedImage,
  type CaptureScreenshotOptions,
  type ScreenshotMode,
} from "./screenshotTypes.js";

let activeCapture: Promise<CapturedImage | null> | null = null;

type HideParentOptions = {
  compositorGraceMs?: number;
  keepParentVisible?: boolean;
};

async function hideParentForCapture(
  parent: BrowserWindow | null,
  action: () => Promise<NativeImage>,
  options?: HideParentOptions,
): Promise<NativeImage> {
  const shouldHide =
    !options?.keepParentVisible &&
    Boolean(parent) &&
    !parent!.isDestroyed() &&
    parent!.isVisible();
  if (shouldHide) {
    parent!.hide();
    const graceMs = options?.compositorGraceMs ?? 0;
    if (graceMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, graceMs));
    }
  }
  try {
    return await action();
  } finally {
    if (shouldHide && parent && !parent.isDestroyed()) {
      parent.show();
      parent.focus();
    }
  }
}

/**
 * Platform dispatch: Windows / macOS / generic providers are loaded only on the
 * matching platform so platform backends stay isolated.
 */
async function captureRaw(
  parent: BrowserWindow | null,
  mode: ScreenshotMode,
  options?: CaptureScreenshotOptions,
): Promise<NativeImage> {
  const keepParentVisible = Boolean(options?.keepParentVisible);

  if (mode === "region" && process.platform === "darwin") {
    const { captureDarwinRegion } = await import(
      "./screenshotProviderDarwin.js"
    );
    return hideParentForCapture(parent, captureDarwinRegion, {
      keepParentVisible,
    });
  }

  if (mode === "region" && process.platform === "win32") {
    // Compositor grace only matters when we actually hide the parent.
    const delayFreezeMs =
      !keepParentVisible &&
      Boolean(parent) &&
      !parent!.isDestroyed() &&
      parent!.isVisible()
        ? 50
        : 0;
    const { captureWin32Region } = await import(
      "./screenshotProviderWin32.js"
    );
    return hideParentForCapture(
      parent,
      () => captureWin32Region(parent, { delayFreezeMs }),
      { compositorGraceMs: 0, keepParentVisible },
    );
  }

  const { captureGeneric } = await import("./screenshotProviderGeneric.js");
  return captureGeneric(parent, mode, (p, action, hideOpts) =>
    hideParentForCapture(p, action, { ...hideOpts, keepParentVisible }),
  );
}

async function runCapture(
  parent: BrowserWindow | null,
  mode: ScreenshotMode,
  options?: CaptureScreenshotOptions,
): Promise<CapturedImage | null> {
  try {
    // Confirmed crop goes straight to the composer attachment — no doodle editor.
    const raw = await captureRaw(parent, mode, options);
    return toCapturedImage(raw);
  } catch (error) {
    if (error instanceof ScreenshotCancelled) return null;
    throw error;
  }
}

/**
 * Capture a screen region (or legacy screen/window modes on generic platforms).
 * Calls are serialized because overlay windows can conflict on some drivers.
 */
export function captureScreenshot(
  parent: BrowserWindow | null,
  mode: ScreenshotMode,
  options?: CaptureScreenshotOptions,
): Promise<CapturedImage | null> {
  if (activeCapture) {
    throw new Error("A screenshot is already in progress.");
  }
  activeCapture = runCapture(parent, mode, options).finally(() => {
    activeCapture = null;
  });
  return activeCapture;
}

/** Backwards-compatible region entry point for older renderer builds. */
export function captureRegionScreenshot(
  parent: BrowserWindow | null,
  options?: CaptureScreenshotOptions,
): Promise<CapturedImage | null> {
  return captureScreenshot(parent, "region", options);
}

export type {
  CapturedImage,
  CaptureScreenshotOptions,
  ScreenshotMode,
} from "./screenshotTypes.js";
