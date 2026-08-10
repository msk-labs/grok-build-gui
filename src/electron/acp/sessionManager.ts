import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import type { BrowserWindow } from "electron";
import { HistoryMessageAccumulator } from "../../renderer/lib/sessionUpdate";
import type { ChatMessage } from "../../renderer/types/chat";
import { computerUseManager } from "../computerUse.js";
import { findGrok } from "../findGrok.js";
import {
  managedModelEnvironment,
  syncManagedModelConfig,
} from "../providers/modelSync.js";
import {
  normalizeAgentSlashCommands,
  type SlashCommand,
} from "../slashCommands.js";
import { buildSystemProxyEnvironment } from "../systemProxy.js";
import { scanWorkspaceArtifacts } from "../workspaceArtifacts.js";
import {
  readReasoningEffortPreference,
  writeReasoningEffortPreference,
} from "./reasoningPreference.js";
import { GROK_AGENT_STDIO_ARGS } from "./agentProcess.js";
import { modelResyncArgs } from "./modelResync.js";

/** Grok extension methods use a leading `_` on the wire (ACP convention). */
const XAI_SESSION_LIST = "_x.ai/session/list";
/**
 * Worktree extension methods (same backend as CLI `grok worktree` / `-w`).
 * `create` only registers + materializes the tree; the session must then be
 * opened with `cwd` = the returned worktree path — creating a worktree does
 * NOT move an existing session into it.
 */
const XAI_WORKTREE_CREATE = "_x.ai/git/worktree/create";
const XAI_WORKTREE_LIST = "_x.ai/git/worktree/list";
const XAI_WORKTREE_REMOVE = "_x.ai/git/worktree/remove";
/** Progress/terminal notification for an in-flight `worktree/create`. */
const XAI_WORKTREE_STATUS = "_x.ai/git/worktree/status";
/** Worktree creation is CoW-fast, but a cold/huge repo can still take a while. */
const WORKTREE_CREATE_TIMEOUT_MS = 120_000;
/** Agent FTS search (TUI deep search). Try underscore + bare method names. */
const XAI_SESSION_SEARCH_METHODS = [
  "_x.ai/session/search",
  "x.ai/session/search",
] as const;
/**
 * Permanent session delete (TUI uses this; standard ACP `session/delete` is
 * not implemented by grok agent). Try underscore + bare method names.
 */
const XAI_SESSION_DELETE_METHODS = [
  "_x.ai/session/delete",
  "x.ai/session/delete",
] as const;
/**
 * Rename a session title (TUI uses this). Try underscore + bare method names.
 */
const XAI_SESSION_RENAME_METHODS = [
  "_x.ai/session/rename",
  "x.ai/session/rename",
] as const;
const HISTORY_PREVIEW_INTERVAL_MS = 120;
const HISTORY_PREVIEW_LIMIT = 4;

/**
 * Side-task sessions are temporary even though the agent persists every ACP
 * session. Keep their ids in main so renderer/app restarts cannot promote them
 * into the normal session list before cleanup runs.
 */
function sideTaskSessionsPath(): string {
  return join(homedir(), ".grok", "gui", "side-task-sessions.json");
}

function readPersistedSideTaskIds(): string[] {
  try {
    const raw = readFileSync(sideTaskSessionsPath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return [];
    const ids = (parsed as { sessionIds?: unknown }).sessionIds;
    if (!Array.isArray(ids)) return [];
    return ids.filter((x): x is string => typeof x === "string" && x.length > 0);
  } catch {
    return [];
  }
}

function writePersistedSideTaskIds(ids: Iterable<string>) {
  try {
    const dir = join(homedir(), ".grok", "gui");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      sideTaskSessionsPath(),
      JSON.stringify({ sessionIds: [...new Set(ids)], updatedAt: Date.now() }),
      "utf8",
    );
  } catch {
    // Best-effort. The in-memory registry still protects this process.
  }
}

/** One row from `_x.ai/session/list` (same store as CLI `grok sessions`). */
export type AgentSessionSummary = {
  sessionId: string;
  title: string;
  summary: string;
  cwd: string;
  updatedAt: string;
  createdAt: string;
  modelId?: string;
  numMessages?: number;
  source?: string;
  lastActiveAt?: string;
  /** Main-process registry flag; renderer must hide this row from Projects. */
  isSideTask?: boolean;
  /** Set when this session runs inside a grok-managed git worktree. */
  worktree?: SessionWorktree;
};

/** Worktree facts the renderer needs for a session row (badge + grouping). */
export type SessionWorktree = {
  /** Worktree id in `~/.grok/worktrees.db` (empty when only inferred). */
  id: string;
  /** Absolute path the session actually runs in. */
  path: string;
  /** Directory-name label, e.g. `my-feature` or `2026-07-28-6fccc134`. */
  label: string;
  /** Absolute path of the checkout the worktree branched from. */
  sourcePath: string;
};

/** One row from `_x.ai/git/worktree/list` (same store as `grok worktree list`). */
export type WorktreeRecord = SessionWorktree & {
  sessionId: string;
  repoName: string;
  gitRef: string;
  headCommit: string;
  createdAt: number | null;
  status: string;
};

/** Draft options for "start this chat in an isolated worktree". */
export type WorktreeCreateOptions = {
  /** Worktree directory name. Empty → agent picks a dated one. */
  label?: string;
  /** Branch/tag/commit to base on. Empty → current HEAD of the source. */
  gitRef?: string;
};

/** `_x.ai/git/worktree/status` notification (creation progress + outcome). */
export type WorktreeStatusEvent = {
  status: string;
  sessionId?: string;
  message?: string;
  worktreePath?: string;
  error?: string;
  copiedChanges?: {
    stagedCopied?: number;
    modifiedCopied?: number;
    untrackedCopied?: number;
    deletionsApplied?: number;
    warnings?: string[];
  };
};

/**
 * Worktree extension results come back double-wrapped (`{ result: payload }`)
 * while plain ACP methods do not. Accept both so a wire change cannot break us.
 */
function unwrapExt<T>(raw: unknown): T | null {
  if (!raw || typeof raw !== "object") return null;
  const outer = raw as { result?: unknown };
  if (outer.result !== undefined) return outer.result as T;
  return raw as T;
}

/** The agent reports source roots both with and without a trailing slash. */
function trimTrailingSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

function labelFromWorktree(row: Record<string, unknown>, path: string): string {
  const meta = row.metadata;
  if (meta && typeof meta === "object") {
    const label = (meta as Record<string, unknown>).label;
    if (typeof label === "string" && label.trim()) return label.trim();
  }
  return path.split("/").filter(Boolean).at(-1) ?? "";
}

function normalizeWorktreeRow(
  row: Record<string, unknown>,
): WorktreeRecord | null {
  const path = String(row.path ?? "");
  if (!path) return null;
  const createdRaw = row.created_at ?? row.createdAt;
  return {
    id: String(row.id ?? ""),
    path,
    label: labelFromWorktree(row, path),
    sourcePath: trimTrailingSlash(
      String(row.source_repo ?? row.sourceRepo ?? ""),
    ),
    sessionId: String(row.session_id ?? row.sessionId ?? ""),
    repoName: String(row.repo_name ?? row.repoName ?? ""),
    gitRef: String(row.git_ref ?? row.gitRef ?? ""),
    headCommit: String(row.head_commit ?? row.headCommit ?? ""),
    createdAt: typeof createdRaw === "number" ? createdRaw : null,
    status: String(row.status ?? ""),
  };
}

/** One hit from agent `x.ai/session/search` (SQLite FTS5). */
export type AgentSessionSearchHit = {
  sessionId: string;
  cwd: string;
  summary: string;
  updatedAt: string;
  score: number;
  matchedFields: string[];
  snippet?: string;
};

export type AgentSessionSearchResult = {
  results: AgentSessionSearchHit[];
  bootstrapping: boolean;
  nextOffset?: number;
  totalEstimate?: number;
};

/** Grok permission modes (maps to Codex-style approval chips). */
export type PermissionMode = "ask" | "auto" | "always-approve";

/** Client-supplied stdio MCP (e.g. the GUI's built-in browser tools). */
export type ClientMcpStdio = {
  name: string;
  command: string;
  args: string[];
  env: Array<{ name: string; value: string }>;
};

/** `_meta` for session/new + session/load so agent seeds yolo/auto correctly. */
export function permissionMeta(mode: PermissionMode): {
  yoloMode: boolean;
  autoMode: boolean;
  permission_mode: PermissionMode;
} {
  return {
    yoloMode: mode === "always-approve",
    autoMode: mode === "auto",
    permission_mode: mode,
  };
}

/** One selectable reasoning-effort row (from model meta or fallback). */
export type ReasoningEffortOption = {
  id: string;
  value: string;
  label: string;
  description?: string;
  default?: boolean;
};

export type ModelInfo = {
  modelId: string;
  name: string;
  /** True when the agent advertises `supportsReasoningEffort` on this model. */
  supportsReasoningEffort?: boolean;
  /** Catalog default effort for this model (static; session override is ModelState.currentReasoningEffort). */
  defaultReasoningEffort?: string | null;
  /** Server-provided menu; empty/absent → client uses High/Medium/Low fallback. */
  reasoningEfforts?: ReasoningEffortOption[];
  /**
   * Context window advertised by the agent (`_meta.totalContextTokens`), which
   * itself comes from the model catalog (`context_window`). Null when the agent
   * does not report one — the renderer then falls back / uses a user override.
   */
  contextWindowTokens?: number | null;
};

export type ModelState = {
  currentModelId: string | null;
  /** Session/current effort when the active model supports it. */
  currentReasoningEffort: string | null;
  availableModels: ModelInfo[];
};

/** Per-turn token split, from the prompt response `_meta` (last model call). */
export type ContextTurnUsage = {
  inputTokens: number;
  outputTokens: number;
  /** Prefix served from cache — part of `inputTokens`, not extra. */
  cachedReadTokens: number;
  /** Thinking tokens — part of `outputTokens`, not extra. */
  reasoningTokens: number;
};

/** Cumulative session counters from the prompt response `_meta.usage`. */
export type ContextSessionUsage = {
  /** Sum over every model call this turn made (NOT the context size). */
  totalTokens: number;
  modelCalls: number;
  numTurns: number;
};

/**
 * Context-window occupancy for one agent session.
 *
 * The agent stamps `_meta.totalTokens` on every `session/update` — it is the
 * input+output of the most recent model call, i.e. what is actually sitting in
 * the model's context right now. It is NOT the session's cumulative spend
 * (`_meta.usage.totalTokens` sums every call and can exceed the window).
 * Replayed history carries the same stamp, so a resumed session recovers its
 * gauge without waiting for a new turn.
 *
 * Only `usedTokens` comes from the agent; the window size is resolved in the
 * renderer so a user override can win over the catalog value.
 */
export type ContextUsage = {
  sessionId: string;
  usedTokens: number;
  /** Model that produced `usedTokens` — the renderer sizes the bar by it. */
  modelId: string | null;
  lastTurn?: ContextTurnUsage | null;
  session?: ContextSessionUsage | null;
};

/** Built-in menu when a model supports effort but sends no `reasoningEfforts` list. */
export const DEFAULT_REASONING_EFFORTS: ReasoningEffortOption[] = [
  {
    id: "high",
    value: "high",
    label: "high",
    description: "Heavy reasoning",
  },
  {
    id: "medium",
    value: "medium",
    label: "medium",
    description: "Balanced reasoning",
  },
  {
    id: "low",
    value: "low",
    label: "low",
    description: "Faster, lighter reasoning",
  },
];

/** Display labels: high / medium / low only (no "effort" wording). */
function cleanEffortLabel(value: string, label?: string | null): string {
  const key = value
    .toLowerCase()
    .replace(/[\s_-]*effort$/i, "")
    .trim();
  if (key === "high" || key === "medium" || key === "low") return key;
  const raw = (label && label.trim()) || value;
  const stripped = raw
    .replace(/\beffort\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return stripped || key || value;
}

/** Effort options for a model: server list when usable, else high/medium/low. */
export function effortOptionsForModel(
  model: ModelInfo | undefined | null,
): ReasoningEffortOption[] {
  if (!model?.supportsReasoningEffort) return [];
  const list = model.reasoningEfforts;
  const source =
    list && list.length > 0 ? list : DEFAULT_REASONING_EFFORTS;
  return source.map((o) => ({
    ...o,
    label: cleanEffortLabel(o.value, o.label),
  }));
}

function preferredEffortForModel(
  model: ModelInfo | undefined,
  preferred: string,
): string | undefined {
  if (!model?.supportsReasoningEffort) return undefined;
  const options = effortOptionsForModel(model);
  const match = options.find(
    (option) => option.value === preferred || option.id === preferred,
  );
  return (
    match?.value ??
    model.defaultReasoningEffort ??
    options.find((option) => option.default)?.value ??
    options[0]?.value
  );
}

export type ConnectionState =
  | { status: "disconnected" }
  | { status: "connecting" }
  | {
      status: "ready";
      grokPath: string;
      version: string | null;
      /** Active agent session id, or null when connected but none selected. */
      sessionId: string | null;
      cwd: string;
      modelId?: string;
      loadingHistory?: boolean;
      models?: ModelState;
      permissionMode?: PermissionMode;
    }
  | { status: "error"; message: string };

/** connect() result — includes session list when ready (or [] on error). */
export type ConnectResult = ConnectionState & {
  sessions?: AgentSessionSummary[];
  /**
   * Live turns after connect: local map + reattached leader turns
   * (persisted across Electron restarts when using `--leader`).
   */
  runningSessionIds?: string[];
};

/**
 * One-shot snapshot for renderer mount / HMR rehydrate.
 * Main process is the source of truth for connection + in-flight turns.
 */
export type BootstrapSnapshot = {
  state: ConnectionState;
  sessions: AgentSessionSummary[];
  runningSessionIds: string[];
  /** Focused agent session id (may be null even when turns run in background). */
  activeSessionId: string | null;
  activeCwd: string;
};

export type PermissionRequestPayload = {
  requestId: string;
  /** Agent session that requested permission (for multi-session routing). */
  sessionId?: string;
  toolCall: {
    toolCallId?: string;
    title?: string;
    kind?: string;
    rawInput?: unknown;
  };
  options: Array<{ optionId: string; name: string; kind: string }>;
};

type PendingPermission = {
  resolve: (response: acp.RequestPermissionResponse) => void;
};

const BUILTIN_BROWSER_MCP_TOOLS = new Set([
  "browser_open",
  "browser_snapshot",
  "browser_navigate",
  "browser_click",
  "browser_fill",
  "browser_press_key",
  "browser_scroll",
  "browser_screenshot",
  "browser_wait_for",
]);

function isBuiltinBrowserMcpPermission(
  params: acp.RequestPermissionRequest,
): boolean {
  const raw = params.toolCall?.rawInput;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const record = raw as Record<string, unknown>;
  const rawName =
    typeof record.tool_name === "string"
      ? record.tool_name
      : typeof record.toolName === "string"
        ? record.toolName
        : "";
  if (!rawName) return false;
  const toolName = rawName.split(/__|[.:/]/).filter(Boolean).at(-1) ?? "";
  return BUILTIN_BROWSER_MCP_TOOLS.has(toolName);
}

/** First "allow"-flavoured option, or null when the agent offers none. */
function findAllowOption(
  options: acp.RequestPermissionRequest["options"],
): { optionId: string } | null {
  const match = (options ?? []).find((option) => {
    const kind = String(option.kind).toLowerCase();
    return kind.includes("allow") || /^allow\b/i.test(option.name);
  });
  return match ? { optionId: String(match.optionId) } : null;
}

const COMPUTER_USE_TOOL_NAMES = new Set([
  "list_apps",
  "get_app_state",
  "click",
  "perform_secondary_action",
  "scroll",
  "drag",
  "type_text",
  "press_key",
  "set_value",
]);

/** Match an MCP envelope without confusing generic click/scroll tool names. */
function isComputerUseToolCall(...values: unknown[]): boolean {
  const strings: string[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 4 || value == null) return;
    if (typeof value === "string") {
      strings.push(value.toLowerCase());
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (typeof value === "object") {
      for (const [key, item] of Object.entries(
        value as Record<string, unknown>,
      )) {
        if (
          /^(?:tool_?name|server_?name|name|title|kind|variant)$/i.test(key)
        ) {
          visit(item, depth + 1);
        }
      }
    }
  };
  for (const value of values) visit(value, 0);

  // ACP implementations sometimes expose only the tool title, without the
  // MCP server name. These names are distinctive to Open Computer Use.
  if (
    strings.some((value) =>
      ["list_apps", "get_app_state", "perform_secondary_action"].some(
        (toolName) => value.includes(toolName),
      ),
    )
  ) {
    return true;
  }

  const hasServer = strings.some((value) =>
    /(?:open[ _-]?)?computer[ _-]?use/.test(value),
  );
  if (!hasServer) return false;
  return strings.some((value) =>
    [...COMPUTER_USE_TOOL_NAMES].some((toolName) => value.includes(toolName)),
  );
}

type ListResponse = {
  result?: {
    sessions?: Array<Record<string, unknown>>;
  };
  sessions?: Array<Record<string, unknown>>;
};

type SearchResponse = {
  result?: {
    results?: Array<Record<string, unknown>>;
    bootstrapping?: boolean;
    nextOffset?: number | null;
    totalEstimate?: number | null;
  };
  results?: Array<Record<string, unknown>>;
  bootstrapping?: boolean;
  nextOffset?: number | null;
  totalEstimate?: number | null;
};

/** One in-flight `session/load`, including the replay fold it collects. */
type HistoryLoad = {
  /** `connectGen` when the load started — a reconnect invalidates it. */
  gen: number;
  accumulator: HistoryMessageAccumulator;
  startedAt: number;
  firstUpdateAt: number | null;
  lastUpdateAt: number | null;
  promise: Promise<ConnectionState>;
  previewCount: number;
};

/**
 * Owns the GUI's ACP **client** (`grok agent --leader stdio`).
 *
 * Work runs in the shared **leader** process (`~/.grok/leader.sock`), which
 * outlives Electron restarts (`--no-exit-on-disconnect`). Killing this class's
 * child only drops the thin stdio client — not in-flight turns on the leader.
 * Session history lives in `~/.grok/sessions` (same as the CLI).
 */
export class SessionManager {
  private win: BrowserWindow | null = null;
  /** Thin ACP client process — NOT the leader backend. */
  private child: ChildProcessWithoutNullStreams | null = null;
  private connection: acp.ClientConnection | null = null;
  private activeSessionId: string | null = null;
  private activeCwd = "";
  /** In-flight turns keyed by sessionId — multiple sessions may run at once. */
  private runningTurns = new Map<string, AbortController>();
  /**
   * Workspace root and start time per in-flight turn, captured at prompt time.
   * Recorded up front because a background turn may finish long after the user
   * switched workspaces, and `activeCwd` would then point somewhere else.
   */
  private turnScans = new Map<string, { root: string; startedAt: number }>();
  private state: ConnectionState = { status: "disconnected" };
  private pendingPermissions = new Map<string, PendingPermission>();
  private permissionSeq = 0;
  private grokPath = "";
  private version: string | null = null;
  private modelId: string | undefined;
  /** App-wide user preference. Defaults to medium until explicitly changed. */
  private preferredReasoningEffort = readReasoningEffortPreference();
  /** Preferred / session reasoning effort (e.g. high | medium | low). */
  private reasoningEffort: string | undefined = this.preferredReasoningEffort;
  private availableModels: ModelInfo[] = [];
  /** Local + agent permission mode (Codex-style approval chip). New chats default to Auto. */
  private permissionMode: PermissionMode = "auto";
  /**
   * MCP servers the GUI injects on session/new + session/load
   * (the built-in browser MCP is available for every GUI session).
   */
  private clientMcpServers: ClientMcpStdio[] = [];
  /**
   * In-flight session/load work, keyed by session id.
   * Multiple sessions may load in parallel when the user switches quickly;
   * each keeps its own accumulator so a superseding click does not wipe data.
   */
  private historyLoads = new Map<string, HistoryLoad>();
  private historyPreviewTimer: ReturnType<typeof setTimeout> | null = null;
  private historyPreviewSessionId: string | null = null;
  /** Preferred-model syncs that prompts must not overtake. */
  private modelSyncs = new Map<string, Promise<void>>();
  /** Serialize connect/disconnect so React StrictMode double-mount cannot race. */
  private connectChain: Promise<unknown> = Promise.resolve();
  private connectGen = 0;
  private sideTaskSessionIds = new Set(readPersistedSideTaskIds());
  /** ACP-published commands are session-scoped agent truth. */
  private availableCommandsBySession = new Map<string, SlashCommand[]>();
  /** Reconnects in the same app process must not delete still-open side tabs. */
  private startupSideTaskCleanupDone = false;
  /**
   * Worktree per session, keyed by agent session id. Seeded from
   * `worktree/list` on connect so the badge survives an app restart.
   */
  private worktrees = new Map<string, SessionWorktree>();
  /** Resolvers for in-flight `worktree/create` calls, keyed by session id. */
  private worktreeWaiters = new Map<
    string,
    { resolve: (path: string) => void; reject: (err: Error) => void }
  >();
  /**
   * Context-window occupancy per session, from `_meta.totalTokens` on session
   * updates. Kept for every session (not just the focused one) so switching
   * tabs shows the right gauge immediately.
   */
  private contextUsage = new Map<string, ContextUsage>();
  /** Sessions that used Open Computer Use since its last turn-ended signal. */
  private computerUseSessionIds = new Set<string>();
  /** Serialize global OCU cleanup so concurrent session turns cannot race it. */
  private computerUseCleanup: Promise<void> = Promise.resolve();

  private markComputerUse(sessionId: string | null | undefined) {
    if (sessionId) this.computerUseSessionIds.add(sessionId);
  }

  private endComputerUseTurn(
    sessionId: string | null | undefined,
    reason: string,
    force = false,
  ): Promise<void> {
    const run = async () => {
      if (sessionId && !this.computerUseSessionIds.has(sessionId) && !force) {
        return;
      }
      if (this.computerUseSessionIds.size === 0) return;

      // Open Computer Use 0.2.x exposes one process-wide turn-ended signal.
      // Do not send it while another associated GUI session is still acting.
      if (
        !force &&
        [...this.computerUseSessionIds].some(
          (id) => id !== sessionId && this.isTurnRunning(id),
        )
      ) {
        return;
      }

      const affectedSessionIds = [...this.computerUseSessionIds];
      await computerUseManager.endTurn({
        reason,
        session_id: sessionId ?? undefined,
        affected_session_ids: affectedSessionIds,
      });
      for (const id of affectedSessionIds) {
        this.computerUseSessionIds.delete(id);
      }
    };
    const result = this.computerUseCleanup.then(run, run);
    this.computerUseCleanup = result.catch(() => undefined);
    return result;
  }

  private rememberSideTaskSession(sessionId: string) {
    if (!sessionId) return;
    this.sideTaskSessionIds.add(sessionId);
    writePersistedSideTaskIds(this.sideTaskSessionIds);
  }

  private forgetSideTaskSession(sessionId: string) {
    if (!this.sideTaskSessionIds.delete(sessionId)) return;
    writePersistedSideTaskIds(this.sideTaskSessionIds);
  }

  private isSideTaskSession(sessionId: string): boolean {
    return this.sideTaskSessionIds.has(sessionId);
  }

  private modelState(): ModelState {
    return {
      currentModelId: this.modelId ?? null,
      currentReasoningEffort: this.reasoningEffort ?? null,
      availableModels: this.availableModels,
    };
  }

  private applyModelState(raw: unknown) {
    const parsed = parseModelState(raw);
    if (!parsed) return;
    if (parsed.currentModelId) this.modelId = parsed.currentModelId;
    if (parsed.availableModels.length > 0) {
      this.availableModels = parsed.availableModels;
    }
    // Model metadata reports the agent/session default, not necessarily the
    // user's last explicit choice. Keep the app-wide preference authoritative.
    if (parsed.currentModelId) {
      const cur = this.availableModels.find(
        (m) => m.modelId === parsed.currentModelId,
      );
      this.reasoningEffort = preferredEffortForModel(
        cur,
        this.preferredReasoningEffort,
      );
    }
  }

  private emitModels() {
    this.send("agent:models", this.modelState());
  }

  private emitContextUsage(sessionId: string) {
    const usage = this.contextUsage.get(sessionId);
    if (usage) this.send("agent:context-usage", usage);
  }

  /**
   * Record the running context stamp carried by a `session/update`.
   * Chunks repeat the same number many times per second, so only a real change
   * reaches the renderer. Replayed history is stored silently — `loadSession`
   * emits once when the transcript settles.
   */
  private noteContextTokens(
    sessionId: string,
    tokens: number,
    opts: { replay?: boolean } = {},
  ) {
    const prev = this.contextUsage.get(sessionId);
    if (prev?.usedTokens === tokens && prev.modelId === (this.modelId ?? null)) {
      return;
    }
    this.contextUsage.set(sessionId, {
      sessionId,
      usedTokens: tokens,
      modelId: this.modelId ?? null,
      lastTurn: prev?.lastTurn ?? null,
      session: prev?.session ?? null,
    });
    if (!opts.replay) this.emitContextUsage(sessionId);
  }

  /**
   * Fold the prompt response `_meta` into the gauge. Its top-level counters
   * describe the turn's LAST model call (so `totalTokens` is the context after
   * the turn), while the nested `usage` block sums every call in the turn.
   */
  private noteTurnUsage(sessionId: string, meta: unknown) {
    if (!meta || typeof meta !== "object") return;
    const m = meta as Record<string, unknown>;
    const used = tokenCount(m.totalTokens);
    const input = tokenCount(m.inputTokens);
    const output = tokenCount(m.outputTokens);
    // A turn that ran no model call (e.g. a client-side slash) reports 0 — keep
    // whatever the stream already established rather than blanking the gauge.
    if (used == null && input == null) return;
    const prev = this.contextUsage.get(sessionId);
    const rollup =
      m.usage && typeof m.usage === "object"
        ? (m.usage as Record<string, unknown>)
        : null;
    this.contextUsage.set(sessionId, {
      sessionId,
      usedTokens: used ?? (input ?? 0) + (output ?? 0),
      modelId:
        typeof m.modelId === "string" && m.modelId.trim()
          ? m.modelId.trim()
          : (this.modelId ?? null),
      lastTurn: {
        inputTokens: input ?? 0,
        outputTokens: output ?? 0,
        cachedReadTokens: tokenCount(m.cachedReadTokens) ?? 0,
        reasoningTokens: tokenCount(m.reasoningTokens) ?? 0,
      },
      session: rollup
        ? {
            totalTokens: tokenCount(rollup.totalTokens) ?? 0,
            modelCalls: tokenCount(rollup.modelCalls) ?? 0,
            numTurns: tokenCount(rollup.numTurns) ?? 0,
          }
        : (prev?.session ?? null),
    });
    this.emitContextUsage(sessionId);
  }

  /** Snapshot for a session (renderer pulls this when it has no event yet). */
  getContextUsage(sessionId?: string | null): ContextUsage | null {
    const id = sessionId ?? this.activeSessionId;
    if (!id) return null;
    return this.contextUsage.get(id) ?? null;
  }

  setWindow(win: BrowserWindow | null) {
    this.win = win;
  }

  /** Replace client-injected MCP list (applied on next session/new or session/load). */
  setClientMcpServers(servers: ClientMcpStdio[]) {
    this.clientMcpServers = Array.isArray(servers) ? servers : [];
  }

  getClientMcpServers(): ClientMcpStdio[] {
    return this.clientMcpServers;
  }

  getActiveSessionId(): string | null {
    return this.activeSessionId;
  }

  getActiveCwd(): string {
    return this.activeCwd;
  }

  getState(): ConnectionState {
    return this.state;
  }

  private acpMcpServers(): ClientMcpStdio[] {
    return this.clientMcpServers;
  }

  /**
   * Snapshot for renderer rehydrate after HMR or full window reload.
   * When still connected, re-lists agent sessions and returns live turn ids
   * so spinners match process truth (running stays running; finished clears).
   */
  async getBootstrap(): Promise<BootstrapSnapshot> {
    const runningSessionIds = this.getRunningSessionIds();
    let sessions: AgentSessionSummary[] = [];
    if (this.connection && this.state.status === "ready") {
      try {
        sessions = await this.listSessions(null);
      } catch {
        // Keep empty list — renderer can still show running ids if any.
      }
    }
    return {
      state: this.state,
      sessions,
      runningSessionIds,
      activeSessionId: this.activeSessionId,
      activeCwd: this.activeCwd,
    };
  }

  /**
   * Push connection + session list + running ids to the renderer.
   * Called after the window finishes loading so HMR / reload does not miss
   * the initial agent:state / agent:sessions events from an earlier connect.
   */
  async reemitSnapshot(): Promise<void> {
    this.send("agent:state", this.state);
    if (this.state.status === "ready") {
      this.emitModels();
      try {
        const sessions = await this.listSessions(null);
        this.emitSessions(sessions);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        this.emitSessions([], this.activeCwd || process.cwd(), message);
      }
      // Re-assert live turns so a missed agent:turn during listener gap
      // cannot leave the UI stuck or blank on spinners.
      for (const sessionId of this.getRunningSessionIds()) {
        this.send("agent:turn", { status: "started", sessionId });
      }
    }
  }

  private setState(state: ConnectionState) {
    this.state = state;
    this.send("agent:state", state);
  }

  private readyState(
    partial: Partial<{
      sessionId: string | null;
      cwd: string;
      modelId?: string;
      loadingHistory?: boolean;
    }> = {},
  ): ConnectionState {
    return {
      status: "ready",
      grokPath: this.grokPath,
      version: this.version,
      sessionId:
        partial.sessionId !== undefined ? partial.sessionId : this.activeSessionId,
      cwd: partial.cwd ?? this.activeCwd,
      modelId: partial.modelId ?? this.modelId,
      // Default reflects live replay state so snapshots re-pushed after an HMR
      // reload (`reemitSnapshot`) do not report a loading session as idle.
      loadingHistory: partial.loadingHistory ?? this.isFocusedHistoryLoading(),
      models: this.modelState(),
      permissionMode: this.permissionMode,
    };
  }

  private send(channel: string, payload: unknown) {
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send(channel, payload);
    }
  }

  async connect(cwd: string): Promise<ConnectResult> {
    const run = async (): Promise<ConnectResult> => {
      const gen = ++this.connectGen;
      await this.disconnectInternal();
      if (gen !== this.connectGen) {
        return this.state as ConnectResult;
      }

      this.setState({ status: "connecting" });
      this.activeCwd = cwd;
      this.activeSessionId = null;

      const probe = findGrok();
      if (!probe) {
        const err: ConnectResult = {
          status: "error",
          message:
            "The bundled Grok Build artifact is missing or invalid. Run `npm run artifact:grok-build`, then reconnect.",
          sessions: [],
        };
        this.setState(err);
        return err;
      }

      this.grokPath = probe.path;
      this.version = probe.version;

      // Managed models must be registered before the agent starts: it reads its
      // catalog once, and the relay's port and token are new on every launch.
      try {
        await syncManagedModelConfig();
      } catch (error) {
        this.send("agent:log", {
          level: "stderr",
          text: `Could not prepare managed models: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }

      try {
        const env = await buildSystemProxyEnvironment(process.env, {
          GROK_DISABLE_AUTOUPDATER: "1",
          // Endpoint API keys travel here, never through config.toml.
          ...managedModelEnvironment(),
        });
        const child = spawn(probe.path, [...GROK_AGENT_STDIO_ARGS], {
          stdio: ["pipe", "pipe", "pipe"],
          env,
        });
        this.child = child;

        child.stderr.on("data", (buf: Buffer) => {
          const text = buf.toString("utf8").trim();
          if (text) this.send("agent:log", { level: "stderr", text });
        });

        child.on("exit", (code, signal) => {
          if (this.state.status === "ready" || this.state.status === "connecting") {
            this.setState({
              status: "error",
              message: `grok agent exited (code=${code ?? "?"}, signal=${signal ?? "none"})`,
            });
          }
          this.cleanupProcessOnly();
        });

        const input = Writable.toWeb(child.stdin);
        const output = Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>;
        const stream = acp.ndJsonStream(input, output);

        const self = this;
        const connection = await acp
          .client({ name: "grok-gui" })
          .onRequest(acp.methods.client.session.requestPermission, async (ctx) => {
            return self.handlePermission(ctx.params);
          })
          .onRequest(acp.methods.client.fs.readTextFile, async () => {
            return { content: "" };
          })
          .onRequest(acp.methods.client.fs.writeTextFile, async () => {
            return {};
          })
          .onNotification(acp.methods.client.session.update, (ctx) => {
            self.handleSessionUpdate(ctx.params);
          })
          .onNotification(
            XAI_WORKTREE_STATUS,
            (params) => params as WorktreeStatusEvent,
            (ctx) => {
              self.handleWorktreeStatus(ctx.params);
            },
          )
          .connect(stream);

        if (gen !== this.connectGen) {
          try {
            connection.close();
          } catch {
            // ignore
          }
          child.kill();
          return this.state as ConnectResult;
        }

        this.connection = connection;

        const initResult = await connection.agent.request(
          acp.methods.agent.initialize,
          {
            protocolVersion: acp.PROTOCOL_VERSION,
            clientCapabilities: {
              fs: { readTextFile: false, writeTextFile: false },
              terminal: false,
            },
            clientInfo: { name: "grok-gui", version: "0.1.0" },
          },
        );

        if (gen !== this.connectGen) {
          return this.state as ConnectResult;
        }

        const meta = initResult as {
          _meta?: { modelState?: unknown };
        };
        this.applyModelState(meta._meta?.modelState);
        this.emitModels();

        this.setState(this.readyState({ sessionId: null, cwd }));
        this.send("agent:log", {
          level: "info",
          text: `Connected protocol v${initResult.protocolVersion}; agent session store ready`,
        });

        // Remove temporary sessions left by a crash/forced quit before any
        // session list is exposed to the renderer.
        if (!this.startupSideTaskCleanupDone) {
          await this.cleanupSideTaskSessions();
          this.startupSideTaskCleanupDone = true;
        }

        // Seed the session→worktree map first so the very first sidebar paint
        // already knows which chats are isolated (survives an app restart).
        try {
          await this.listWorktrees();
        } catch {
          // Worktrees are optional context — never block the session list.
        }

        // Recent sessions across workspaces (same store as `grok sessions list`).
        let sessions: AgentSessionSummary[] = [];
        try {
          sessions = await this.listSessions(null);
          // Retry once — agent storage can lag right after cold start.
          if (sessions.length === 0) {
            await new Promise((r) => setTimeout(r, 250));
            sessions = await this.listSessions(null);
          }
          this.send("agent:log", {
            level: "info",
            text: `Listed ${sessions.length} agent session(s)`,
          });
          this.emitSessions(sessions, cwd);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          this.send("agent:log", {
            level: "warn",
            text: `session list failed: ${message}`,
          });
          this.emitSessions([], cwd, message);
        }

        const state = this.state;
        const runningSessionIds = this.getRunningSessionIds();
        return state.status === "ready"
          ? { ...state, sessions, runningSessionIds }
          : { ...state, sessions: [], runningSessionIds };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await this.disconnectInternal();
        const err: ConnectResult = {
          status: "error",
          message,
          sessions: [],
          runningSessionIds: [],
        };
        this.setState(err);
        return err;
      }
    };

    const result = this.connectChain.then(run, run);
    this.connectChain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private handleSessionUpdate(params: unknown) {
    const n = params as {
      sessionId?: string;
      update?: {
        sessionUpdate?: string;
        availableCommands?: unknown;
        rawInput?: unknown;
      };
      _meta?: { isReplay?: boolean; totalTokens?: unknown };
    };
    // Runs before the replay/history early-returns below: a resumed session
    // must recover its gauge from the replayed stamps too.
    if (n.sessionId) {
      const stamped = tokenCount(n._meta?.totalTokens);
      if (stamped != null) {
        this.noteContextTokens(n.sessionId, stamped, {
          // `historyLoads` covers agents that replay without an `isReplay` flag.
          replay:
            n._meta?.isReplay === true || this.historyLoads.has(n.sessionId),
        });
      }
    }
    if (
      n.sessionId &&
      n.update?.sessionUpdate === "available_commands_update"
    ) {
      this.availableCommandsBySession.set(
        n.sessionId,
        normalizeAgentSlashCommands(n.update.availableCommands),
      );
    }
    if (
      n._meta?.isReplay !== true &&
      isComputerUseToolCall(
        n.update?.rawInput,
        n.update,
      )
    ) {
      this.markComputerUse(n.sessionId);
    }

    // Buffer replay updates into the matching in-flight load. Orphaned replays
    // (from a superseded / background load) must not hit the live path.
    if (n._meta?.isReplay === true && n.sessionId) {
      const load = this.historyLoads.get(n.sessionId);
      if (!load) return;
      const now = performance.now();
      if (load.firstUpdateAt == null) load.firstUpdateAt = now;
      load.lastUpdateAt = now;
      load.accumulator.push(params);
      // Only stream previews for the focused session to avoid UI thrash.
      if (this.activeSessionId === n.sessionId) {
        this.scheduleHistoryPreview(n.sessionId);
      }
      return;
    }

    // Legacy path: some agents omit isReplay during load — still buffer if
    // this session has an open load accumulator.
    if (n.sessionId && this.historyLoads.has(n.sessionId)) {
      const load = this.historyLoads.get(n.sessionId)!;
      const now = performance.now();
      if (load.firstUpdateAt == null) load.firstUpdateAt = now;
      load.lastUpdateAt = now;
      load.accumulator.push(params);
      if (this.activeSessionId === n.sessionId) {
        this.scheduleHistoryPreview(n.sessionId);
      }
      return;
    }

    this.send("agent:session-update", params);
  }

  getAvailableSlashCommands(sessionId?: string | null): SlashCommand[] {
    const id = sessionId ?? this.activeSessionId;
    return id ? [...(this.availableCommandsBySession.get(id) ?? [])] : [];
  }

  /**
   * Show a bounded number of partial history snapshots while ACP replays.
   * Stable draft ids let React update the same messages instead of remounting
   * them. The cap avoids repeatedly parsing a large transcript.
   */
  private scheduleHistoryPreview(sessionId: string) {
    const load = this.historyLoads.get(sessionId);
    if (!load || load.previewCount >= HISTORY_PREVIEW_LIMIT) return;
    // Coalesce previews onto one timer (latest focused load wins).
    if (this.historyPreviewTimer && this.historyPreviewSessionId === sessionId) {
      return;
    }
    if (this.historyPreviewTimer) {
      clearTimeout(this.historyPreviewTimer);
      this.historyPreviewTimer = null;
    }
    this.historyPreviewSessionId = sessionId;
    this.historyPreviewTimer = setTimeout(() => {
      this.historyPreviewTimer = null;
      this.historyPreviewSessionId = null;
      const current = this.historyLoads.get(sessionId);
      if (
        !current ||
        this.activeSessionId !== sessionId ||
        current.previewCount >= HISTORY_PREVIEW_LIMIT
      ) {
        return;
      }
      const messages = current.accumulator.finish();
      if (messages.length === 0) return;
      current.previewCount += 1;
      this.send("agent:history-progress", {
        sessionId,
        cwd: this.activeCwd,
        messages,
        updateCount: current.accumulator.updateCount,
      });
    }, HISTORY_PREVIEW_INTERVAL_MS);
  }

  private clearHistoryPreview() {
    if (this.historyPreviewTimer) {
      clearTimeout(this.historyPreviewTimer);
      this.historyPreviewTimer = null;
    }
    this.historyPreviewSessionId = null;
  }

  /** Whether the focused session currently has history loading. */
  private isFocusedHistoryLoading(): boolean {
    return (
      !!this.activeSessionId && this.historyLoads.has(this.activeSessionId)
    );
  }

  private isTurnRunning(sessionId: string | null | undefined): boolean {
    return !!sessionId && this.runningTurns.has(sessionId);
  }

  /** Session ids with an in-flight prompt in this process (source of truth for UI spinners). */
  getRunningSessionIds(): string[] {
    return [...this.runningTurns.keys()];
  }

  /** Broadcast session list + live running ids so the sidebar spinner stays accurate. */
  private emitSessions(
    sessions: AgentSessionSummary[],
    cwd?: string,
    error?: string,
  ) {
    this.send("agent:sessions", {
      sessions,
      cwd: cwd ?? (this.activeCwd || process.cwd()),
      runningSessionIds: this.getRunningSessionIds(),
      ...(error ? { error } : {}),
    });
  }

  /**
   * Cancel an in-flight turn for one session (does not stop other sessions).
   * Removes the turn from `runningTurns` immediately so spinners clear even
   * when the agent is slow to acknowledge cancel.
   */
  private cancelSessionTurn(sessionId: string): boolean {
    const abort = this.runningTurns.get(sessionId);
    if (!abort) return false;
    abort.abort();
    // Drop before agent ack — UI truth is "not running" as soon as user stops.
    this.runningTurns.delete(sessionId);
    void this.connection?.agent
      .notify(acp.methods.agent.session.cancel, { sessionId })
      .catch(() => undefined);
    return true;
  }

  /**
   * Point the focused session at `sessionId` without reloading history.
   * Required when the renderer switches to a cached transcript — otherwise
   * prompt/cancel still target the previous main-process session.
   */
  focusSession(
    sessionId: string,
    cwd?: string,
  ): { ok: boolean; error?: string } {
    if (!sessionId) {
      return { ok: false, error: "Missing session id" };
    }
    if (!this.connection || this.state.status !== "ready") {
      return { ok: false, error: "Not connected" };
    }
    this.activeSessionId = sessionId;
    if (typeof cwd === "string" && cwd.length > 0) {
      this.activeCwd = cwd;
    }
    this.setState(
      this.readyState({
        sessionId,
        cwd: this.activeCwd,
        loadingHistory: false,
      }),
    );
    return { ok: true };
  }

  private handlePermission(
    params: acp.RequestPermissionRequest,
  ): Promise<acp.RequestPermissionResponse> {
    if (
      isComputerUseToolCall(
        params.toolCall?.rawInput,
        params.toolCall?.title,
        params.toolCall?.kind,
      )
    ) {
      this.markComputerUse(params.sessionId ? String(params.sessionId) : null);
    }
    // Full access is enforced client-side too: the agent is told via
    // `x.ai/yolo_mode_changed`, but that notify is fire-and-forget and sessions
    // created before the switch never saw `_meta.yoloMode`. Without this the
    // modal still opens in "Full access", which is what users report.
    // Mirrors the early return in requestLocalToolPermission().
    if (this.permissionMode === "always-approve") {
      const allow = findAllowOption(params.options);
      if (allow) {
        return Promise.resolve({
          outcome: { outcome: "selected", optionId: allow.optionId },
        });
      }
    }
    if (
      this.permissionMode === "auto" &&
      isBuiltinBrowserMcpPermission(params)
    ) {
      const allow = findAllowOption(params.options);
      if (allow) {
        return Promise.resolve({
          outcome: { outcome: "selected", optionId: allow.optionId },
        });
      }
    }
    const requestId = `perm-${++this.permissionSeq}`;
    const payload: PermissionRequestPayload = {
      requestId,
      sessionId: params.sessionId ? String(params.sessionId) : undefined,
      toolCall: {
        toolCallId: params.toolCall?.toolCallId ?? undefined,
        title: params.toolCall?.title ?? undefined,
        kind: params.toolCall?.kind ?? undefined,
        rawInput: params.toolCall?.rawInput,
      },
      options: (params.options ?? []).map((o) => ({
        optionId: String(o.optionId),
        name: o.name,
        kind: String(o.kind),
      })),
    };

    return new Promise((resolve) => {
      this.pendingPermissions.set(requestId, { resolve });
      this.send("agent:permission", payload);

      setTimeout(
        () => {
          if (!this.pendingPermissions.has(requestId)) return;
          this.pendingPermissions.delete(requestId);
          resolve({ outcome: { outcome: "cancelled" } });
          this.send("agent:permission-timeout", { requestId });
        },
        5 * 60 * 1000,
      );
    });
  }

  respondPermission(
    requestId: string,
    optionId: string | null,
  ): { ok: boolean } {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) return { ok: false };
    this.pendingPermissions.delete(requestId);
    if (optionId == null) {
      pending.resolve({ outcome: { outcome: "cancelled" } });
    } else {
      pending.resolve({
        outcome: { outcome: "selected", optionId },
      });
    }
    return { ok: true };
  }

  /** Route a GUI-owned tool's sensitive action through the existing modal. */
  async requestLocalToolPermission(input: {
    title: string;
    kind: string;
    rawInput: unknown;
  }): Promise<boolean> {
    if (this.permissionMode === "always-approve") return true;
    const response = await this.handlePermission({
      sessionId: this.activeSessionId ?? undefined,
      toolCall: {
        toolCallId: `gui-browser-${Date.now()}`,
        title: input.title,
        kind: input.kind,
        rawInput: input.rawInput,
      },
      options: [
        { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
        { optionId: "deny_once", name: "Deny", kind: "reject_once" },
      ],
    } as unknown as acp.RequestPermissionRequest);
    const outcome = response.outcome;
    return outcome.outcome === "selected" && outcome.optionId === "allow_once";
  }

  /**
   * List sessions from the agent (local `~/.grok/sessions` + remote merge).
   * Same source as `grok sessions list`.
   *
   * Pass `cwd: null` (or omit) for recent sessions across all workspaces.
   * Pass a path string to filter to one workspace bucket.
   */
  async listSessions(
    cwd?: string | null,
    limit = 80,
  ): Promise<AgentSessionSummary[]> {
    if (!this.connection || this.state.status !== "ready") {
      throw new Error("Not connected");
    }
    const params: { limit: number; cwd?: string } = { limit };
    if (typeof cwd === "string" && cwd.length > 0) {
      params.cwd = cwd;
    }

    const raw = (await this.connection.agent.request(
      XAI_SESSION_LIST,
      params,
    )) as ListResponse;

    // Wire shape: ExtMethodResult wraps as `{ result: { sessions: [...] } }`
    // or may already be unwrapped depending on SDK mapping.
    const sessions =
      raw?.result?.sessions ??
      raw?.sessions ??
      (Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : []);

    return sessions
      .map((s) => normalizeSessionRow(s))
      .filter((s) => s.sessionId.length > 0)
      .map((s) => ({
        ...s,
        isSideTask: this.isSideTaskSession(s.sessionId),
        worktree: this.worktrees.get(s.sessionId),
      }));
  }

  /**
   * Every worktree the agent tracks (same store as `grok worktree list`).
   * Also refreshes the session→worktree map the sidebar badge reads.
   */
  async listWorktrees(): Promise<WorktreeRecord[]> {
    if (!this.connection || this.state.status !== "ready") {
      throw new Error("Not connected");
    }
    const raw = await this.connection.agent.request(XAI_WORKTREE_LIST, {
      includeAll: true,
    });
    const rows = unwrapExt<Array<Record<string, unknown>>>(raw);
    if (!Array.isArray(rows)) return [];
    const records = rows
      .map((row) => normalizeWorktreeRow(row))
      .filter((row): row is WorktreeRecord => row !== null);

    this.worktrees.clear();
    for (const record of records) {
      if (!record.sessionId) continue;
      this.worktrees.set(record.sessionId, {
        id: record.id,
        path: record.path,
        label: record.label,
        sourcePath: record.sourcePath,
      });
    }
    return records;
  }

  /** Worktree the given session runs in, if any (no agent round-trip). */
  getWorktree(sessionId: string): SessionWorktree | undefined {
    return this.worktrees.get(sessionId);
  }

  /**
   * Delete a worktree directory + its registry row.
   * The session itself is untouched — callers delete that separately.
   */
  async removeWorktree(pathOrId: string): Promise<boolean> {
    if (!this.connection || this.state.status !== "ready") {
      throw new Error("Not connected");
    }
    const params = pathOrId.startsWith("/")
      ? { worktreePath: pathOrId }
      : { idOrPath: pathOrId };
    const raw = await this.connection.agent.request(
      XAI_WORKTREE_REMOVE,
      params,
    );
    const result = unwrapExt<{ removed?: boolean }>(raw);
    if (result?.removed) {
      for (const [sessionId, wt] of this.worktrees) {
        if (wt.path === pathOrId || wt.id === pathOrId) {
          this.worktrees.delete(sessionId);
        }
      }
    }
    return result?.removed === true;
  }

  /**
   * Materialize a worktree for a not-yet-created session and wait for it.
   *
   * `create` returns as soon as the job is queued; the tree is only usable
   * after the matching `worktree/status` notification, so this resolves on
   * that instead of on the RPC result.
   */
  private async createWorktree(
    sessionId: string,
    sourcePath: string,
    options: WorktreeCreateOptions,
  ): Promise<SessionWorktree> {
    if (!this.connection || this.state.status !== "ready") {
      throw new Error("Not connected");
    }
    const params: {
      sessionId: string;
      sourcePath: string;
      label?: string;
      gitRef?: string;
    } = { sessionId, sourcePath };
    const label = options.label?.trim();
    const gitRef = options.gitRef?.trim();
    if (label) params.label = label;
    if (gitRef) params.gitRef = gitRef;

    const settled = new Promise<string>((resolve, reject) => {
      this.worktreeWaiters.set(sessionId, { resolve, reject });
    });
    let timer: ReturnType<typeof setTimeout> | null = null;
    const guarded = Promise.race([
      settled,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Timed out creating the worktree")),
          WORKTREE_CREATE_TIMEOUT_MS,
        );
      }),
    ]).finally(() => {
      if (timer) clearTimeout(timer);
      this.worktreeWaiters.delete(sessionId);
    });

    let created: { worktreePath?: string } | null = null;
    try {
      const raw = await this.connection.agent.request(
        XAI_WORKTREE_CREATE,
        params,
      );
      created = unwrapExt<{ worktreePath?: string }>(raw);
    } catch (err) {
      this.worktreeWaiters.delete(sessionId);
      if (timer) clearTimeout(timer);
      // Swallow the unobserved rejection from the race we are abandoning.
      guarded.catch(() => undefined);
      throw err;
    }

    const path = await guarded;
    const worktreePath = path || created?.worktreePath || "";
    if (!worktreePath) throw new Error("Worktree creation returned no path");

    const worktree: SessionWorktree = {
      id: "",
      path: worktreePath,
      label: worktreePath.split("/").filter(Boolean).at(-1) ?? "",
      sourcePath: trimTrailingSlash(sourcePath),
    };
    this.worktrees.set(sessionId, worktree);
    return worktree;
  }

  /** Route a `worktree/status` notification to its waiter and the renderer. */
  private handleWorktreeStatus(event: WorktreeStatusEvent) {
    this.send("agent:worktree-status", event);
    const sessionId = event.sessionId;
    if (!sessionId) return;
    const waiter = this.worktreeWaiters.get(sessionId);
    if (!waiter) return;
    if (event.status === "created") {
      waiter.resolve(event.worktreePath ?? "");
      return;
    }
    // Anything that is neither progress nor success ends the wait.
    if (event.status !== "progress") {
      waiter.reject(
        new Error(event.error || event.message || `Worktree ${event.status}`),
      );
    }
  }

  /**
   * Full-text search across session titles + message bodies (agent FTS5).
   * Same source as TUI session picker deep search (`x.ai/session/search`).
   */
  async searchSessions(opts: {
    query: string;
    cwd?: string | null;
    limit?: number;
    offset?: number;
    includeContent?: boolean;
  }): Promise<AgentSessionSearchResult> {
    if (!this.connection || this.state.status !== "ready") {
      throw new Error("Not connected");
    }
    const query = opts.query.trim();
    if (!query) {
      return { results: [], bootstrapping: false };
    }
    const params: {
      query: string;
      limit: number;
      offset: number;
      includeContent: boolean;
      cwd?: string;
    } = {
      query,
      limit: opts.limit ?? 40,
      offset: opts.offset ?? 0,
      includeContent: opts.includeContent !== false,
    };
    if (typeof opts.cwd === "string" && opts.cwd.length > 0) {
      params.cwd = opts.cwd;
    }

    let lastError: unknown;
    for (const method of XAI_SESSION_SEARCH_METHODS) {
      try {
        const raw = (await this.connection.agent.request(
          method,
          params,
        )) as SearchResponse;
        const payload = raw?.result ?? raw;
        const rows = payload?.results ?? [];
        const results = (Array.isArray(rows) ? rows : [])
          .map((r) => normalizeSearchHit(r))
          .filter(
            (h) =>
              h.sessionId.length > 0 && !this.isSideTaskSession(h.sessionId),
          );
        return {
          results,
          bootstrapping: Boolean(payload?.bootstrapping),
          nextOffset:
            typeof payload?.nextOffset === "number"
              ? payload.nextOffset
              : undefined,
          totalEstimate:
            typeof payload?.totalEstimate === "number"
              ? payload.totalEstimate
              : undefined,
        };
      } catch (e) {
        lastError = e;
        const msg = e instanceof Error ? e.message : String(e);
        if (!/method.?not.?found|unknown ACP extension/i.test(msg)) {
          throw e;
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(String(lastError ?? "session search failed"));
  }

  /**
   * Rename a session title via the agent extension `x.ai/session/rename`
   * (same path as the TUI). Title must be non-blank after trim.
   */
  async renameSession(
    sessionId: string,
    title: string,
    cwd?: string,
  ): Promise<{ ok: boolean; title?: string; error?: string }> {
    if (!sessionId) {
      return { ok: false, error: "Missing session id" };
    }
    const nextTitle = title.trim();
    if (!nextTitle) {
      return { ok: false, error: "Title must not be blank" };
    }
    if (!this.connection || this.state.status !== "ready") {
      return { ok: false, error: "Not connected" };
    }

    const params: { sessionId: string; title: string; cwd?: string } = {
      sessionId,
      title: nextTitle,
    };
    if (cwd) params.cwd = cwd;

    const errors: string[] = [];
    for (const method of XAI_SESSION_RENAME_METHODS) {
      try {
        await this.connection.agent.request(method, params);
        try {
          const sessions = await this.listSessions(null);
          this.emitSessions(sessions);
        } catch {
          // non-fatal — UI can still update the title optimistically
        }
        return { ok: true, title: nextTitle };
      } catch (e) {
        errors.push(`${method}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return {
      ok: false,
      error: errors.join("; ") || "Could not rename session",
    };
  }

  /**
   * Permanently delete a session.
   *
   * Prefer the agent extension `x.ai/session/delete` (same as the TUI): it
   * removes local disk + FTS and drops any in-memory live session. Standard
   * ACP `session/delete` is not implemented by current grok agents. CLI
   * `grok sessions delete` is the last resort.
   */
  async deleteSession(
    sessionId: string,
    opts: { emitSessions?: boolean } = {},
  ): Promise<{ ok: boolean; error?: string }> {
    if (!sessionId) {
      return { ok: false, error: "Missing session id" };
    }
    if (!this.connection || this.state.status !== "ready") {
      return { ok: false, error: "Not connected" };
    }

    // Notify before agent-side deletion closes the MCP stdio process; the
    // native helper needs the live process to release its turn state cleanly.
    await this.endComputerUseTurn(sessionId, "session-deleted");

    const agentErrors: string[] = [];

    // 1) TUI path — real delete + live-session teardown
    for (const method of XAI_SESSION_DELETE_METHODS) {
      try {
        await this.connection.agent.request(method, { sessionId });
        break;
      } catch (e) {
        agentErrors.push(
          `${method}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    // 2) Standard ACP (future agents); ignore failures from older builds
    try {
      await this.connection.agent.request(acp.methods.agent.session.delete, {
        sessionId,
      });
    } catch (e) {
      agentErrors.push(
        `session/delete: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    // Verify postcondition; fall back to CLI if the row is still listed or
    // the list cannot be queried (empty sessions have bitten older paths).
    const deletedByAgent = await this.waitForSessionDeletion(sessionId);
    if (deletedByAgent !== true) {
      let cliError: string | undefined;
      try {
        await this.deleteSessionViaCli(sessionId);
      } catch (cliErr) {
        cliError = cliErr instanceof Error ? cliErr.message : String(cliErr);
      }

      const deletedByCli = await this.waitForSessionDeletion(sessionId);
      if (deletedByCli !== true) {
        const details = [
          agentErrors.length ? `Agent: ${agentErrors.join(" | ")}` : undefined,
          cliError ? `CLI: ${cliError}` : undefined,
          deletedByCli === false
            ? "Session still exists after deletion"
            : undefined,
        ].filter((value): value is string => !!value);
        return {
          ok: false,
          error: details.join("; ") || "Could not verify session deletion",
        };
      }
    }

    // Stop only this session's turn; others keep running.
    const wasRunning = this.isTurnRunning(sessionId);
    this.cancelSessionTurn(sessionId);
    this.runningTurns.delete(sessionId);
    if (wasRunning) {
      this.send("agent:turn", {
        status: "stopped",
        sessionId,
        stopReason: "deleted",
      });
    }

    if (this.activeSessionId === sessionId) {
      this.activeSessionId = null;
      if (this.state.status === "ready") {
        this.setState(
          this.readyState({
            sessionId: null,
            cwd: this.activeCwd,
            loadingHistory: false,
          }),
        );
      }
    }

    this.forgetSideTaskSession(sessionId);
    this.contextUsage.delete(sessionId);

    if (opts.emitSessions !== false) {
      try {
        const sessions = await this.listSessions(null);
        this.emitSessions(sessions);
      } catch {
        // non-fatal — UI can still drop the row optimistically
      }
    }

    return { ok: true };
  }

  /**
   * Confirm deletion against the same agent session list used by the sidebar.
   * Returns null when the list cannot be queried, so the caller can fall back.
   */
  private async waitForSessionDeletion(
    sessionId: string,
  ): Promise<boolean | null> {
    const delays = [0, 75, 200];
    let queried = false;
    for (const delay of delays) {
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        const sessions = await this.listSessions(null, 1000);
        queried = true;
        if (!sessions.some((session) => session.sessionId === sessionId)) {
          return true;
        }
      } catch {
        // Retry briefly; a successful CLI delete can still be accepted if a
        // later query proves the row disappeared.
      }
    }
    return queried ? false : null;
  }

  private async deleteSessionViaCli(sessionId: string): Promise<void> {
    const bin = this.grokPath || "grok";
    const env = await buildSystemProxyEnvironment();
    return new Promise((resolve, reject) => {
      const child = spawn(bin, ["sessions", "delete", sessionId], {
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve();
        else
          reject(
            new Error(
              stderr.trim() || `grok sessions delete exited with ${code}`,
            ),
          );
      });
    });
  }

  /**
   * Create a fresh ACP session (persisted under ~/.grok/sessions like the CLI).
   *
   * With `worktree`, the chat runs in an isolated git worktree of `cwd`
   * instead of `cwd` itself (same isolation as CLI `grok -w`).
   */
  async newSession(
    cwd?: string,
    worktree?: WorktreeCreateOptions | null,
  ): Promise<ConnectionState> {
    return this.createSession(cwd, false, worktree);
  }

  /** Create a persisted ACP session tracked as temporary GUI state. */
  async newSideTaskSession(cwd?: string): Promise<ConnectionState> {
    return this.createSession(cwd, true);
  }

  private async createSession(
    cwd: string | undefined,
    sideTask: boolean,
    worktree?: WorktreeCreateOptions | null,
  ): Promise<ConnectionState> {
    if (!this.connection || this.state.status !== "ready") {
      const connected = await this.connect(cwd ?? process.cwd());
      // Reconnecting leaves no session selected, so an isolated chat still
      // needs its worktree — retry now that the agent is up.
      if (worktree && connected.status === "ready") {
        return this.createSession(cwd, sideTask, worktree);
      }
      return connected;
    }

    const sourceCwd = cwd ?? (this.activeCwd || process.cwd());
    // The worktree has to exist before session/new: `worktree/create` never
    // relocates an existing session, it only prepares a directory.
    let presetSessionId: string | null = null;
    let createdWorktree: SessionWorktree | null = null;
    if (worktree) {
      try {
        presetSessionId = randomUUID();
        createdWorktree = await this.createWorktree(
          presetSessionId,
          sourceCwd,
          worktree,
        );
      } catch (e) {
        this.worktrees.delete(presetSessionId ?? "");
        const message = e instanceof Error ? e.message : String(e);
        this.send("agent:log", {
          level: "error",
          text: `worktree create failed: ${message}`,
        });
        return { status: "error", message };
      }
    }

    const targetCwd = createdWorktree?.path ?? sourceCwd;
    try {
      // Do not cancel other sessions' in-flight turns when creating a new chat.
      const response = (await this.connection.agent.request(
        acp.methods.agent.session.new,
        {
          cwd: targetCwd,
          mcpServers: this.acpMcpServers(),
          // Agent reads `yoloMode` + `autoMode` booleans (not only permission_mode).
          // `sessionId` is honoured for new sessions, which is what lets the
          // worktree registry row point at the chat we are about to open.
          _meta: presetSessionId
            ? { ...permissionMeta(this.permissionMode), sessionId: presetSessionId }
            : permissionMeta(this.permissionMode),
        },
      )) as {
        sessionId: string;
        models?: unknown;
      };

      if (createdWorktree && response.sessionId !== presetSessionId) {
        // Agent ignored our id — re-key the worktree so the badge still maps.
        this.worktrees.delete(presetSessionId ?? "");
        this.worktrees.set(response.sessionId, createdWorktree);
      }

      this.activeSessionId = response.sessionId;
      this.activeCwd = targetCwd;
      if (sideTask) this.rememberSideTaskSession(response.sessionId);
      this.applyModelState(response.models);
      // session/new starts on the agent's catalog default, so re-apply the
      // chosen model. The transcript/session can paint immediately; prompt()
      // waits for the sync.
      const resync = modelResyncArgs(this.modelId, this.reasoningEffort);
      if (resync) {
        const sessionId = response.sessionId;
        const sync = this.setModel(
          resync.modelId,
          resync.reasoningEffort,
          false,
        ).then(() => undefined);
        this.modelSyncs.set(sessionId, sync);
        void sync.finally(() => {
          if (this.modelSyncs.get(sessionId) === sync) {
            this.modelSyncs.delete(sessionId);
          }
        });
      }
      this.emitModels();

      const ready = this.readyState({
        sessionId: response.sessionId,
        cwd: targetCwd,
        loadingHistory: false,
      });
      this.setState(ready);
      this.send("agent:session-loaded", {
        sessionId: response.sessionId,
        cwd: targetCwd,
        isNew: true,
        isSideTask: sideTask,
        worktree: this.worktrees.get(response.sessionId),
      });

      // Sidebar reconciliation must not compete with model sync / first prompt
      // on the agent stdio. Wait for the preferred-model round-trip (if any),
      // then refresh titles/order so the new row is not missing from the index.
      const sessionId = response.sessionId;
      void (async () => {
        try {
          await this.modelSyncs.get(sessionId);
          const sessions = await this.listSessions(null);
          this.emitSessions(sessions, targetCwd);
        } catch {
          // non-fatal — local optimistic row already paints the new chat
        }
      })();

      return ready;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const err: ConnectionState = { status: "error", message };
      this.setState(err);
      return err;
    }
  }

  /** Delete every registered side task; failed ids remain for next startup. */
  async cleanupSideTaskSessions(): Promise<void> {
    if (!this.connection || this.state.status !== "ready") return;
    for (const sessionId of [...this.sideTaskSessionIds]) {
      const result = await this.deleteSession(sessionId, {
        emitSessions: false,
      });
      if (!result.ok) {
        this.send("agent:log", {
          level: "warn",
          text: `side task cleanup failed for ${sessionId}: ${result.error ?? "unknown error"}`,
        });
      }
    }
  }

  /**
   * Load an existing agent session (CLI-compatible id) and replay history
   * via `session/update` notifications (`_meta.isReplay`).
   */
  async loadSession(
    sessionId: string,
    cwd: string,
  ): Promise<ConnectionState> {
    if (!this.connection || this.state.status !== "ready") {
      return {
        status: "error",
        message: "Not connected",
      };
    }

    // Re-clicking a session that is still replaying joins the same load
    // instead of starting a second one (which would drop the first fold).
    const inFlight = this.historyLoads.get(sessionId);
    if (inFlight) {
      this.activeSessionId = sessionId;
      this.activeCwd = cwd;
      return inFlight.promise;
    }

    // The entry must exist before the first await: `handleSessionUpdate`
    // routes replay notifications by looking this session up here.
    const load: HistoryLoad = {
      gen: this.connectGen,
      accumulator: new HistoryMessageAccumulator(),
      startedAt: performance.now(),
      firstUpdateAt: null,
      lastUpdateAt: null,
      previewCount: 0,
      // Assigned synchronously on the next line; never observed unset.
      promise: undefined as unknown as Promise<ConnectionState>,
    };
    this.historyLoads.set(sessionId, load);
    load.promise = this.runHistoryLoad(sessionId, cwd, load);
    return load.promise;
  }

  /** Body of one `session/load`; owns its `historyLoads` entry lifecycle. */
  private async runHistoryLoad(
    sessionId: string,
    cwd: string,
    load: HistoryLoad,
  ): Promise<ConnectionState> {
    try {
      // Switching focus must not stop other sessions that are still running.
      this.activeSessionId = sessionId;
      this.activeCwd = cwd;
      this.clearHistoryPreview();
      this.setState(
        this.readyState({
          sessionId,
          cwd,
          loadingHistory: true,
        }),
      );
      this.send("agent:history-start", { sessionId, cwd });

      const response = (await this.connection!.agent.request(
        acp.methods.agent.session.load,
        {
          sessionId,
          cwd,
          mcpServers: this.acpMcpServers(),
          // Re-seed yolo/auto for this session on reconnect (CLI-compatible).
          _meta: permissionMeta(this.permissionMode),
        },
      )) as {
        models?: unknown;
      };

      this.applyModelState(response.models);
      const accumulator = load.accumulator;
      this.historyLoads.delete(sessionId);
      this.clearHistoryPreview();

      // A reconnect during replay retires this load: the agent behind those
      // notifications is gone, so do not paint them over the new connection.
      // The renderer turned its spinner on at `history-start`, so it still
      // needs an end — `retired` says "settle, but keep nothing".
      if (load.gen !== this.connectGen) {
        this.send("agent:history-end", {
          sessionId,
          cwd,
          retired: true,
          messages: [],
        });
        return this.state;
      }

      // Loading a session may report its old/catalog default. Start restoring
      // the app preference now, but do not keep the transcript hidden while
      // that independent ACP round-trip completes. prompt() gates on this map.
      const resync = modelResyncArgs(this.modelId, this.reasoningEffort);
      if (resync) {
        const sync = this.setModel(
          resync.modelId,
          resync.reasoningEffort,
          false,
        ).then(() => undefined);
        this.modelSyncs.set(sessionId, sync);
        void sync.finally(() => {
          if (this.modelSyncs.get(sessionId) === sync) {
            this.modelSyncs.delete(sessionId);
          }
        });
      }
      this.emitModels();

      // Replay chunks were folded incrementally while session/load was in
      // flight. Only the final draft conversion remains on the critical path.
      const foldStarted = performance.now();
      const messages: ChatMessage[] = accumulator.finish();
      const foldMs = Math.round(performance.now() - foldStarted);
      const updateCount = accumulator.updateCount;
      const loadMs = Math.round(performance.now() - load.startedAt);
      const firstUpdateMs =
        load.firstUpdateAt == null
          ? null
          : Math.round(load.firstUpdateAt - load.startedAt);
      const lastUpdateMs =
        load.lastUpdateAt == null
          ? null
          : Math.round(load.lastUpdateAt - load.startedAt);

      const ready = this.readyState({
        sessionId,
        cwd,
        loadingHistory: false,
      });
      this.setState(ready);
      this.send("agent:history-end", {
        sessionId,
        cwd,
        messages,
        updateCount,
        messageCount: messages.length,
        foldMs,
        loadMs,
        firstUpdateMs,
        lastUpdateMs,
      });
      this.send("agent:session-loaded", { sessionId, cwd, isNew: false });
      // Replay stamps were recorded silently; publish the settled value once.
      this.emitContextUsage(sessionId);
      this.send("agent:log", {
        level: "info",
        text: `Loaded session ${sessionId.slice(0, 8)}… (${updateCount} updates → ${messages.length} messages, finalize ${foldMs}ms)`,
      });
      return ready;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.historyLoads.delete(sessionId);
      this.clearHistoryPreview();
      this.activeSessionId = null;
      const err: ConnectionState = { status: "error", message };
      this.setState(err);
      this.send("agent:history-end", {
        sessionId,
        cwd,
        error: message,
        messages: [],
      });
      return err;
    }
  }

  async prompt(
    text: string,
    images?: Array<{ data: string; mimeType: string }>,
    /** Explicit target — prefer over main-process focus (avoids cross-session leaks). */
    sessionId?: string,
    /** Non-image file attachments → ACP resource / resource_link blocks. */
    files?: Array<{
      name: string;
      mimeType: string;
      uri: string;
      text?: string;
      data?: string;
      size?: number;
    }>,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!this.connection || this.state.status !== "ready") {
      return { ok: false, error: "Not connected" };
    }

    const trimmed = text.trim();
    const imgs = images?.filter((i) => i.data && i.mimeType) ?? [];
    const fileParts = files?.filter((f) => f.name && f.uri) ?? [];
    if (!trimmed && imgs.length === 0 && fileParts.length === 0) {
      return { ok: false, error: "Empty prompt" };
    }

    // Prefer the renderer-supplied id so a UI focus switch cannot mis-route work.
    if (sessionId) {
      this.activeSessionId = sessionId;
    }

    // Lazy-create a session if the user sends a message with none selected.
    if (!this.activeSessionId) {
      const created = await this.newSession(this.activeCwd || process.cwd());
      if (created.status !== "ready" || !this.activeSessionId) {
        return {
          ok: false,
          error:
            created.status === "error"
              ? created.message
              : "Failed to create session",
        };
      }
    }

    const targetSessionId = this.activeSessionId;
    if (!targetSessionId) {
      return { ok: false, error: "No active session" };
    }
    // History can paint before the preferred-model round-trip finishes, but a
    // user prompt must still run with the selected model/effort.
    await this.modelSyncs.get(targetSessionId);
    if (this.isTurnRunning(targetSessionId)) {
      return { ok: false, error: "A turn is already running for this session" };
    }

    const abort = new AbortController();
    this.runningTurns.set(targetSessionId, abort);
    const scanRoot =
      this.worktrees.get(targetSessionId)?.path || this.activeCwd;
    if (scanRoot) {
      this.turnScans.set(targetSessionId, {
        root: scanRoot,
        startedAt: Date.now(),
      });
    }
    this.send("agent:turn", { status: "started", sessionId: targetSessionId });

    let result: { ok: boolean; error?: string } = { ok: true };
    try {
      if (!abort.signal.aborted) {
        // ACP content blocks: images + files, then text.
        const fileBlocks: Array<Record<string, unknown>> = fileParts.map(
          (f) => {
            if (f.text != null) {
              return {
                type: "resource",
                resource: {
                  uri: f.uri,
                  mimeType: f.mimeType || undefined,
                  text: f.text,
                },
              };
            }
            if (f.data) {
              return {
                type: "resource",
                resource: {
                  uri: f.uri,
                  mimeType: f.mimeType || undefined,
                  blob: f.data,
                },
              };
            }
            return {
              type: "resource_link",
              uri: f.uri,
              name: f.name,
              mimeType: f.mimeType || undefined,
              size: f.size,
            };
          },
        );

        const fallbackText =
          trimmed ||
          (imgs.length > 0 || fileParts.length > 0
            ? imgs.length > 0 && fileParts.length === 0
              ? "See attached image."
              : fileParts.length > 0 && imgs.length === 0
                ? `See attached file${fileParts.length > 1 ? "s" : ""}.`
                : "See attachments."
            : "");

        const promptBlocks: Array<Record<string, unknown>> = [
          ...imgs.map((img) => ({
            type: "image",
            data: img.data,
            mimeType: img.mimeType,
          })),
          ...fileBlocks,
          {
            type: "text",
            text: fallbackText,
          },
        ];

        const response = (await this.connection.agent.request(
          acp.methods.agent.session.prompt,
          {
            sessionId: targetSessionId,
            prompt: promptBlocks,
          },
        )) as { stopReason?: string; _meta?: unknown };

        // Authoritative end-of-turn numbers (and the only place the input /
        // output / cache split is reported).
        this.noteTurnUsage(targetSessionId, response?._meta);

        // If cancel() already cleared this turn, skip a second stop/error event.
        if (this.runningTurns.get(targetSessionId) === abort) {
          this.send("agent:turn", {
            status: "stopped",
            sessionId: targetSessionId,
            stopReason: abort.signal.aborted
              ? "cancelled"
              : response?.stopReason,
          });
          // Deliberately not awaited: the turn must end without waiting on a
          // filesystem walk. Chips appear a moment later.
          void this.emitTurnArtifacts(targetSessionId);
        }
      }
      // else: cancel already notified the UI
    } catch (e) {
      // Cancel races: agent may reject the in-flight prompt after session/cancel.
      if (
        abort.signal.aborted ||
        this.runningTurns.get(targetSessionId) !== abort
      ) {
        result = { ok: true };
      } else {
        const error = e instanceof Error ? e.message : String(e);
        this.send("agent:turn", {
          status: "error",
          sessionId: targetSessionId,
          error,
        });
        result = { ok: false, error };
      }
    } finally {
      // Only the owner of this turn clears the slot (cancel may have already).
      if (this.runningTurns.get(targetSessionId) === abort) {
        this.runningTurns.delete(targetSessionId);
      }
      // A turn that errored or was cancelled never reaches emitTurnArtifacts.
      this.turnScans.delete(targetSessionId);
      await this.endComputerUseTurn(targetSessionId, "turn-ended");
    }

    // Refresh titles/order after the turn is fully off `runningTurns` so
    // mergeSessionList cannot re-stick the sidebar spinner.
    try {
      const sessions = await this.listSessions(null);
      this.emitSessions(sessions);
    } catch {
      // Do not emit an empty list — that would wipe the sidebar.
    }

    return result;
  }

  /**
   * Report previewable files the turn produced.
   *
   * The agent does not tell us: writing a spreadsheet through a shell command
   * arrives as an `execute` tool call with no diff and no locations, so the
   * transcript has nothing to link to. We look at the workspace instead.
   *
   * Reads and clears the turn record synchronously — `prompt()`'s `finally`
   * runs before the first await below.
   */
  private async emitTurnArtifacts(sessionId: string): Promise<void> {
    const scan = this.turnScans.get(sessionId);
    this.turnScans.delete(sessionId);
    if (!scan) return;

    try {
      const paths = await scanWorkspaceArtifacts(scan.root, {
        since: scan.startedAt,
      });
      if (paths.length > 0) {
        this.send("agent:turn-artifacts", { sessionId, paths });
      }
    } catch {
      // Best-effort enrichment — never surface a scan failure as a turn error.
    }
  }

  /**
   * Cancel the in-flight turn for `sessionId`, or the focused session if omitted.
   * Other sessions continue running. Emits `agent:turn` stopped immediately so
   * the sidebar spinner does not wait on the agent.
   */
  cancel(sessionId?: string): { ok: boolean } {
    const id = sessionId ?? this.activeSessionId;
    if (!id) return { ok: false };
    if (!this.cancelSessionTurn(id)) return { ok: false };
    this.send("agent:turn", {
      status: "stopped",
      sessionId: id,
      stopReason: "cancelled",
    });
    void this.endComputerUseTurn(id, "turn-cancelled");
    return { ok: true };
  }

  /**
   * Mid-turn steer (TUI Ctrl+Enter / "Send now"): merge text into the running
   * turn without cancelling it. Uses agent ext method `x.ai/interject`.
   */
  async interject(
    text: string,
    sessionId?: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!this.connection || this.state.status !== "ready") {
      return { ok: false, error: "Not connected" };
    }
    const trimmed = text.trim();
    if (!trimmed) return { ok: false, error: "Empty interjection" };

    if (sessionId) this.activeSessionId = sessionId;
    const id = this.activeSessionId;
    if (!id) return { ok: false, error: "No active session" };
    if (!this.isTurnRunning(id)) {
      return { ok: false, error: "No running turn to interject into" };
    }

    const interjectionId = `ij-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      await this.connection.agent.request("x.ai/interject", {
        sessionId: id,
        text: trimmed,
        interjectionId,
      });
      this.send("agent:log", {
        level: "info",
        text: `Interjection sent (${interjectionId})`,
      });
      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  getModels(): ModelState {
    return this.modelState();
  }

  getPermissionMode(): PermissionMode {
    return this.permissionMode;
  }

  /**
   * Switch model (and optional reasoning effort) for the active session via
   * Grok's `session/set_model`. Effort is sent as `_meta.reasoningEffort`
   * (same wire key as the TUI / headless client).
   * If no session yet, only remembers the preference for the next session/new.
   */
  async setModel(
    modelId: string,
    reasoningEffort?: string | null,
    rememberPreference = reasoningEffort !== undefined,
  ): Promise<{ ok: boolean; models?: ModelState; error?: string }> {
    if (!modelId.trim()) {
      return { ok: false, error: "Missing model id" };
    }
    const previousModelId = this.modelId;
    const previousEffort = this.reasoningEffort;
    this.modelId = modelId;
    const requestedEffort =
      typeof reasoningEffort === "string" && reasoningEffort.trim()
        ? reasoningEffort.trim()
        : reasoningEffort === null
          ? undefined
          : preferredEffortForModel(
              this.availableModels.find((m) => m.modelId === modelId),
              this.preferredReasoningEffort,
            );
    if (rememberPreference && requestedEffort) {
      this.preferredReasoningEffort = requestedEffort;
      writeReasoningEffortPreference(requestedEffort);
    }
    this.reasoningEffort = requestedEffort;
    this.emitModels();

    if (!this.connection || this.state.status !== "ready" || !this.activeSessionId) {
      if (this.state.status === "ready") this.setState(this.readyState());
      return { ok: true, models: this.modelState() };
    }

    try {
      const params: Record<string, unknown> = {
        sessionId: this.activeSessionId,
        modelId,
      };
      if (this.reasoningEffort) {
        // Agent reads `meta.reasoningEffort` (serialized as `_meta` on the wire).
        params._meta = { reasoningEffort: this.reasoningEffort };
      }
      const response = (await this.connection.agent.request(
        "session/set_model",
        params,
      )) as { models?: unknown };
      this.applyModelState(response?.models);
      // The response may repeat the catalog default rather than the requested
      // session override. A successful request keeps the explicit choice.
      this.modelId = modelId;
      const updatedModel = this.availableModels.find(
        (model) => model.modelId === modelId,
      );
      this.reasoningEffort = updatedModel?.supportsReasoningEffort === false
        ? undefined
        : requestedEffort;
      this.emitModels();
      this.setState(this.readyState());
      return { ok: true, models: this.modelState() };
    } catch (e) {
      // The agent kept the old model, so the picker must not claim otherwise —
      // a silent mismatch sends prompts to a model the user did not choose.
      this.modelId = previousModelId;
      this.reasoningEffort = previousEffort;
      this.emitModels();
      if (this.state.status === "ready") this.setState(this.readyState());
      const error = e instanceof Error ? e.message : String(e);
      return { ok: false, error, models: this.modelState() };
    }
  }

  /**
   * Codex-style approval mode → Grok permission mode.
   * Broadcasts `x.ai/yolo_mode_changed` when connected so live sessions update.
   */
  async setPermissionMode(
    mode: PermissionMode,
  ): Promise<{ ok: boolean; permissionMode: PermissionMode; error?: string }> {
    if (mode !== "ask" && mode !== "auto" && mode !== "always-approve") {
      return {
        ok: false,
        permissionMode: this.permissionMode,
        error: "Invalid permission mode",
      };
    }
    this.permissionMode = mode;
    this.setState(
      this.state.status === "ready" ? this.readyState() : this.state,
    );

    if (!this.connection || this.state.status !== "ready") {
      return { ok: true, permissionMode: mode };
    }

    try {
      // Explicit booleans: agent seeds auto only from auto_mode / permission_mode=auto,
      // and yolo only from yolo_mode (must clear the other when switching).
      await this.connection.agent.notify("x.ai/yolo_mode_changed", {
        permission_mode: mode,
        yolo_mode: mode === "always-approve",
        auto_mode: mode === "auto",
      });
      this.send("agent:log", {
        level: "info",
        text: `Permission mode → ${mode}`,
      });
      return { ok: true, permissionMode: mode };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      // Preference is still stored locally for next session/new.
      return { ok: true, permissionMode: mode, error };
    }
  }

  private cleanupProcessOnly() {
    if (this.computerUseSessionIds.size > 0) {
      void this.endComputerUseTurn(null, "agent-process-exited", true);
    }
    // Clear sticky sidebars: every in-flight turn ends when the agent process dies.
    for (const sessionId of this.runningTurns.keys()) {
      this.send("agent:turn", {
        status: "stopped",
        sessionId,
        stopReason: "disconnected",
      });
    }
    this.connection = null;
    this.activeSessionId = null;
    this.child = null;
    this.runningTurns.clear();
    this.historyLoads.clear();
    this.clearHistoryPreview();
    this.modelSyncs.clear();
    this.availableCommandsBySession.clear();
    for (const [, p] of this.pendingPermissions) {
      p.resolve({ outcome: { outcome: "cancelled" } });
    }
    this.pendingPermissions.clear();
  }

  private async disconnectInternal(): Promise<void> {
    await this.endComputerUseTurn(null, "agent-disconnected", true);
    try {
      this.connection?.close();
    } catch {
      // ignore
    }
    if (this.child && !this.child.killed) {
      this.child.kill();
    }
    this.cleanupProcessOnly();
  }

  async disconnect(): Promise<void> {
    this.connectGen += 1;
    const run = async () => {
      await this.disconnectInternal();
      this.setState({ status: "disconnected" });
    };
    const result = this.connectChain.then(run, run);
    this.connectChain = result.then(
      () => undefined,
      () => undefined,
    );
    await result;
  }
}

function normalizeSessionRow(s: Record<string, unknown>): AgentSessionSummary {
  const sessionId = String(s.sessionId ?? s.session_id ?? "");
  // Prefer generated title fields from the agent wire shape. Leave empty when
  // unknown so the renderer can localize "untitled" instead of baking English
  // "Untitled session" into state (which desynced sidebar i18n vs topbar).
  const rawTitle = String(
    s.title ||
      s.generated_title ||
      s.generatedTitle ||
      s.summary ||
      s.session_summary ||
      s.sessionSummary ||
      "",
  ).trim();
  const title =
    !rawTitle || rawTitle.toLowerCase() === "untitled session" ? "" : rawTitle;
  return {
    sessionId,
    title,
    summary: String(s.summary ?? s.session_summary ?? s.sessionSummary ?? ""),
    cwd: String(s.cwd ?? ""),
    updatedAt: String(s.updatedAt ?? s.updated_at ?? ""),
    createdAt: String(s.createdAt ?? s.created_at ?? ""),
    modelId: (s.modelId ?? s.model_id) as string | undefined,
    numMessages: (s.numMessages ?? s.num_messages) as number | undefined,
    source: s.source as string | undefined,
    lastActiveAt: (s.lastActiveAt ?? s.last_active_at) as string | undefined,
  };
}

function normalizeSearchHit(s: Record<string, unknown>): AgentSessionSearchHit {
  const matchedRaw = s.matchedFields ?? s.matched_fields;
  const matchedFields = Array.isArray(matchedRaw)
    ? matchedRaw.map((x) => String(x))
    : [];
  const snippetRaw = s.snippet;
  const snippet =
    typeof snippetRaw === "string" && snippetRaw.length > 0
      ? snippetRaw
      : undefined;
  return {
    sessionId: String(s.sessionId ?? s.session_id ?? ""),
    cwd: String(s.cwd ?? ""),
    summary: String(s.summary ?? s.title ?? ""),
    updatedAt: String(s.updatedAt ?? s.updated_at ?? ""),
    score: typeof s.score === "number" ? s.score : Number(s.score) || 0,
    matchedFields,
    snippet,
  };
}

function parseEffortOptions(raw: unknown): ReasoningEffortOption[] {
  if (!Array.isArray(raw)) return [];
  const out: ReasoningEffortOption[] = [];
  for (const el of raw) {
    if (typeof el === "string" && el.trim()) {
      const value = el.trim();
      out.push({
        id: value,
        value,
        label: cleanEffortLabel(value),
      });
      continue;
    }
    if (!el || typeof el !== "object") continue;
    const o = el as Record<string, unknown>;
    const valueRaw = o.value ?? o.id;
    const value =
      typeof valueRaw === "string"
        ? valueRaw.trim()
        : valueRaw
          ? String(valueRaw)
          : "";
    if (!value) continue;
    const id =
      typeof o.id === "string" && o.id.trim() ? o.id.trim() : value;
    const rawLabel =
      typeof o.label === "string" && o.label.trim()
        ? o.label.trim()
        : id.charAt(0).toUpperCase() + id.slice(1);
    const label = cleanEffortLabel(value, rawLabel);
    const description =
      typeof o.description === "string" && o.description.trim()
        ? o.description.trim()
        : undefined;
    out.push({
      id,
      value,
      label,
      description,
      default: o.default === true,
    });
  }
  return out;
}

/** Positive integer token count, or null for absent/garbage values. */
function tokenCount(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return null;
  return Math.floor(raw);
}

function parseModelMeta(m: Record<string, unknown>): {
  supportsReasoningEffort: boolean;
  defaultReasoningEffort: string | null;
  reasoningEfforts: ReasoningEffortOption[];
  contextWindowTokens: number | null;
} {
  const metaRaw = m.meta ?? m._meta;
  const meta =
    metaRaw && typeof metaRaw === "object"
      ? (metaRaw as Record<string, unknown>)
      : null;
  // Also accept top-level fields (some agents flatten mock/catalog rows).
  const src = meta ?? m;
  const supports =
    src.supportsReasoningEffort === true ||
    src.supports_reasoning_effort === true;
  const effortRaw = src.reasoningEffort ?? src.reasoning_effort;
  const defaultReasoningEffort =
    typeof effortRaw === "string" && effortRaw.trim()
      ? effortRaw.trim()
      : null;
  const reasoningEfforts = parseEffortOptions(
    src.reasoningEfforts ?? src.reasoning_efforts,
  );
  // Grok sends `totalContextTokens`; the others are defensive aliases so an
  // agent/version rename degrades to the fallback instead of breaking.
  const contextWindowTokens = tokenCount(
    src.totalContextTokens ??
      src.total_context_tokens ??
      src.contextWindowTokens ??
      src.contextWindow ??
      src.context_window,
  );
  return {
    supportsReasoningEffort: supports || reasoningEfforts.length > 0,
    defaultReasoningEffort,
    reasoningEfforts,
    contextWindowTokens,
  };
}

function parseModelState(raw: unknown): ModelState | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const current =
    (obj.currentModelId as string | undefined) ??
    (obj.current_model_id as string | undefined) ??
    null;
  const listRaw =
    (obj.availableModels as unknown[] | undefined) ??
    (obj.available_models as unknown[] | undefined) ??
    [];
  const availableModels: ModelInfo[] = [];
  if (Array.isArray(listRaw)) {
    for (const item of listRaw) {
      if (!item || typeof item !== "object") continue;
      const m = item as Record<string, unknown>;
      const idRaw = m.modelId ?? m.model_id ?? m.id;
      const id =
        typeof idRaw === "string"
          ? idRaw
          : idRaw && typeof idRaw === "object" && "0" in (idRaw as object)
            ? String((idRaw as { 0?: string })[0] ?? "")
            : idRaw
              ? String(idRaw)
              : "";
      if (!id) continue;
      const name = String(m.name ?? m.displayName ?? m.display_name ?? id);
      const {
        supportsReasoningEffort,
        defaultReasoningEffort,
        reasoningEfforts,
        contextWindowTokens,
      } = parseModelMeta(m);
      availableModels.push({
        modelId: id,
        name,
        supportsReasoningEffort,
        defaultReasoningEffort,
        reasoningEfforts,
        contextWindowTokens,
      });
    }
  }
  let currentReasoningEffort: string | null = null;
  if (current) {
    const cur = availableModels.find((m) => m.modelId === String(current));
    if (cur?.supportsReasoningEffort) {
      // Session-stamped effort lives on the current model's meta.
      currentReasoningEffort =
        cur.defaultReasoningEffort ??
        cur.reasoningEfforts?.find((o) => o.default)?.value ??
        null;
    }
  }
  return {
    currentModelId: current ? String(current) : null,
    currentReasoningEffort,
    availableModels,
  };
}

export const sessionManager = new SessionManager();
