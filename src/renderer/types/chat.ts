/** ACP tool content: plain text/resource blocks or file diffs. */
export type ToolTextContent = {
  type: "content";
  text: string;
};

/** ACP Diff — oldText null/empty means new file. */
export type ToolDiff = {
  type: "diff";
  path: string;
  oldText?: string | null;
  newText: string;
};

/**
 * Image produced or read by a tool.
 * - Embedded: ACP `{ type: "image", data, mimeType }` → `data` set.
 * - On-disk (imagine): result JSON/rawOutput path → `path` set; UI loads via IPC.
 */
export type ToolImageContent = {
  type: "image";
  mimeType: string;
  /** Base64 without data: prefix when the agent embeds the bytes. */
  data?: string;
  /** Absolute filesystem path when the tool saved the image to disk. */
  path?: string;
  filename?: string;
};

/**
 * Video produced by imagine tools (`image_to_video` / `reference_to_video`).
 * - On-disk: `path` under `~/.grok/sessions/.../videos/` → UI plays via media IPC.
 * - ZDR upload-only: `uploadedUrl` remote URL, no local file.
 */
export type ToolVideoContent = {
  type: "video";
  mimeType: string;
  /** Absolute filesystem path when the tool saved the video locally. */
  path?: string;
  filename?: string;
  /** Remote URL when ZDR uploaded the video (no local path). */
  uploadedUrl?: string;
};

export type ToolContent =
  | ToolTextContent
  | ToolDiff
  | ToolImageContent
  | ToolVideoContent;

export type ToolCallItem = {
  id: string;
  title: string;
  status: string;
  kind?: string;
  locations?: Array<{ path?: string; line?: number | null }>;
  /** Structured tool output (text + diffs) from ACP tool_call / tool_call_update. */
  content?: ToolContent[];
  /** @deprecated Prefer content text blocks. */
  contentPreview?: string;
};

/**
 * Chronological pieces of an assistant turn — never reorder for display.
 *
 * Folds (Codex-like; order preserved):
 * - "Worked for Xm Ys" is a divider before the final response, not a fold.
 * - Consecutive tools + thoughts share one semantic activity fold. The title
 *   summarizes tool categories only (read / edit / command); expand to see L2
 *   thought and tool folds. Activity groups, tools, and thoughts all stay
 *   collapsed by default (open only via user click or search jump).
 * - Intermediate and final assistant text remain open and split activity groups.
 */
export type AssistantBlock =
  | { type: "text"; id: string; text: string }
  | { type: "thought"; id: string; text: string }
  | { type: "tool"; tool: ToolCallItem };

/** Image attached to a user message (local preview + ACP payload). */
export type ChatImage = {
  id: string;
  mimeType: string;
  /** data: URL for UI preview */
  dataUrl: string;
  width?: number;
  height?: number;
  /** Raw base64 without data: prefix — only set on draft attachments before send. */
  data?: string;
  /** Original filename when dropped / picked from disk. */
  name?: string;
};

/**
 * Non-image file attached to a user message.
 * Sent as ACP resource (text/blob) or resource_link (path-only).
 */
export type ChatFile = {
  id: string;
  name: string;
  mimeType: string;
  /** Absolute path when available (Electron drop / picker). */
  path?: string;
  /** Text body for text-like files (draft + send). */
  text?: string;
  /** Base64 blob for small binary non-images (draft + send). */
  data?: string;
  size?: number;
};

export type ChatMessage =
  | {
      id: string;
      role: "user";
      text: string;
      images?: ChatImage[];
      files?: ChatFile[];
      createdAt: number;
    }
  | {
      id: string;
      role: "assistant";
      blocks: AssistantBlock[];
      streaming: boolean;
      createdAt: number;
      /** When the turn finished (for "Worked for Xm Ys"). */
      finishedAt?: number;
    }
  | {
      id: string;
      role: "system";
      text: string;
      createdAt: number;
    };

/** UI row for an agent-backed session (id === agent sessionId). */
export type LocalSession = {
  id: string;
  title: string;
  cwd: string;
  createdAt: number;
  updatedAt?: number;
  messages: ChatMessage[];
  /** True after session/load finished (or for brand-new empty sessions). */
  historyReady: boolean;
  /** Agent turn currently running for this session. */
  running?: boolean;
  /**
   * Turn finished while this session was not focused — show a blue dot
   * until the user opens it (Codex-style).
   */
  unreadDone?: boolean;
  /** GUI-local scratch session hidden from the main Projects list. */
  isSideTask?: boolean;
  modelId?: string;
  numMessages?: number;
  source?: string;
  /** Set when the chat runs in an isolated git worktree (CLI `grok -w`). */
  worktree?: SessionWorktree;
};

/** Worktree facts a session row carries (badge + grouping under the repo). */
export type SessionWorktree = {
  id: string;
  /** Absolute path the session runs in. */
  path: string;
  /** Worktree directory name, e.g. `my-feature`. */
  label: string;
  /** Checkout the worktree branched from — sessions group under this. */
  sourcePath: string;
};

/** Plain assistant text (all text blocks joined). */
export function assistantText(
  m: Extract<ChatMessage, { role: "assistant" }>,
): string {
  let out = "";
  for (const b of m.blocks) {
    if (b.type === "text") out += b.text;
  }
  return out;
}

export function assistantHasThoughts(
  m: Extract<ChatMessage, { role: "assistant" }>,
): boolean {
  return m.blocks.some((b) => b.type === "thought" && b.text.length > 0);
}

export function assistantToolCount(
  m: Extract<ChatMessage, { role: "assistant" }>,
): number {
  return m.blocks.reduce((n, b) => (b.type === "tool" ? n + 1 : n), 0);
}
