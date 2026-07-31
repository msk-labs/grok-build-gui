/**
 * Runtime guard for node-pty's `spawn-helper`.
 *
 * node-pty posix_spawnp()s this shim for every PTY. Its npm tarball loses the
 * executable bit on some npm versions, and then every terminal fails to open
 * with "posix_spawnp failed." (EACCES). `scripts/fix-node-pty-helper.mjs`
 * repairs node_modules at install time; this covers installs that skipped
 * lifecycle scripts (`npm ci --ignore-scripts`) and app bundles built from one.
 *
 * No-op on Windows (conpty, no helper) and when the bit is already set.
 */
import { chmodSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const EXEC_BITS = 0o111;

/** node-pty applies the same rewrite to its own helper path. */
function unpacked(p: string): string {
  return p
    .replace("app.asar", "app.asar.unpacked")
    .replace("node_modules.asar", "node_modules.asar.unpacked");
}

function helperCandidates(): string[] {
  let root: string;
  try {
    root = path.dirname(createRequire(import.meta.url).resolve("node-pty/package.json"));
  } catch {
    return [];
  }
  const bases = [
    path.join(root, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper"),
    path.join(root, "build", "Release", "spawn-helper"),
  ];
  // Resolving from inside app.asar yields an asar path; node-pty loads the
  // unpacked twin, so repair whichever of the two is actually on disk.
  return [...new Set(bases.flatMap((p) => [p, unpacked(p)]))];
}

let done = false;

/** Idempotent; safe to call before every spawn. */
export function ensureSpawnHelperExecutable(): void {
  if (done || process.platform === "win32") return;
  done = true;
  for (const helper of helperCandidates()) {
    try {
      if (!existsSync(helper)) continue;
      const mode = statSync(helper).mode;
      if ((mode & EXEC_BITS) === EXEC_BITS) continue;
      chmodSync(helper, mode | EXEC_BITS);
    } catch {
      // Read-only location — let the spawn attempt surface the real error.
    }
  }
}
