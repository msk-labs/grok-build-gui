import { useEffect, useState } from "react";

/**
 * OS document icons for a list of file rows.
 *
 * Icons are per *type*, not per file, so the cache is keyed by extension and
 * shared across every transcript row in the window: a turn that writes ten
 * spreadsheets costs one lookup, and scrolling back costs none.
 */
const cache = new Map<string, string | undefined>();
/** In-flight lookups, so a re-render mid-fetch does not queue a second one. */
const pending = new Map<string, Promise<void>>();

export function extensionOf(filePath: string): string {
  const name = filePath.replace(/\\/g, "/").split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

async function load(ext: string, root: string, path: string): Promise<void> {
  try {
    const res = await window.grok?.fileIcon?.({ root, path });
    cache.set(ext, res?.ok ? res.dataUrl : undefined);
  } catch {
    // Missing file or unsupported platform — rows fall back to the glyph.
    cache.set(ext, undefined);
  } finally {
    pending.delete(ext);
  }
}

/**
 * Returns `extension → data URL`. Extensions with no OS icon map to
 * `undefined`, which callers render as the built-in glyph.
 */
export function useFileIcons(
  paths: string[],
  root: string | undefined,
): Map<string, string | undefined> {
  const [, bump] = useState(0);
  // Re-run only when the *set of extensions* changes, not on every re-render.
  const wanted = [...new Set(paths.map(extensionOf).filter(Boolean))]
    .sort()
    .join(",");

  useEffect(() => {
    if (!root || !window.grok?.fileIcon) return;
    let cancelled = false;

    const missing = wanted
      .split(",")
      .filter((ext) => ext && !cache.has(ext) && !pending.has(ext));
    if (missing.length === 0) return;

    for (const ext of missing) {
      const sample = paths.find((p) => extensionOf(p) === ext);
      if (!sample) continue;
      const task = load(ext, root, sample).then(() => {
        if (!cancelled) bump((n) => n + 1);
      });
      pending.set(ext, task);
    }

    return () => {
      cancelled = true;
    };
    // `paths` is only read to pick a sample file for each new extension.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, root]);

  return cache;
}
