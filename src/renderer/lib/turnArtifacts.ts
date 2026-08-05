/**
 * Persist the files a turn produced.
 *
 * The agent's own transcript has no record of them: a spreadsheet written by a
 * shell command arrives as an `execute` tool call with no diff and no
 * locations, so we detect it by scanning the workspace after the turn. That
 * detection is ours alone — replaying `session/load` rebuilds the messages from
 * the agent's stored updates and would drop it. Without this store the file
 * chips vanish the moment the app restarts.
 *
 * Turns are keyed by their ordinal among the session's assistant messages,
 * which survives a reload because history replays in the same order.
 */
import type { ChatMessage } from "../types/chat";

const KEY = "grok.turnArtifacts.v1";
/** Keep the store small — old sessions are evicted oldest-first. */
const MAX_SESSIONS = 50;

type Store = Record<string, Record<string, string[]>>;

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function write(store: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // Quota or private mode — chips simply won't survive a restart.
  }
}

/** Ordinal of the newest assistant message, or -1 when there is none. */
export function lastAssistantOrdinal(messages: ChatMessage[]): number {
  let ordinal = -1;
  for (const msg of messages) {
    if (msg.role === "assistant") ordinal += 1;
  }
  return ordinal;
}

export function saveTurnArtifacts(
  sessionId: string,
  ordinal: number,
  paths: string[],
): void {
  if (!sessionId || ordinal < 0 || paths.length === 0) return;

  const store = read();
  const session = { ...(store[sessionId] ?? {}), [String(ordinal)]: paths };
  delete store[sessionId];
  // Re-inserting moves the session to the end, so the oldest key is evicted.
  store[sessionId] = session;

  const ids = Object.keys(store);
  for (const stale of ids.slice(0, Math.max(0, ids.length - MAX_SESSIONS))) {
    delete store[stale];
  }
  write(store);
}

/** Re-attach stored artifacts to a freshly replayed transcript. */
export function restoreTurnArtifacts(
  sessionId: string,
  messages: ChatMessage[],
): ChatMessage[] {
  const session = read()[sessionId];
  if (!session) return messages;

  let ordinal = -1;
  let changed = false;
  const next = messages.map((msg) => {
    if (msg.role !== "assistant") return msg;
    ordinal += 1;
    const paths = session[String(ordinal)];
    if (!paths || paths.length === 0) return msg;
    changed = true;
    return { ...msg, artifacts: paths };
  });
  return changed ? next : messages;
}

export function forgetSessionArtifacts(sessionId: string): void {
  const store = read();
  if (!(sessionId in store)) return;
  delete store[sessionId];
  write(store);
}
