/** Persist custom display names for project folders (keyed by cwd). */
const PROJECT_NAMES_KEY = "grok-gui.sidebar.projectNames";

export function loadProjectNames(): Record<string, string> {
  try {
    const raw = localStorage.getItem(PROJECT_NAMES_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string") {
        const name = v.trim();
        if (name) out[k] = name;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function saveProjectNames(names: Record<string, string>) {
  try {
    localStorage.setItem(PROJECT_NAMES_KEY, JSON.stringify(names));
  } catch {
    // Quota / private mode — ignore; in-session state still works.
  }
}
