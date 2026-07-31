import {
  desktopCapturer,
  nativeImage,
  screen,
  type DesktopCapturerSource,
  type NativeImage,
} from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ScreenshotCancelled,
  type ScreenshotMode,
} from "./screenshotTypes.js";

function largestScreenPixelSize(): { width: number; height: number } {
  const displays = screen.getAllDisplays();
  return displays.reduce(
    (size, display) => ({
      width: Math.max(
        size.width,
        Math.round(display.bounds.width * display.scaleFactor),
      ),
      height: Math.max(
        size.height,
        Math.round(display.bounds.height * display.scaleFactor),
      ),
    }),
    { width: 1920, height: 1080 },
  );
}

export async function listCaptureSources(
  mode: Exclude<ScreenshotMode, "region"> | "screen",
): Promise<DesktopCapturerSource[]> {
  const largest = largestScreenPixelSize();
  const sources = await desktopCapturer.getSources({
    types: [mode],
    thumbnailSize:
      mode === "screen"
        ? largest
        : {
            width: Math.min(largest.width, 2560),
            height: Math.min(largest.height, 1600),
          },
    fetchWindowIcons: mode === "window",
  });
  return sources.filter((source) => !source.thumbnail.isEmpty());
}

/**
 * Screen sources with tiny thumbnails — used when freeze frames are grabbed via
 * getUserMedia at full resolution instead of source.thumbnail.
 */
export async function listScreenSourcesMeta(): Promise<DesktopCapturerSource[]> {
  return desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: 1, height: 1 },
    fetchWindowIcons: false,
  });
}

/** First getSources call is cold; warm the pipeline after app ready. */
export function prewarmScreenCapture(): void {
  void desktopCapturer
    .getSources({
      types: ["screen"],
      thumbnailSize: { width: 16, height: 16 },
    })
    .catch(() => undefined);
}

export async function captureMacRegion(): Promise<NativeImage> {
  const output = path.join(
    os.tmpdir(),
    `grok-gui-shot-${Date.now()}-${Math.random().toString(36).slice(2)}.png`,
  );
  try {
    const result = await new Promise<{ code: number | null; stderr: string }>(
      (resolve, reject) => {
        const child = spawn(
          "screencapture",
          ["-i", "-x", "-t", "png", output],
          { stdio: ["ignore", "ignore", "pipe"] },
        );
        let stderr = "";
        child.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        child.once("error", reject);
        child.once("close", (code) => resolve({ code, stderr }));
      },
    );
    if (result.code !== 0) {
      if (!result.stderr.trim()) throw new ScreenshotCancelled();
      throw new Error(`macOS screen capture failed: ${result.stderr.trim()}`);
    }
    const image = nativeImage.createFromBuffer(await fs.readFile(output));
    if (image.isEmpty()) {
      throw new Error(
        "macOS returned an empty screenshot. Check Screen Recording permission.",
      );
    }
    return image;
  } finally {
    await fs.unlink(output).catch(() => undefined);
  }
}
