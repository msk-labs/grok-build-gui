/**
 * Recently used project folders, for quick re-selection in the new-chat
 * workspace picker.
 *
 * Two sources are merged at read time:
 * - folders picked explicitly (persisted here), and
 * - folders that already have chats (the session list).
 *
 * The session half means existing users see their projects immediately, with
 * no seeding step; the persisted half keeps a folder you picked but have not
 * sent anything in yet.
 */
import { isTaskWorkspaceCwd, normalizePath } from "./taskWorkspace";

export type RecentProject = {
  /** Absolute folder path. */
  cwd: string;
  /** Last use, epoch ms — newest first. */
  at: number;
};

const STORAGE_KEY = "grok-gui.recentProjects";
/** Long enough to cover a real rotation of projects, short enough to scan. */
export const RECENT_PROJECTS_LIMIT = 8;
/** Cap what we persist so a long history cannot grow without bound. */
const STORED_LIMIT = 32;

export function loadRecentProjects(): RecentProject[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: RecentProject[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const { cwd, at } = entry as { cwd?: unknown; at?: unknown };
      if (typeof cwd !== "string" || !cwd.trim()) continue;
      out.push({
        cwd,
        at: typeof at === "number" && Number.isFinite(at) ? at : 0,
      });
    }
    return out;
  } catch {
    return [];
  }
}

function save(list: RecentProject[]) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(list.slice(0, STORED_LIMIT)),
    );
  } catch {
    // Quota / private mode — ignore; in-session state still works.
  }
}

/** Move `cwd` to the front. Ephemeral task workspaces are never recorded. */
export function rememberRecentProject(cwd: string, now = Date.now()): void {
  const path = cwd.trim();
  if (!path || isTaskWorkspaceCwd(path)) return;
  const key = normalizePath(path);
  const rest = loadRecentProjects().filter(
    (p) => normalizePath(p.cwd) !== key,
  );
  save([{ cwd: path, at: now }, ...rest]);
}

export function forgetRecentProject(cwd: string): void {
  const key = normalizePath(cwd);
  save(loadRecentProjects().filter((p) => normalizePath(p.cwd) !== key));
}

/**
 * Newest-first, de-duplicated by normalized path. `exclude` drops the folder
 * already selected — offering it again is a no-op row.
 */
export function mergeRecentProjects(
  stored: RecentProject[],
  sessions: readonly { cwd?: string; updatedAt?: number }[],
  opts?: { exclude?: string; taskRoot?: string; limit?: number },
): RecentProject[] {
  const limit = opts?.limit ?? RECENT_PROJECTS_LIMIT;
  const excluded = opts?.exclude ? normalizePath(opts.exclude) : "";
  const newestByPath = new Map<string, RecentProject>();

  const consider = (cwd: string | undefined, at: number) => {
    const path = (cwd ?? "").trim();
    if (!path) return;
    if (isTaskWorkspaceCwd(path, opts?.taskRoot)) return;
    const key = normalizePath(path);
    if (!key || key === excluded) return;
    const seen = newestByPath.get(key);
    if (!seen) newestByPath.set(key, { cwd: path, at });
    else if (at > seen.at) seen.at = at;
  };

  for (const entry of stored) consider(entry.cwd, entry.at);
  for (const session of sessions) consider(session.cwd, session.updatedAt ?? 0);

  return [...newestByPath.values()]
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
}
