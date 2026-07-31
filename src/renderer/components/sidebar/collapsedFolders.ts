/** Persist which workspace folders are collapsed in the sidebar. */
const COLLAPSED_FOLDERS_KEY = "grok-gui.sidebar.collapsedFolders";

export function loadCollapsedFolders(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COLLAPSED_FOLDERS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "boolean") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveCollapsedFolders(collapsed: Record<string, boolean>) {
  try {
    localStorage.setItem(COLLAPSED_FOLDERS_KEY, JSON.stringify(collapsed));
  } catch {
    // Quota / private mode — ignore; in-session state still works.
  }
}
