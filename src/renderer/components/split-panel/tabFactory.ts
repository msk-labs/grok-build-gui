import type { SplitPlacement, SplitTab, SplitTool } from "./types";

const seqByPrefix = new Map<string, number>();

/** Stable unique tab/PTY id, e.g. `right-1`, `bottom-2`. */
export function makeTabId(placement: SplitPlacement): string {
  const n = (seqByPrefix.get(placement) ?? 0) + 1;
  seqByPrefix.set(placement, n);
  return `${placement}-${n}`;
}

export function makeTab(
  placement: SplitPlacement,
  tool: SplitTool = "terminal",
): SplitTab {
  return { id: makeTabId(placement), tool };
}

/** Last path segment of shell cwd (Codex-style terminal tab title). */
export function folderName(cwd: string | undefined): string {
  if (!cwd) return "Terminal";
  const parts = cwd.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || cwd || "Terminal";
}
