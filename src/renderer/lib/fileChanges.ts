/**
 * Collect file-level change chips from assistant tool blocks (ACP diffs).
 */
import type { AssistantBlock, ToolCallItem, ToolDiff } from "../types/chat";
import { basename, lineStats, type LineStats } from "./lineDiff";

export type FileChangeKind = "edit" | "create" | "delete" | "read" | "other";

export type FileChange = {
  path: string;
  name: string;
  kind: FileChangeKind;
  stats: LineStats;
  /** Present when ACP sent a diff — used by the right-panel viewer. */
  oldText?: string | null;
  newText?: string;
  /** True when we only know the path (no old/new body). */
  pathOnly: boolean;
};

function kindFromTool(tool: ToolCallItem, diff: ToolDiff | null): FileChangeKind {
  if (diff) {
    if (diff.oldText == null || diff.oldText === "") return "create";
    if (!diff.newText) return "delete";
    return "edit";
  }
  const k = (tool.kind || "").toLowerCase();
  if (k === "edit") return "edit";
  if (k === "delete") return "delete";
  if (k === "read") return "read";
  return "other";
}

function firstDiff(tool: ToolCallItem): ToolDiff | null {
  for (const c of tool.content ?? []) {
    if (c.type === "diff") return c;
  }
  return null;
}

/** Prefer diff.path; else first location path. */
export function toolPrimaryPath(tool: ToolCallItem): string | null {
  const d = firstDiff(tool);
  if (d?.path) return d.path;
  const loc = tool.locations?.find((l) => l.path);
  return loc?.path ?? null;
}

/**
 * Unique file changes from a turn's blocks.
 * Edits/creates/deletes with diffs win over path-only reads.
 */
export function collectFileChanges(blocks: AssistantBlock[]): FileChange[] {
  const map = new Map<string, FileChange>();

  for (const b of blocks) {
    if (b.type !== "tool") continue;
    const tool = b.tool;
    const diffs = (tool.content ?? []).filter(
      (c): c is ToolDiff => c.type === "diff",
    );

    if (diffs.length > 0) {
      for (const d of diffs) {
        if (!d.path) continue;
        const stats = lineStats(d.oldText, d.newText);
        const kind = kindFromTool(tool, d);
        const prev = map.get(d.path);
        // Prefer entries that carry full text over path-only / weaker kinds.
        if (prev && !prev.pathOnly && prev.kind !== "read") {
          // Merge stats if same path touched twice.
          map.set(d.path, {
            ...prev,
            stats: {
              added: prev.stats.added + stats.added,
              removed: prev.stats.removed + stats.removed,
            },
            oldText: prev.oldText ?? d.oldText,
            newText: d.newText || prev.newText,
            kind: kind === "create" || prev.kind === "create" ? "create" : kind,
          });
        } else {
          map.set(d.path, {
            path: d.path,
            name: basename(d.path),
            kind,
            stats,
            oldText: d.oldText,
            newText: d.newText,
            pathOnly: false,
          });
        }
      }
      continue;
    }

    // Path-only: only surface edit/delete kinds in the end bar (not every read).
    const k = (tool.kind || "").toLowerCase();
    if (k !== "edit" && k !== "delete" && k !== "move") continue;
    for (const loc of tool.locations ?? []) {
      if (!loc.path) continue;
      if (map.has(loc.path)) continue;
      map.set(loc.path, {
        path: loc.path,
        name: basename(loc.path),
        kind: k === "delete" ? "delete" : "edit",
        stats: { added: 0, removed: 0 },
        pathOnly: true,
      });
    }
  }

  return [...map.values()];
}

/**
 * Append files detected on disk after the turn.
 *
 * Tool-reported changes win: they carry diffs and line stats, while an
 * artifact is only a path. A file that appears both ways (the agent edited it
 * *and* it is a spreadsheet) must not produce two rows.
 */
export function withTurnArtifacts(
  changes: FileChange[],
  artifacts: string[] | undefined,
): FileChange[] {
  if (!artifacts || artifacts.length === 0) return changes;

  // Tool paths are usually absolute while artifacts are workspace-relative,
  // so a plain equality check would let the same file through twice.
  const known = changes.map((c) => normalizePath(c.path));
  const extra: FileChange[] = [];
  for (const path of artifacts) {
    const key = normalizePath(path);
    if (!key) continue;
    if (known.some((p) => p === key || p.endsWith(`/${key}`))) continue;
    known.push(key);
    extra.push({
      path,
      name: basename(path),
      kind: "create",
      stats: { added: 0, removed: 0 },
      pathOnly: true,
    });
  }
  return [...changes, ...extra];
}

/** Compare by trailing path so `./a/b.xlsx` and `a/b.xlsx` are one file. */
function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

/** Whether this tool should show inline +N/-M on the fold label. */
export function toolEditStats(tool: ToolCallItem): LineStats | null {
  const diffs = (tool.content ?? []).filter(
    (c): c is ToolDiff => c.type === "diff",
  );
  if (diffs.length === 0) return null;
  let added = 0;
  let removed = 0;
  for (const d of diffs) {
    const s = lineStats(d.oldText, d.newText);
    added += s.added;
    removed += s.removed;
  }
  if (added === 0 && removed === 0) return null;
  return { added, removed };
}
