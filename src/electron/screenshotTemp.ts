import type { NativeImage } from "electron";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Temp dirs used by screenshot UI shells / freeze previews. */
const SCREENSHOT_TEMP_PREFIXES = [
  "grok-gui-multi-region-",
  "grok-gui-selection-",
  "grok-gui-picker-",
  "grok-gui-editor-",
] as const;

/** Only remove leftovers older than this so an in-flight session is never deleted. */
const STALE_MAX_AGE_MS = 30 * 60 * 1000;

export type ScreenshotWorkspace = {
  dir: string;
  file(name: string): string;
  writeImage(name: string, image: NativeImage): Promise<string>;
  writeText(name: string, contents: string): Promise<string>;
  cleanup(): Promise<void>;
};

/**
 * Remove old screenshot temp directories. Safe to await before creating a new
 * workspace. Never deletes dirs younger than STALE_MAX_AGE_MS (avoids racing
 * the active multi-region session).
 */
export async function purgeStaleScreenshotWorkspaces(
  options?: { keepDir?: string },
): Promise<void> {
  const tmp = os.tmpdir();
  const keep = options?.keepDir
    ? path.resolve(options.keepDir)
    : null;
  const now = Date.now();
  let entries: string[];
  try {
    entries = await fs.readdir(tmp);
  } catch {
    return;
  }
  await Promise.all(
    entries.map(async (name) => {
      if (!SCREENSHOT_TEMP_PREFIXES.some((prefix) => name.startsWith(prefix))) {
        return;
      }
      const full = path.join(tmp, name);
      if (keep && path.resolve(full) === keep) return;
      try {
        const stat = await fs.stat(full);
        if (now - stat.mtimeMs < STALE_MAX_AGE_MS) return;
        await fs.rm(full, { recursive: true, force: true });
      } catch {
        // ignore busy/missing
      }
    }),
  );
}

export async function createScreenshotWorkspace(
  prefix: string,
): Promise<ScreenshotWorkspace> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `grok-gui-${prefix}-`));
  return {
    dir,
    file: (name) => path.join(dir, name),
    async writeImage(name, image) {
      const target = path.join(dir, name);
      const png = image.toPNG();
      if (!png.length) {
        throw new Error(`Failed to encode screenshot PNG (${name}).`);
      }
      await fs.writeFile(target, png);
      // Ensure the file is visible before file:// loads from the overlay.
      await fs.access(target);
      return target;
    },
    async writeText(name, contents) {
      const target = path.join(dir, name);
      await fs.writeFile(target, contents, "utf8");
      return target;
    },
    async cleanup() {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}
