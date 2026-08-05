/**
 * Detect files an agent turn produced.
 *
 * The agent has no obligation to tell us. A turn that writes a spreadsheet by
 * shelling out to `python3 -c "...openpyxl..."` reports `kind: "execute"` with
 * an empty `locations` array — no diff, no path, nothing the transcript can
 * link to. So after a turn ends we look at the workspace itself and report the
 * previewable artifacts whose mtime falls inside the turn.
 *
 * Only formats a user would actually want to open are reported: a build that
 * rewrites a thousand `.js` files must not bury the one `.xlsx` that was the
 * point of the turn.
 */
import fs from "node:fs/promises";
import path from "node:path";

/** Extensions worth surfacing as a chip under the answer. */
const ARTIFACT_EXTENSIONS = new Set([
  ".xlsx", ".xls", ".ods", ".csv", ".tsv",
  ".docx", ".pptx", ".pdf",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg",
  ".md", ".markdown",
]);

/**
 * Mirrors the Files tree's hidden set — a file the tree refuses to show should
 * not appear as a chip either.
 */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "out",
  "__pycache__",
]);

const MAX_DEPTH = 8;
const MAX_ENTRIES = 40_000;
const MAX_RESULTS = 20;
/** Wall-clock ceiling; a huge monorepo must not stall the end of a turn. */
const MAX_DURATION_MS = 1_500;

export type ScanOptions = {
  /** Only report files modified at or after this epoch ms. */
  since: number;
  /** Injectable clock so the budget is testable. */
  now?: () => number;
};

export function isArtifactPath(filePath: string): boolean {
  return ARTIFACT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/**
 * Walk `root` breadth-first and return workspace-relative paths of previewable
 * files touched since `options.since`, newest first. Bounded on depth, entries
 * visited, results, and elapsed time — it returns what it found rather than
 * failing when a budget runs out.
 */
export async function scanWorkspaceArtifacts(
  root: string,
  options: ScanOptions,
): Promise<string[]> {
  const clock = options.now ?? Date.now;
  const deadline = clock() + MAX_DURATION_MS;
  const found: Array<{ rel: string; mtime: number }> = [];

  let visited = 0;
  let queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];

  while (queue.length > 0) {
    const next: Array<{ dir: string; depth: number }> = [];

    for (const { dir, depth } of queue) {
      if (visited >= MAX_ENTRIES || clock() > deadline) {
        queue = [];
        break;
      }

      let entries: import("node:fs").Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        continue; // Unreadable directory — skip, don't abort the scan.
      }

      for (const entry of entries) {
        visited += 1;
        if (entry.name.startsWith(".") && entry.isDirectory()) continue;
        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name)) continue;
          if (depth < MAX_DEPTH) next.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
          continue;
        }
        if (!entry.isFile() || !isArtifactPath(entry.name)) continue;

        const full = path.join(dir, entry.name);
        try {
          const stat = await fs.stat(full);
          if (stat.mtimeMs >= options.since) {
            found.push({ rel: path.relative(root, full), mtime: stat.mtimeMs });
          }
        } catch {
          // Raced with a delete — ignore.
        }
      }
    }

    queue = next;
  }

  return found
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, MAX_RESULTS)
    .map((entry) => entry.rel.split(path.sep).join("/"));
}
