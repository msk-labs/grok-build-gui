/**
 * Minimal line-level diff for ACP tool diffs (oldText / newText).
 * Pure helper — no React. Caps work for very large files.
 */

export type DiffLine =
  | { type: "same"; text: string; oldNo: number; newNo: number }
  | { type: "add"; text: string; newNo: number }
  | { type: "del"; text: string; oldNo: number };

export type LineStats = { added: number; removed: number };

const MAX_LINES = 4000;

function splitLines(text: string): string[] {
  if (!text) return [];
  // Keep trailing empty line semantics stable with String.split.
  const parts = text.split("\n");
  if (parts.length > 0 && parts[parts.length - 1] === "") {
    parts.pop();
  }
  return parts;
}

export function countLines(text: string | null | undefined): number {
  if (text == null || text === "") return 0;
  return splitLines(text).length;
}

/** +added / -removed for a before/after pair. new file ⇒ oldText null. */
export function lineStats(
  oldText: string | null | undefined,
  newText: string | null | undefined,
): LineStats {
  const a = splitLines(oldText ?? "");
  const b = splitLines(newText ?? "");
  if (a.length === 0) return { added: b.length, removed: 0 };
  if (b.length === 0) return { added: 0, removed: a.length };
  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    // Cheap fallback for huge files — avoid O(n*m) blow-up.
    return {
      added: Math.max(0, b.length - a.length),
      removed: Math.max(0, a.length - b.length),
    };
  }
  const lines = lineDiff(oldText ?? "", newText ?? "");
  let added = 0;
  let removed = 0;
  for (const row of lines) {
    if (row.type === "add") added += 1;
    else if (row.type === "del") removed += 1;
  }
  return { added, removed };
}

/**
 * LCS-based line diff (Myers-ish via DP). Fine for tool-sized edits.
 * For oversized inputs, falls back to a coarse block replace.
 */
export function lineDiff(
  oldText: string | null | undefined,
  newText: string | null | undefined,
): DiffLine[] {
  const a = splitLines(oldText ?? "");
  const b = splitLines(newText ?? "");

  if (a.length === 0 && b.length === 0) return [];
  if (a.length === 0) {
    return b.map((text, i) => ({ type: "add" as const, text, newNo: i + 1 }));
  }
  if (b.length === 0) {
    return a.map((text, i) => ({ type: "del" as const, text, oldNo: i + 1 }));
  }
  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    const out: DiffLine[] = [];
    for (let i = 0; i < a.length; i++) {
      out.push({ type: "del", text: a[i]!, oldNo: i + 1 });
    }
    for (let i = 0; i < b.length; i++) {
      out.push({ type: "add", text: b[i]!, newNo: i + 1 });
    }
    return out;
  }

  const n = a.length;
  const m = b.length;
  // DP table of LCS lengths
  const dp: Uint16Array[] = Array.from(
    { length: n + 1 },
    () => new Uint16Array(m + 1),
  );
  for (let i = n - 1; i >= 0; i--) {
    const row = dp[i]!;
    const next = dp[i + 1]!;
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) row[j] = (next[j + 1]! + 1) as number;
      else row[j] = Math.max(next[j]!, row[j + 1]!) as number;
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let oldNo = 1;
  let newNo = 1;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "same", text: a[i]!, oldNo, newNo });
      i += 1;
      j += 1;
      oldNo += 1;
      newNo += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ type: "del", text: a[i]!, oldNo });
      i += 1;
      oldNo += 1;
    } else {
      out.push({ type: "add", text: b[j]!, newNo });
      j += 1;
      newNo += 1;
    }
  }
  while (i < n) {
    out.push({ type: "del", text: a[i]!, oldNo });
    i += 1;
    oldNo += 1;
  }
  while (j < m) {
    out.push({ type: "add", text: b[j]!, newNo });
    j += 1;
    newNo += 1;
  }
  return out;
}

export function basename(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}
