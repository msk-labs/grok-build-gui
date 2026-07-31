import type { LocalSession } from "../../types/chat";
import { folderName, groupSessions, type SessionGroup } from "./groupSessions";

/** Normalize for case-insensitive substring match. */
export function normalizeQuery(q: string): string {
  return q.trim().toLowerCase();
}

/**
 * Match a session against a search query (title, folder name, full cwd, id prefix).
 * Empty query matches everything.
 */
export function sessionMatchesQuery(session: LocalSession, query: string): boolean {
  const q = normalizeQuery(query);
  if (!q) return true;
  const title = (session.title || "").toLowerCase();
  const cwd = (session.cwd || "").toLowerCase();
  const folder = folderName(session.cwd || "").toLowerCase();
  const id = (session.id || "").toLowerCase();
  return (
    title.includes(q) ||
    folder.includes(q) ||
    cwd.includes(q) ||
    id.startsWith(q) ||
    id.includes(q)
  );
}

/** Filter sessions then regroup (same Project folder layout as the full list). */
export function filterSessionGroups(
  sessions: LocalSession[],
  query: string,
): SessionGroup[] {
  const q = normalizeQuery(query);
  if (!q) return groupSessions(sessions);
  const matched = sessions.filter((s) => sessionMatchesQuery(s, q));
  return groupSessions(matched);
}
