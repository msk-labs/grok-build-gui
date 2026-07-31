/**
 * Workspace filesystem IPC for the Files panel (tree + text preview).
 * Paths are confined to a caller-supplied workspace root.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { promisify } from "node:util";
import { app, ipcMain, nativeImage, shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);

/** App that can open a path (Codex-style Open With). */
export type OpenWithApp = {
  name: string;
  /** Absolute .app path (macOS) or executable; empty = system default handler. */
  path: string;
  isDefault?: boolean;
  /** PNG data URL for the menu row icon (bitmap is 2× CSS size for Retina). */
  iconDataUrl?: string;
};

/** CSS display size in the menu (device-independent pixels). */
const OPEN_WITH_ICON_CSS_PX = 16;
/**
 * Bitmap pixel size to export. Use 2× so Retina (2x) menus stay sharp.
 */
const OPEN_WITH_ICON_BITMAP_PX = OPEN_WITH_ICON_CSS_PX * 2;
/** Avoid re-extracting the same .app icon many times per process. */
const iconCache = new Map<string, string | undefined>();

const HIDDEN_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "out",
  "__pycache__",
]);

const MAX_PREVIEW_BYTES = 512 * 1024;
/** Cap for chat-inline tool images (imagine outputs under ~/.grok/sessions). */
const MAX_IMAGE_DATA_URL_BYTES = 12 * 1024 * 1024;

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};

/**
 * Allow reading image files the agent already produced or that live in the
 * workspace — not arbitrary filesystem browse.
 */
function isAllowedImageReadPath(absPath: string): boolean {
  const resolved = path.resolve(absPath);
  if (!path.isAbsolute(resolved)) return false;
  const grokRoot = path.resolve(homedir(), ".grok");
  const relGrok = path.relative(grokRoot, resolved);
  if (relGrok === "" || (!relGrok.startsWith("..") && !path.isAbsolute(relGrok))) {
    return true;
  }
  return false;
}

function mimeForImagePath(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_MIME_BY_EXT[ext] ?? null;
}

export type FsEntry = {
  name: string;
  path: string;
  kind: "file" | "dir";
  size?: number;
};

function isInsideRoot(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

async function resolveSafe(
  rootRaw: string,
  targetRaw?: string | null,
): Promise<{ root: string; target: string } | { error: string }> {
  if (typeof rootRaw !== "string" || !rootRaw.trim()) {
    return { error: "Missing workspace root" };
  }
  let root: string;
  try {
    root = await fs.realpath(rootRaw.trim());
  } catch {
    return { error: `Workspace not found: ${rootRaw}` };
  }

  const candidate =
    typeof targetRaw === "string" && targetRaw.trim()
      ? path.resolve(root, targetRaw.trim())
      : root;

  let target: string;
  try {
    target = await fs.realpath(candidate);
  } catch {
    // New / dangling path — still require it to resolve under root.
    target = candidate;
  }

  if (!isInsideRoot(root, target)) {
    return { error: "Path escapes workspace root" };
  }
  return { root, target };
}

/**
 * Resolve the .icns (or png) icon file inside a macOS .app bundle.
 * Modern apps may only ship Assets.car — those fall through to getFileIcon.
 */
async function resolveMacAppIconFile(
  appPath: string,
): Promise<string | null> {
  const resources = path.join(appPath, "Contents", "Resources");
  const plist = path.join(appPath, "Contents", "Info.plist");

  const tryFile = async (name: string): Promise<string | null> => {
    const base = name.endsWith(".icns") || name.endsWith(".png") ? name : `${name}.icns`;
    const full = path.join(resources, base);
    try {
      await fs.access(full);
      return full;
    } catch {
      return null;
    }
  };

  // CFBundleIconFile from Info.plist
  try {
    const { stdout } = await execFileAsync(
      "defaults",
      ["read", plist, "CFBundleIconFile"],
      { timeout: 2000 },
    );
    const name = String(stdout || "").trim();
    if (name) {
      const hit = await tryFile(name);
      if (hit) return hit;
    }
  } catch {
    // no key / unreadable
  }

  for (const name of ["AppIcon.icns", "app.icns", "Icon.icns", "icon.icns"]) {
    const hit = await tryFile(name);
    if (hit) return hit;
  }

  try {
    const files = await fs.readdir(resources);
    const icns = files.find((f) => f.toLowerCase().endsWith(".icns"));
    if (icns) return path.join(resources, icns);
  } catch {
    // ignore
  }
  return null;
}

/** Quick Look thumbnail for .app bundles that only ship Assets.car. */
async function qlThumbnailDataUrl(
  appPath: string,
): Promise<string | undefined> {
  const hash = createHash("sha1").update(appPath).digest("hex").slice(0, 12);
  const dir = path.join(tmpdir(), `grok-ql-${process.pid}-${hash}`);
  try {
    await fs.mkdir(dir, { recursive: true });
    // Request larger than menu bitmap so qlmanage has room to sample.
    await execFileAsync(
      "qlmanage",
      ["-t", "-s", String(OPEN_WITH_ICON_BITMAP_PX * 2), "-o", dir, appPath],
      { timeout: 5000 },
    );
    const files = await fs.readdir(dir);
    const png = files.find((f) => f.toLowerCase().endsWith(".png"));
    if (!png) return undefined;
    const buf = await fs.readFile(path.join(dir, png));
    if (buf.length < 32) return undefined;
    try {
      const ni = nativeImage.createFromBuffer(buf);
      if (!ni.isEmpty()) {
        const sized = ni.resize({
          width: OPEN_WITH_ICON_BITMAP_PX,
          height: OPEN_WITH_ICON_BITMAP_PX,
          quality: "best",
        });
        if (!sized.isEmpty()) {
          const data = sized.toDataURL();
          if (data.length > 64) return data;
        }
      }
    } catch {
      // raw buffer as data URL
    }
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return undefined;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Convert an image file (icns/png) to a Retina-ready PNG data URL.
 * Prefer sips for .icns — it picks the right size from the icon family
 * instead of downscaling a huge/wrong representation.
 */
async function imageFileToDataUrl(imagePath: string): Promise<string | undefined> {
  const hash = createHash("sha1")
    .update(`${imagePath}@${OPEN_WITH_ICON_BITMAP_PX}`)
    .digest("hex")
    .slice(0, 12);
  const out = path.join(
    tmpdir(),
    `grok-app-icon-${process.pid}-${hash}.png`,
  );
  try {
    // sips first for icns (crisper size selection from multi-res icon sets).
    if (imagePath.toLowerCase().endsWith(".icns")) {
      await execFileAsync(
        "sips",
        [
          "-s",
          "format",
          "png",
          "-z",
          String(OPEN_WITH_ICON_BITMAP_PX),
          String(OPEN_WITH_ICON_BITMAP_PX),
          imagePath,
          "--out",
          out,
        ],
        { timeout: 4000 },
      );
      const buf = await fs.readFile(out);
      if (buf.length >= 32) {
        return `data:image/png;base64,${buf.toString("base64")}`;
      }
    }

    // PNG / other stills, or icns fallback: nativeImage resize.
    try {
      const ni = nativeImage.createFromPath(imagePath);
      if (!ni.isEmpty()) {
        const sized = ni.resize({
          width: OPEN_WITH_ICON_BITMAP_PX,
          height: OPEN_WITH_ICON_BITMAP_PX,
          quality: "best",
        });
        if (!sized.isEmpty()) {
          const url = sized.toDataURL();
          if (url.length > 64) return url;
        }
      }
    } catch {
      // fall through
    }

    await execFileAsync(
      "sips",
      [
        "-s",
        "format",
        "png",
        "-z",
        String(OPEN_WITH_ICON_BITMAP_PX),
        String(OPEN_WITH_ICON_BITMAP_PX),
        imagePath,
        "--out",
        out,
      ],
      { timeout: 4000 },
    );
    const buf = await fs.readFile(out);
    if (buf.length < 32) return undefined;
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return undefined;
  } finally {
    await fs.unlink(out).catch(() => undefined);
  }
}

/**
 * App icon for Open With rows.
 * macOS: .app → Resources/*.icns (sips/nativeImage). Electron getFileIcon on
 * .app bundles often yields a blank/generic glyph in practice.
 */
async function appIconDataUrl(appPath: string): Promise<string | undefined> {
  if (!appPath) return undefined;
  if (iconCache.has(appPath)) return iconCache.get(appPath);

  let url: string | undefined;
  try {
    if (process.platform === "darwin" && /\.app$/i.test(appPath)) {
      const iconFile = await resolveMacAppIconFile(appPath);
      if (iconFile) {
        url = await imageFileToDataUrl(iconFile);
      }
      // Asset-catalog apps (no .icns): Quick Look thumbnail of the .app itself.
      if (!url) {
        url = await qlThumbnailDataUrl(appPath);
      }
    }

    if (!url) {
      // Last resort (often blank for .app on macOS — kept for other targets).
      const img = await app.getFileIcon(appPath, { size: "normal" });
      if (img && !img.isEmpty()) {
        const sized = img.resize({
          width: OPEN_WITH_ICON_BITMAP_PX,
          height: OPEN_WITH_ICON_BITMAP_PX,
          quality: "best",
        });
        if (!sized.isEmpty()) {
          const data = sized.toDataURL();
          if (data.length > 64) url = data;
        }
      }
    }
  } catch {
    url = undefined;
  }

  iconCache.set(appPath, url);
  return url;
}

async function withIcons(apps: OpenWithApp[]): Promise<OpenWithApp[]> {
  return Promise.all(
    apps.map(async (a) => {
      if (!a.path) return a;
      const iconDataUrl = await appIconDataUrl(a.path);
      return iconDataUrl ? { ...a, iconDataUrl } : a;
    }),
  );
}

async function listOpenWithApps(target: string): Promise<OpenWithApp[]> {
  if (process.platform === "darwin") {
    return withIcons(await listOpenWithAppsMac(target));
  }
  // Windows / Linux: open with the OS default handler only.
  return [{ name: "Default Application", path: "", isDefault: true }];
}

async function listOpenWithAppsMac(target: string): Promise<OpenWithApp[]> {
  // JXA + AppKit — no Swift compile cost; argv[0] is the file path.
  const jxa = `
ObjC.import('AppKit');
function run(argv) {
  var filePath = argv[0];
  if (!filePath) return '[]';
  var url = $.NSURL.fileURLWithPath(filePath);
  var ws = $.NSWorkspace.sharedWorkspace;
  var defUrl = ws.URLForApplicationToOpenURL(url);
  var defPath = null;
  try {
    if (defUrl && !defUrl.isNil()) defPath = ObjC.unwrap(defUrl.path);
  } catch (e) {}
  var paths = [];
  try {
    var raw = ws.URLsForApplicationsToOpenURL(url);
    if (raw && !raw.isNil()) {
      var n = raw.count;
      for (var i = 0; i < n; i++) {
        var u = raw.objectAtIndex(i);
        paths.push(ObjC.unwrap(u.path));
      }
    }
  } catch (e2) {}
  if (paths.length === 0 && defPath) paths = [defPath];
  var seen = {};
  var out = [];
  function add(p, isDef) {
    if (!p || seen[p]) return;
    seen[p] = true;
    var name = p;
    try {
      name = ObjC.unwrap($.NSFileManager.defaultManager.displayNameAtPath(p));
    } catch (e3) {
      var base = p.split('/').pop() || p;
      name = base.replace(/\\.app$/i, '');
    }
    out.push({ name: String(name), path: String(p), isDefault: !!isDef });
  }
  if (defPath) add(defPath, true);
  for (var j = 0; j < paths.length; j++) add(paths[j], paths[j] === defPath);
  return JSON.stringify(out);
}
`;
  try {
    const { stdout } = await execFileAsync(
      "osascript",
      ["-l", "JavaScript", "-e", jxa, target],
      { timeout: 6000, maxBuffer: 2 * 1024 * 1024 },
    );
    const text = String(stdout || "").trim();
    if (!text) return [];
    const parsed = JSON.parse(text) as OpenWithApp[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (a) => a && typeof a.name === "string" && typeof a.path === "string",
    );
  } catch {
    return [];
  }
}

async function openWithApp(
  target: string,
  appPath: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!appPath) {
      // Empty path = OS default handler.
      const err = await shell.openPath(target);
      if (err) return { ok: false, error: err };
      return { ok: true };
    }
    if (process.platform === "darwin") {
      await execFileAsync("open", ["-a", appPath, target], { timeout: 8000 });
      return { ok: true };
    }
    if (process.platform === "win32") {
      await execFileAsync(
        "cmd",
        ["/c", "start", "", appPath, target],
        { timeout: 8000, windowsHide: true },
      );
      return { ok: true };
    }
    // Linux: try app as executable.
    await execFileAsync(appPath, [target], { timeout: 8000 });
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export function registerFilesIpc() {
  /**
   * Load an agent-generated (or session-local) image as a data URL for chat UI.
   * Paths must sit under ~/.grok (session images live in ~/.grok/sessions/.../images).
   */
  ipcMain.handle(
    "fs:read-image-data-url",
    async (
      _e,
      filePath: string,
    ): Promise<
      { ok: true; dataUrl: string } | { ok: false; error: string }
    > => {
      try {
        if (typeof filePath !== "string" || !filePath.trim()) {
          return { ok: false, error: "Missing path" };
        }
        const target = path.resolve(filePath.trim());
        if (!isAllowedImageReadPath(target)) {
          return { ok: false, error: "Path not allowed" };
        }
        const mime = mimeForImagePath(target);
        if (!mime) {
          return { ok: false, error: "Not an image file" };
        }
        const st = await fs.stat(target);
        if (!st.isFile()) {
          return { ok: false, error: "Not a file" };
        }
        if (st.size > MAX_IMAGE_DATA_URL_BYTES) {
          return { ok: false, error: "Image too large" };
        }
        const buf = await fs.readFile(target);
        return {
          ok: true,
          dataUrl: `data:${mime};base64,${buf.toString("base64")}`,
        };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  );

  ipcMain.handle(
    "fs:list-dir",
    async (
      _e,
      opts: { root: string; path?: string; showHidden?: boolean },
    ): Promise<
      { ok: true; path: string; entries: FsEntry[] } | { ok: false; error: string }
    > => {
      try {
        const safe = await resolveSafe(opts?.root, opts?.path);
        if ("error" in safe) return { ok: false, error: safe.error };

        const st = await fs.stat(safe.target);
        if (!st.isDirectory()) {
          return { ok: false, error: "Not a directory" };
        }

        const names = await fs.readdir(safe.target);
        const showHidden = Boolean(opts?.showHidden);
        const entries: FsEntry[] = [];

        for (const name of names) {
          if (!showHidden && (name.startsWith(".") || HIDDEN_DIR_NAMES.has(name))) {
            continue;
          }
          const full = path.join(safe.target, name);
          try {
            const est = await fs.stat(full);
            entries.push({
              name,
              path: full,
              kind: est.isDirectory() ? "dir" : "file",
              size: est.isFile() ? est.size : undefined,
            });
          } catch {
            // Skip unreadable entries (broken symlinks, permissions).
          }
        }

        entries.sort((a, b) => {
          if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
          return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
        });

        return { ok: true, path: safe.target, entries };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  );

  ipcMain.handle(
    "fs:read-text",
    async (
      _e,
      opts: { root: string; path: string; maxBytes?: number },
    ): Promise<
      | {
          ok: true;
          path: string;
          text: string;
          truncated: boolean;
          binary: boolean;
          size: number;
        }
      | { ok: false; error: string }
    > => {
      try {
        const safe = await resolveSafe(opts?.root, opts?.path);
        if ("error" in safe) return { ok: false, error: safe.error };

        const st = await fs.stat(safe.target);
        if (!st.isFile()) return { ok: false, error: "Not a file" };

        const cap = Math.min(
          Math.max(1024, opts?.maxBytes ?? MAX_PREVIEW_BYTES),
          MAX_PREVIEW_BYTES,
        );
        const size = st.size;
        const handle = await fs.open(safe.target, "r");
        try {
          const buf = Buffer.alloc(Math.min(size, cap));
          const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
          const slice = buf.subarray(0, bytesRead);
          // Heuristic: NUL bytes → treat as binary.
          const binary = slice.includes(0);
          if (binary) {
            return {
              ok: true,
              path: safe.target,
              text: "",
              truncated: size > bytesRead,
              binary: true,
              size,
            };
          }
          return {
            ok: true,
            path: safe.target,
            text: slice.toString("utf8"),
            truncated: size > bytesRead,
            binary: false,
            size,
          };
        } finally {
          await handle.close();
        }
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  );

  ipcMain.handle(
    "fs:reveal",
    async (
      _e,
      opts: { root: string; path: string },
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      try {
        const safe = await resolveSafe(opts?.root, opts?.path);
        if ("error" in safe) return { ok: false, error: safe.error };
        shell.showItemInFolder(safe.target);
        return { ok: true };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  );

  /** Apps that can open this path (for Files tree "Open With" submenu). */
  ipcMain.handle(
    "fs:list-open-with",
    async (
      _e,
      opts: { root: string; path: string },
    ): Promise<
      { ok: true; apps: OpenWithApp[] } | { ok: false; error: string }
    > => {
      try {
        const safe = await resolveSafe(opts?.root, opts?.path);
        if ("error" in safe) return { ok: false, error: safe.error };
        const apps = await listOpenWithApps(safe.target);
        return { ok: true, apps };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  );

  /** Open path with a specific app (or default when appPath is empty). */
  ipcMain.handle(
    "fs:open-with",
    async (
      _e,
      opts: { root: string; path: string; appPath?: string },
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      try {
        const safe = await resolveSafe(opts?.root, opts?.path);
        if ("error" in safe) return { ok: false, error: safe.error };
        return await openWithApp(safe.target, opts?.appPath ?? "");
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  );
}
