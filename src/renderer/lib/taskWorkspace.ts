/** Normalize path separators for prefix checks (macOS / Windows). */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * True when `cwd` is under the task workspace root
 * (`~/Documents/GrokBuildGUI/...`).
 *
 * Falls back to a path-segment check so auto-created timestamp folders
 * never show up as project groups while the root IPC is still loading.
 */
export function isTaskWorkspaceCwd(cwd: string, root = ""): boolean {
  if (!cwd) return false;
  const c = normalizePath(cwd);
  if (!c) return false;
  if (root) {
    const r = normalizePath(root);
    if (r && (c === r || c.startsWith(`${r}/`))) return true;
  }
  // .../GrokBuildGUI or .../GrokBuildGUI/<timestamp>
  return /(^|\/)GrokBuildGUI(\/|$)/i.test(c);
}
