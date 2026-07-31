import type { LocalSession } from "../../types/chat";
import { sessionProjectCwd } from "../../lib/sessionList";

export type SessionGroup = {
  cwd: string;
  name: string;
  sessions: LocalSession[];
  latestAt: number;
};

/**
 * Default sessions shown per project before "Show more".
 * Matches Codex desktop (`wYl = 5` for project thread lists).
 */
export const PROJECT_SESSION_PREVIEW_LIMIT = 5;

export function folderName(cwd: string): string {
  if (!cwd) return "Unknown";
  const parts = cwd.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || cwd || "Unknown";
}

export function sessionTime(s: LocalSession): number {
  return s.updatedAt ?? s.createdAt ?? 0;
}

export function groupSessions(sessions: LocalSession[]): SessionGroup[] {
  const map = new Map<string, LocalSession[]>();
  for (const s of sessions) {
    const key = sessionProjectCwd(s);
    const list = map.get(key);
    if (list) list.push(s);
    else map.set(key, [s]);
  }

  return [...map.entries()]
    .map(([cwd, rows]) => {
      const sorted = [...rows].sort((a, b) => sessionTime(b) - sessionTime(a));
      return {
        cwd,
        name: folderName(cwd),
        sessions: sorted,
        latestAt: sorted[0] ? sessionTime(sorted[0]) : 0,
      };
    })
    .sort((a, b) => b.latestAt - a.latestAt);
}

export type GroupSessionVisibility = {
  /** Sessions to render (preview, full list, or preview + active). */
  visible: LocalSession[];
  /** True when the group has more sessions than the preview limit. */
  canToggle: boolean;
  /** How many sessions remain hidden while collapsed. */
  hiddenCount: number;
};

/**
 * Limit sessions shown under one project folder. When collapsed, keep the
 * active session visible even if it falls outside the preview window.
 */
export function getGroupSessionVisibility(
  sessions: LocalSession[],
  options: {
    expanded: boolean;
    activeId?: string | null;
    limit?: number;
  },
): GroupSessionVisibility {
  const limit = options.limit ?? PROJECT_SESSION_PREVIEW_LIMIT;
  if (sessions.length <= limit || options.expanded) {
    return {
      visible: sessions,
      canToggle: sessions.length > limit,
      hiddenCount: 0,
    };
  }

  const head = sessions.slice(0, limit);
  const activeId = options.activeId;
  if (activeId && !head.some((s) => s.id === activeId)) {
    const active = sessions.find((s) => s.id === activeId);
    if (active) {
      // Keep newest previews and pin the active row under them.
      return {
        visible: [...head, active],
        canToggle: true,
        hiddenCount: sessions.length - head.length - 1,
      };
    }
  }

  return {
    visible: head,
    canToggle: true,
    hiddenCount: sessions.length - head.length,
  };
}
