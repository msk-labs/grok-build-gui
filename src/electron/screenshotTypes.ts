import type { NativeImage } from "electron";

export type ScreenshotMode = "region" | "screen" | "window";

/** Optional capture behavior from the renderer (hidden modifiers, etc.). */
export type CaptureScreenshotOptions = {
  /**
   * When true, leave the parent BrowserWindow visible during capture.
   * Hidden gesture: Ctrl+click the screenshot menu item.
   */
  keepParentVisible?: boolean;
};

export type CapturedImage = {
  data: string;
  mimeType: "image/png";
  dataUrl: string;
  width: number;
  height: number;
};

export class ScreenshotCancelled extends Error {
  constructor() {
    super("Screenshot cancelled.");
    this.name = "ScreenshotCancelled";
  }
}

export function toCapturedImage(image: NativeImage): CapturedImage {
  if (image.isEmpty()) {
    throw new Error("The captured image is empty.");
  }
  const { width, height } = image.getSize();
  if (width < 2 || height < 2) {
    throw new Error("The captured image is too small.");
  }
  const data = image.toPNG().toString("base64");
  return {
    data,
    mimeType: "image/png",
    dataUrl: `data:image/png;base64,${data}`,
    width,
    height,
  };
}
