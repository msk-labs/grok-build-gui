import type { AgentSessionSummary } from "../../electron/preload";
import type { LocalSession, SessionWorktree } from "../types/chat";
import { preferSessionTitle } from "./sessionTitle";

/**
 * Project a session belongs to. A worktree session's cwd lives under
 * `~/.grok/worktrees/…`, so bucket it with the checkout it branched from —
 * otherwise one project scatters into a group per worktree.
 */
export function sessionProjectCwd(s: LocalSession): string {
  return s.worktree?.sourcePath || s.cwd || "";
}

/** Renderer-only id used before session/new returns a real agent id. */
const PROVISIONAL_SESSION_PREFIX = "local:";

export function isProvisionalSessionId(id: string | null | undefined): boolean {
  return !!id && id.startsWith(PROVISIONAL_SESSION_PREFIX);
}

export function makeProvisionalSessionId(nonce: string): string {
  return `${PROVISIONAL_SESSION_PREFIX}${nonce}`;
}

/**
 * Rename a provisional first-send row to the real agent session id, merging
 * if session-loaded already inserted an empty real row.
 */
export function adoptProvisionalSession(
  prev: LocalSession[],
  provisionalId: string,
  realId: string,
  cwd: string,
): LocalSession[] {
  if (!provisionalId || !realId || provisionalId === realId) return prev;

  const provisional = prev.find((s) => s.id === provisionalId);
  const real = prev.find((s) => s.id === realId);

  if (!provisional) {
    // Already adopted (e.g. session-loaded remapped the row) or wiped.
    return prev;
  }

  const others = prev.filter((s) => s.id !== provisionalId && s.id !== realId);
  const merged: LocalSession = {
    ...(real ?? provisional),
    ...provisional,
    id: realId,
    cwd: cwd || real?.cwd || provisional.cwd,
    title: preferSessionTitle(real?.title, provisional.title),
    messages:
      provisional.messages.length > 0
        ? provisional.messages
        : (real?.messages ?? []),
    historyReady: true,
    running: !!(provisional.running || real?.running),
    unreadDone: false,
    isSideTask: provisional.isSideTask || real?.isSideTask,
    updatedAt: Math.max(
      provisional.updatedAt ?? 0,
      real?.updatedAt ?? 0,
      Date.now(),
    ),
    createdAt: Math.min(
      provisional.createdAt,
      real?.createdAt ?? provisional.createdAt,
    ),
  };
  return [merged, ...others];
}

export function fromAgentSummary(s: AgentSessionSummary): LocalSession {
  const created = Date.parse(s.createdAt);
  // Codex-style ordering follows conversation activity, not incidental record
  // updates caused by opening/loading a session.
  const updated = Date.parse(s.lastActiveAt || s.updatedAt || s.createdAt);
  return {
    id: s.sessionId,
    // Keep the absence of a title semantic. The sidebar/topbar localize the
    // fallback at render time instead of persisting an English placeholder.
    title: preferSessionTitle(s.title || s.summary || "", ""),
    cwd: s.cwd,
    createdAt: Number.isFinite(created) ? created : Date.now(),
    updatedAt: Number.isFinite(updated) ? updated : undefined,
    messages: [],
    historyReady: false,
    modelId: s.modelId,
    numMessages: s.numMessages,
    source: s.source,
    isSideTask: s.isSideTask,
    worktree: s.worktree,
  };
}

/**
 * Merge agent session list into UI state.
 * When `runningSessionIds` is provided (main-process truth), spinners follow
 * live turns only — fixes sticky "running" after a turn dies mid-flight.
 *
 * Title merge: a real local title (optimistic first-prompt snippet, or a prior
 * LLM title) wins over agent placeholders like "Untitled session" so list and
 * topbar stay in sync while generation is still in flight.
 *
 * Local-only rows (brand-new chats not yet in the agent index) are retained so
 * a racing listSessions cannot wipe the optimistic first-prompt title/messages.
 */
export function mergeSessionList(
  prev: LocalSession[],
  summaries: AgentSessionSummary[],
  runningSessionIds?: string[] | null,
): LocalSession[] {
  const prevById = new Map(prev.map((s) => [s.id, s]));
  const live =
    runningSessionIds != null ? new Set(runningSessionIds) : null;
  const seen = new Set<string>();
  const merged = summaries.map((row) => {
    seen.add(row.sessionId);
    const existing = prevById.get(row.sessionId);
    const base = fromAgentSummary(row);
    if (!existing) {
      return live ? { ...base, running: live.has(row.sessionId) } : base;
    }
    return {
      ...base,
      title: preferSessionTitle(base.title, existing.title),
      // Keep the more recent activity timestamp so a first prompt bumps sort
      // order even when the agent row still has a stale lastActiveAt.
      updatedAt: Math.max(base.updatedAt ?? 0, existing.updatedAt ?? 0) || base.updatedAt,
      messages: existing.messages,
      historyReady: existing.historyReady,
      running: live ? live.has(row.sessionId) : existing.running,
      unreadDone: existing.unreadDone,
      isSideTask: existing.isSideTask ?? base.isSideTask,
      // The registry is authoritative; keep a locally known worktree only
      // while the agent list has not caught up with the new row yet.
      worktree: base.worktree ?? existing.worktree,
    };
  });

  for (const s of prev) {
    if (seen.has(s.id)) continue;
    // Keep in-flight / just-created rows until the agent index catches up.
    if (s.running || s.historyReady || s.messages.length > 0) {
      merged.push(
        live ? { ...s, running: live.has(s.id) || !!s.running } : s,
      );
    }
  }

  return merged.sort(
    (a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt),
  );
}

/**
 * Apply the renderer notification emitted after session/new or session/load.
 *
 * The new-session notification can arrive after the first prompt has already
 * painted its optimistic user/assistant messages. Never reset an existing
 * transcript here: doing so leaves only later streaming updates visible.
 */
export function mergeLoadedSession(
  prev: LocalSession[],
  event: {
    sessionId: string;
    cwd: string;
    isNew: boolean;
    isSideTask?: boolean;
    worktree?: SessionWorktree;
  },
): LocalSession[] {
  const { sessionId, cwd, isNew, isSideTask, worktree } = event;
  const exists = prev.some((s) => s.id === sessionId);
  if (exists) {
    return prev.map((s) =>
      s.id === sessionId
        ? {
            ...s,
            cwd,
            historyReady: true,
            unreadDone: false,
            isSideTask: !!isSideTask || s.isSideTask,
            worktree: worktree ?? s.worktree,
          }
        : s,
    );
  }

  // First-send optimistic row uses a local: id until session/new returns.
  // Promote that row instead of inserting a second empty "Untitled" entry.
  if (isNew) {
    let provisional: LocalSession | undefined;
    for (const s of prev) {
      if (!isProvisionalSessionId(s.id)) continue;
      if (
        !provisional ||
        (s.updatedAt ?? s.createdAt) > (provisional.updatedAt ?? provisional.createdAt)
      ) {
        provisional = s;
      }
    }
    if (provisional) {
      return adoptProvisionalSession(prev, provisional.id, sessionId, cwd).map(
        (s) =>
          s.id === sessionId
            ? {
                ...s,
                isSideTask: !!isSideTask || s.isSideTask,
                worktree: worktree ?? s.worktree,
              }
            : s,
      );
    }
  }

  return [
    {
      id: sessionId,
      title: "",
      cwd,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      historyReady: true,
      isSideTask: !!isSideTask,
      worktree,
    },
    ...prev,
  ];
}

/** Prefer cwd of the most recently updated session, else fallback. */
export function preferLastSessionCwd(
  list: AgentSessionSummary[],
  fallback: string,
): string {
  let best: AgentSessionSummary | null = null;
  for (const s of list) {
    if (!s.cwd) continue;
    if (!best) {
      best = s;
      continue;
    }
    const t = Date.parse(s.lastActiveAt || s.updatedAt || s.createdAt);
    const bt = Date.parse(
      best.lastActiveAt || best.updatedAt || best.createdAt,
    );
    if ((Number.isFinite(t) ? t : 0) > (Number.isFinite(bt) ? bt : 0)) {
      best = s;
    }
  }
  // Worktree isolation is opt-in per chat: the startup draft must land in the
  // project, never inside the previous chat's worktree.
  return best?.worktree?.sourcePath || best?.cwd || fallback;
}
