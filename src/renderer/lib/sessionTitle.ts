/**
 * Session title display helpers.
 *
 * Agent list rows sometimes carry English placeholders (`Untitled session`).
 * The UI must treat those as "no title" so sidebar + topbar can localize the
 * same fallback (e.g. 未命名会话) instead of diverging.
 */

const PLACEHOLDER_TITLES = new Set([
  "",
  "untitled session",
  "new chat",
  "session",
  "new session",
]);

/** True when the stored title is empty or a known English placeholder. */
export function isPlaceholderSessionTitle(
  title: string | null | undefined,
): boolean {
  const t = (title ?? "").trim().toLowerCase();
  return PLACEHOLDER_TITLES.has(t);
}

/**
 * Prefer a real agent/local title over a placeholder.
 * Used when merging listSessions rows so optimistic short titles
 * (first user message) are not wiped by a still-untitled agent row.
 */
export function preferSessionTitle(
  agentTitle: string | null | undefined,
  localTitle: string | null | undefined,
): string {
  const agent = (agentTitle ?? "").trim();
  const local = (localTitle ?? "").trim();
  if (agent && !isPlaceholderSessionTitle(agent)) return agent;
  if (local && !isPlaceholderSessionTitle(local)) return local;
  // Keep empty rather than re-injecting English placeholders.
  return agent || local || "";
}
