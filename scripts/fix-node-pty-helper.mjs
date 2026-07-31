/**
 * node-pty ships `spawn-helper` — the exec shim it posix_spawnp()s for every
 * PTY — inside its npm tarball, but the tarball loses the executable bit on
 * some npm versions. Without +x, posix_spawnp fails with EACCES and node-pty
 * reports "posix_spawnp failed.", so no built-in terminal can start.
 *
 * Runs from `postinstall`: repairing node_modules before packaging also fixes
 * the shipped app, since electron-builder copies the mode bits as it finds
 * them. The main process re-checks at runtime (src/electron/ptySpawnHelper.ts)
 * for installs that skipped lifecycle scripts.
 */
import { chmodSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const EXEC_BITS = 0o111;

if (process.platform !== "win32") {
  const require = createRequire(import.meta.url);
  let root = null;
  try {
    root = path.dirname(require.resolve("node-pty/package.json"));
  } catch {
    root = null; // node-pty not installed (e.g. --omit=optional) — nothing to fix.
  }

  const candidates = root
    ? [
        path.join(root, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper"),
        path.join(root, "build", "Release", "spawn-helper"),
      ]
    : [];

  for (const helper of candidates) {
    if (!existsSync(helper)) continue;
    const mode = statSync(helper).mode;
    if ((mode & EXEC_BITS) === EXEC_BITS) continue;
    chmodSync(helper, mode | EXEC_BITS);
    console.log(`[node-pty] restored executable bit on ${helper}`);
  }
}
