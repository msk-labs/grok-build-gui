import type { ChatMessage, LocalSession } from "../types/chat";
import { assistantText } from "../types/chat";

function projectNameFromCwd(cwd: string): string {
  if (!cwd) return "Unknown";
  const parts = cwd.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || cwd || "Unknown";
}

export type ChatSearchHit = {
  /** Stable key for list rendering. */
  id: string;
  sessionId: string;
  sessionTitle: string;
  cwd: string;
  /** Project folder label. */
  projectName: string;
  /** Message to open / scroll to (omit for title-only / agent content hits). */
  messageId?: string;
  role?: ChatMessage["role"];
  /**
   * title = session metadata only (local).
   * message = body match with known messageId (local, opened history).
   * content = agent FTS hit (title/body; resolve message after load).
   */
  kind: "title" | "message" | "content";
  /** Short context with the match for the results list. */
  snippet: string;
  /** Original search string (for in-chat highlight after navigation). */
  query: string;
};

/** Wire shape from `window.grok.searchSessions` / agent FTS. */
export type AgentSearchHitInput = {
  sessionId: string;
  cwd: string;
  summary: string;
  snippet?: string;
  matchedFields?: string[];
  score?: number;
};

const SNIPPET_RADIUS = 48;
const MAX_HITS_PER_SESSION = 8;
const MAX_TOTAL_HITS = 80;

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase();
}

/** Plain text for a chat message (user/system body or assistant text blocks). */
export function messageSearchText(m: ChatMessage): string {
  if (m.role === "user" || m.role === "system") return m.text || "";
  if (m.role === "assistant") return assistantText(m);
  return "";
}

function indexOfInsensitive(hay: string, needle: string): number {
  if (!needle) return -1;
  return hay.toLowerCase().indexOf(needle.toLowerCase());
}

/** Build a one-line snippet around the first match. */
export function makeSnippet(text: string, query: string): string {
  const q = query.trim();
  if (!q || !text) return text.slice(0, SNIPPET_RADIUS * 2).trim();
  const idx = indexOfInsensitive(text, q);
  if (idx < 0) {
    const oneLine = text.replace(/\s+/g, " ").trim();
    return oneLine.length > SNIPPET_RADIUS * 2
      ? `${oneLine.slice(0, SNIPPET_RADIUS * 2)}…`
      : oneLine;
  }
  const start = Math.max(0, idx - SNIPPET_RADIUS);
  const end = Math.min(text.length, idx + q.length + SNIPPET_RADIUS);
  let snip = text.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) snip = `…${snip}`;
  if (end < text.length) snip = `${snip}…`;
  return snip;
}

/**
 * Search sessions (title / path) and loaded message bodies.
 * Unopened sessions only match title/cwd until their history is loaded.
 * Prefer {@link mergeChatSearchHits} with agent FTS for full corpus body search.
 */
export function searchChats(
  sessions: LocalSession[],
  query: string,
): ChatSearchHit[] {
  const q = normalizeQuery(query);
  if (!q) return [];
  const rawQuery = query.trim();

  const hits: ChatSearchHit[] = [];

  for (const session of sessions) {
    if (hits.length >= MAX_TOTAL_HITS) break;

    const title = session.title || "Untitled session";
    const projectName = projectNameFromCwd(session.cwd || "");
    const cwd = session.cwd || "";
    let sessionHits = 0;

    const titleHay = `${title} ${projectName} ${cwd}`.toLowerCase();
    if (titleHay.includes(q)) {
      hits.push({
        id: `${session.id}:title`,
        sessionId: session.id,
        sessionTitle: title,
        cwd,
        projectName,
        kind: "title",
        snippet: title,
        query: rawQuery,
      });
      sessionHits++;
    }

    if (!session.messages?.length) continue;

    for (const m of session.messages) {
      if (hits.length >= MAX_TOTAL_HITS || sessionHits >= MAX_HITS_PER_SESSION) {
        break;
      }
      const text = messageSearchText(m);
      if (!text) continue;
      if (indexOfInsensitive(text, q) < 0) continue;

      hits.push({
        id: `${session.id}:${m.id}`,
        sessionId: session.id,
        sessionTitle: title,
        cwd,
        projectName,
        messageId: m.id,
        role: m.role,
        kind: "message",
        snippet: makeSnippet(text, rawQuery),
        query: rawQuery,
      });
      sessionHits++;
    }
  }

  // Prefer message hits over pure title, then recent sessions (input order is
  // already newest-first from mergeSessionList).
  hits.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "message" ? -1 : 1;
    return 0;
  });

  return hits;
}

/** Convert agent FTS rows into chat search hits. */
export function agentHitsToChatSearchHits(
  agentHits: AgentSearchHitInput[],
  query: string,
): ChatSearchHit[] {
  const rawQuery = query.trim();
  if (!rawQuery) return [];
  return agentHits.map((h) => {
    const title = h.summary?.trim() || "Untitled session";
    const cwd = h.cwd || "";
    const fields = (h.matchedFields ?? []).map((f) => f.toLowerCase());
    const bodyish =
      fields.some((f) => f === "content" || f.includes("content")) ||
      Boolean(h.snippet?.trim());
    return {
      id: `${h.sessionId}:agent`,
      sessionId: h.sessionId,
      sessionTitle: title,
      cwd,
      projectName: projectNameFromCwd(cwd),
      kind: bodyish ? ("content" as const) : ("title" as const),
      snippet: (h.snippet?.trim() || title).replace(/\s+/g, " "),
      query: rawQuery,
    };
  });
}

/**
 * Merge local (loaded messages) + agent FTS hits.
 * Prefer precise local message hits; agent fills bodies for unopened sessions.
 */
export function mergeChatSearchHits(
  localHits: ChatSearchHit[],
  agentHits: ChatSearchHit[],
): ChatSearchHit[] {
  const out: ChatSearchHit[] = [];
  const sessionsWithMessage = new Set<string>();
  const seenIds = new Set<string>();

  for (const h of localHits) {
    if (h.kind === "message") {
      out.push(h);
      sessionsWithMessage.add(h.sessionId);
      seenIds.add(h.id);
    }
  }

  for (const h of agentHits) {
    if (sessionsWithMessage.has(h.sessionId)) continue;
    if (seenIds.has(h.id)) continue;
    out.push(h);
    seenIds.add(h.id);
  }

  for (const h of localHits) {
    if (h.kind !== "title") continue;
    if (sessionsWithMessage.has(h.sessionId)) continue;
    // Agent already covered this session (content or title).
    if (out.some((x) => x.sessionId === h.sessionId)) continue;
    if (seenIds.has(h.id)) continue;
    out.push(h);
    seenIds.add(h.id);
  }

  return out.slice(0, MAX_TOTAL_HITS);
}

/** First message id whose searchable text contains `query` (case-insensitive). */
export function findMessageIdForQuery(
  messages: ChatMessage[],
  query: string,
): string | null {
  const q = normalizeQuery(query);
  if (!q) return null;
  for (const m of messages) {
    const text = messageSearchText(m);
    if (text && indexOfInsensitive(text, q) >= 0) return m.id;
  }
  return null;
}

/**
 * Split plain text into runs for <mark> highlighting of `query`.
 * Case-insensitive; non-overlapping sequential matches.
 */
export function splitHighlightRuns(
  text: string,
  query: string,
): Array<{ text: string; hit: boolean }> {
  const q = query.trim();
  if (!q || !text) return [{ text, hit: false }];

  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const runs: Array<{ text: string; hit: boolean }> = [];
  let i = 0;
  while (i < text.length) {
    const at = lower.indexOf(needle, i);
    if (at < 0) {
      runs.push({ text: text.slice(i), hit: false });
      break;
    }
    if (at > i) runs.push({ text: text.slice(i, at), hit: false });
    runs.push({ text: text.slice(at, at + q.length), hit: true });
    i = at + Math.max(q.length, 1);
  }
  return runs.length ? runs : [{ text, hit: false }];
}
