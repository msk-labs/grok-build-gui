import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type {
  AgentSessionSearchHit,
  AgentSessionSummary,
  ConnectResult,
  ConnectionState,
  ContextSessionUsage,
  ContextTurnUsage,
  ContextUsage,
  ModelInfo,
  ModelState,
  PermissionMode,
  ReasoningEffortOption,
  SessionWorktree,
  WorktreeCreateOptions,
  WorktreeRecord,
  WorktreeStatusEvent,
} from "./acp/sessionManager";
import type { GrokAccount, GrokUsage } from "./grokAccount";
import type { OfficeDocument } from "./office/types";
import type { GrokAuthActionResult } from "./grokAuth";
import type {
  ChatGptActionResult,
  ChatGptStatus,
} from "./providers/chatgptProvider";
import type { NormalizedUsage, ProviderAccount, UsageWindow } from "./providers/types";
import type {
  ApiBackend,
  CustomEndpoint,
  CustomEndpointInput,
  CustomModel,
} from "./providers/customEndpoints";
import type { EndpointPreset } from "./providers/endpointPresets";
import type { DiscoveredModel, DiscoveryResult } from "./providers/modelDiscovery";
import type {
  ComputerUsePermissionCheckResult,
  ComputerUseStatus,
} from "./computerUse";
import type { SlashCommand } from "./slashCommands";
import type { UpdateStatus } from "./updater";
import type {
  TerminalShellOption,
  TerminalShellPreference,
} from "./terminalShell";
import type {
  AvailablePlugin,
  InstalledPlugin,
  PluginActionResult,
  PluginListResult,
} from "./plugins";

export type {
  AgentSessionSearchHit,
  AgentSessionSummary,
  ConnectResult,
  ConnectionState,
  ContextSessionUsage,
  ContextTurnUsage,
  ContextUsage,
  ModelInfo,
  ModelState,
  PermissionMode,
  ReasoningEffortOption,
  SessionWorktree,
  WorktreeCreateOptions,
  WorktreeRecord,
  WorktreeStatusEvent,
};
export type { GrokAccount, GrokUsage };
export type { GrokAuthActionResult };
export type {
  ChatGptActionResult,
  ChatGptStatus,
  NormalizedUsage,
  ProviderAccount,
  UsageWindow,
};
export type {
  ApiBackend,
  CustomEndpoint,
  CustomEndpointInput,
  CustomModel,
  DiscoveredModel,
  DiscoveryResult,
  EndpointPreset,
};
export type { ComputerUsePermissionCheckResult, ComputerUseStatus };
export type { SlashCommand };
export type { UpdateStatus };
export type {
  AvailablePlugin,
  InstalledPlugin,
  PluginActionResult,
  PluginListResult,
};

export type GrokProbe = {
  path: string;
  version: string | null;
};

export type PermissionRequest = {
  requestId: string;
  sessionId?: string;
  toolCall: {
    toolCallId?: string;
    title?: string;
    kind?: string;
    rawInput?: unknown;
  };
  options: Array<{ optionId: string; name: string; kind: string }>;
};

export type TurnEvent =
  | { status: "started"; sessionId: string }
  | { status: "stopped"; sessionId: string; stopReason?: string }
  | { status: "error"; sessionId: string; error: string };

export type SessionsEvent = {
  sessions: AgentSessionSummary[];
  cwd: string;
  /** Live turns in this Electron agent process — drives sidebar spinners. */
  runningSessionIds?: string[];
  error?: string;
};

export type HistoryEvent = {
  sessionId: string;
  cwd: string;
  error?: string;
  /**
   * `history-end` only: a reconnect retired this load mid-replay. Carries no
   * transcript — the renderer should stop waiting and leave the session
   * unloaded so the next click fetches it over the new connection.
   */
  retired?: boolean;
  /**
   * Pre-folded chat messages from main (preferred). Avoids shipping the raw
   * session/update buffer over IPC and re-applying chunks in the renderer.
   */
  messages?: unknown[];
  /** @deprecated Prefer `messages` — kept for older main processes. */
  notifications?: unknown[];
  updateCount?: number;
  messageCount?: number;
  foldMs?: number;
  /** Main-process timing from session/load request start. */
  loadMs?: number;
  firstUpdateMs?: number | null;
  lastUpdateMs?: number | null;
};

export type SessionLoadedEvent = {
  sessionId: string;
  cwd: string;
  isNew: boolean;
  /** Scratch sessions populate a side pane without taking main-chat focus. */
  isSideTask?: boolean;
  /** Present when the session runs inside a grok-managed git worktree. */
  worktree?: SessionWorktree;
};

/** Browser slot id — mirrors terminal tabs (e.g. right-1, bottom-2). */
export type BrowserId = string;

export type BrowserState = {
  id: BrowserId;
  open: boolean;
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  cdpEndpoint: string | null;
  error: string | null;
  viewport: { width: number; height: number };
  /** True if any browser slot is open. */
  anyOpen: boolean;
};

export type BrowserOpenRequest = {
  startUrl?: string;
  nonce: number;
};

/** @deprecated Screenshot frames are no longer streamed. */
export type BrowserFrameEvent = {
  id: BrowserId;
  jpegBase64: string;
  url: string;
  title: string;
  width: number;
  height: number;
};

/** PTY slot id: "side" (right panel) or dynamic bottom tabs e.g. "bottom-1". */
export type TerminalId = string;

export type TerminalState = {
  id: TerminalId;
  alive: boolean;
  shell: string;
  cwd: string;
  cols: number;
  rows: number;
  error: string | null;
};

export type TerminalCreateResult = TerminalState & {
  scrollback: string;
};

export type TerminalDataEvent = {
  id: string;
  data: string;
};

export type TerminalExitEvent = {
  id: string;
  exitCode: number | null;
  signal: number | null;
};

export type TerminalSizeOpts = {
  id?: TerminalId;
  cols?: number;
  rows?: number;
  cwd?: string | null;
  shellPreference?: TerminalShellPreference;
};

function on(
  channel: string,
  listener: (payload: unknown) => void,
): () => void {
  const handler = (_event: IpcRendererEvent, payload: unknown) =>
    listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api = {
  /** Host OS for renderer chrome layout (traffic lights vs native title bar). */
  platform: process.platform as "darwin" | "win32" | "linux",
  /**
   * Windows custom title bar: open an application submenu at window coords.
   * No-op / unavailable on macOS (system menu bar is used instead).
   */
  popupAppMenu: (opts: {
    menuId: "file" | "edit" | "view" | "window" | "help";
    x: number;
    y: number;
  }): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("window:popup-app-menu", opts),
  /** Windows: whether the BrowserWindow is maximized (for CSS corner radius). */
  getWindowMaximized: (): Promise<boolean> =>
    ipcRenderer.invoke("window:is-maximized"),
  onWindowMaximized: (cb: (maximized: boolean) => void) =>
    on("window:maximized-changed", (p) => cb(Boolean(p))),
  probe: (): Promise<GrokProbe | null> => ipcRenderer.invoke("agent:probe"),
  getState: (): Promise<ConnectionState> =>
    ipcRenderer.invoke("agent:get-state"),
  connect: (cwd: string): Promise<ConnectResult> =>
    ipcRenderer.invoke("agent:connect", cwd),
  disconnect: (): Promise<ConnectionState> =>
    ipcRenderer.invoke("agent:disconnect"),
  /** `worktree` starts the chat in an isolated git worktree of `cwd`. */
  newSession: (
    cwd?: string,
    worktree?: WorktreeCreateOptions | null,
  ): Promise<ConnectionState> =>
    ipcRenderer.invoke("agent:new-session", cwd, worktree),
  listWorktrees: (): Promise<{
    ok: boolean;
    worktrees?: WorktreeRecord[];
    error?: string;
  }> => ipcRenderer.invoke("agent:worktree-list"),
  removeWorktree: (
    pathOrId: string,
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("agent:worktree-remove", pathOrId),
  /** `{ isRepo, branch }` for a workspace path; branch is "" when unreadable. */
  gitInfo: (cwd: string): Promise<{ isRepo: boolean; branch: string }> =>
    ipcRenderer.invoke("agent:git-info", cwd),
  /** Local branch names, newest commit first. Empty when git is unavailable. */
  gitBranches: (cwd: string): Promise<string[]> =>
    ipcRenderer.invoke("agent:git-branches", cwd),
  newSideTaskSession: (cwd?: string): Promise<ConnectionState> =>
    ipcRenderer.invoke("agent:new-side-task-session", cwd),
  loadSession: (
    sessionId: string,
    cwd: string,
  ): Promise<ConnectionState> =>
    ipcRenderer.invoke("agent:load-session", sessionId, cwd),
  listSessions: (
    cwd?: string,
  ): Promise<{
    ok: boolean;
    sessions?: AgentSessionSummary[];
    runningSessionIds?: string[];
    error?: string;
  }> => ipcRenderer.invoke("agent:list-sessions", cwd),
  /**
   * Agent full-text session search (titles + bodies via FTS5).
   * Same backend as TUI deep search (`x.ai/session/search`).
   */
  searchSessions: (opts: {
    query: string;
    cwd?: string | null;
    limit?: number;
    offset?: number;
    includeContent?: boolean;
  }): Promise<
    | {
        ok: true;
        results: AgentSessionSearchHit[];
        bootstrapping: boolean;
        nextOffset?: number;
        totalEstimate?: number;
      }
    | {
        ok: false;
        error: string;
        results: AgentSessionSearchHit[];
        bootstrapping: boolean;
      }
  > => ipcRenderer.invoke("agent:search-sessions", opts),
  deleteSession: (
    sessionId: string,
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("agent:delete-session", sessionId),
  renameSession: (
    sessionId: string,
    title: string,
    cwd?: string,
  ): Promise<{ ok: boolean; title?: string; error?: string }> =>
    ipcRenderer.invoke("agent:rename-session", sessionId, title, cwd),
  prompt: (
    text: string,
    images?: Array<{ data: string; mimeType: string }>,
    /** Target session — must match the UI-focused chat to avoid cross-session work. */
    sessionId?: string,
    /** Non-image file attachments (ACP resource / resource_link). */
    files?: Array<{
      name: string;
      mimeType: string;
      uri: string;
      text?: string;
      data?: string;
      size?: number;
    }>,
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("agent:prompt", text, images, sessionId, files),
  /** Focus a session in main without replaying history (cached UI transcript). */
  focusSession: (
    sessionId: string,
    cwd?: string,
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("agent:focus-session", sessionId, cwd),
  /**
   * Region screenshot (drag-select on screen) → confirm → PNG for attach.
   * Returns cancelled when user aborts selection or confirm.
   * Pass `{ keepParentVisible: true }` (Ctrl+click) to leave this window shown.
   */
  captureScreenshot: (
    mode: "region" | "screen" | "window",
    options?: { keepParentVisible?: boolean },
  ): Promise<
    | {
        ok: true;
        cancelled: true;
      }
    | {
        ok: true;
        cancelled: false;
        image: {
          data: string;
          mimeType: string;
          dataUrl: string;
          width: number;
          height: number;
        };
      }
    | { ok: false; error: string }
  > => ipcRenderer.invoke("app:capture-screenshot", mode, options ?? {}),
  /** @deprecated Use captureScreenshot("region"). */
  captureRegion: (): Promise<
    | { ok: true; cancelled: true }
    | {
        ok: true;
        cancelled: false;
        image: {
          data: string;
          mimeType: string;
          dataUrl: string;
          width: number;
          height: number;
        };
      }
    | { ok: false; error: string }
  > => ipcRenderer.invoke("app:capture-region"),
  popupImageAttachmentMenu: (opts?: {
    locale?: string;
  }): Promise<"copy" | "save" | "remove" | null> =>
    ipcRenderer.invoke("app:popup-image-attachment-menu", opts ?? {}),
  copyImage: (
    dataUrl: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke("app:copy-image", dataUrl),
  cancel: (sessionId?: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("agent:cancel", sessionId),
  /**
   * Mid-turn interjection (TUI Send now): steer the running turn without cancel.
   * Agent ext method `x.ai/interject`.
   */
  interject: (
    text: string,
    sessionId?: string,
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("agent:interject", text, sessionId),
  /**
   * Transcribe PCM16 LE mono audio via xAI STT (main process).
   * `pcm` is raw bytes (ArrayBuffer / Uint8Array).
   */
  transcribeVoice: (opts: {
    pcm: ArrayBuffer | Uint8Array;
    sampleRate?: number;
    language?: string;
    localeHint?: string;
  }): Promise<{ ok: true; text: string } | { ok: false; error: string }> =>
    ipcRenderer.invoke("voice:transcribe", opts),

  /**
   * Live dictation (console-style streaming STT).
   * partial events fire while speaking; stop() returns final text.
   */
  voiceLiveStart: (opts?: {
    sampleRate?: number;
    language?: string;
    localeHint?: string;
  }): Promise<{ ok: true; id: number } | { ok: false; error: string }> =>
    ipcRenderer.invoke("voice:live-start", opts),
  voiceLiveAudio: (payload: {
    id: number;
    pcm: ArrayBuffer | Uint8Array;
  }): Promise<{ ok: boolean }> => ipcRenderer.invoke("voice:live-audio", payload),
  voiceLiveStop: (
    id: number,
  ): Promise<{ ok: true; text: string } | { ok: false; error: string }> =>
    ipcRenderer.invoke("voice:live-stop", { id }),
  voiceLiveCancel: (id: number): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("voice:live-cancel", { id }),
  onVoicePartial: (
    cb: (ev: {
      id: number;
      /** speech_final utterances (solid). */
      committed: string;
      /** In-progress words (muted). */
      interim: string;
      /** committed + interim. */
      text: string;
    }) => void,
  ) =>
    on("voice:partial", (p) =>
      cb(
        p as {
          id: number;
          committed: string;
          interim: string;
          text: string;
        },
      ),
    ),
  onVoiceError: (cb: (ev: { id: number; error: string }) => void) =>
    on("voice:error", (p) => cb(p as { id: number; error: string })),
  getModels: (): Promise<ModelState> => ipcRenderer.invoke("agent:get-models"),
  setModel: (
    modelId: string,
    reasoningEffort?: string | null,
  ): Promise<{ ok: boolean; models?: ModelState; error?: string }> =>
    ipcRenderer.invoke("agent:set-model", modelId, reasoningEffort),
  getPermissionMode: (): Promise<PermissionMode> =>
    ipcRenderer.invoke("agent:get-permission-mode"),
  setPermissionMode: (
    mode: PermissionMode,
  ): Promise<{ ok: boolean; permissionMode: PermissionMode; error?: string }> =>
    ipcRenderer.invoke("agent:set-permission-mode", mode),
  respondPermission: (
    requestId: string,
    optionId: string | null,
  ): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("agent:permission-response", requestId, optionId),
  selectDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke("dialog:select-directory"),
  getDefaultCwd: (): Promise<string> =>
    ipcRenderer.invoke("app:get-default-cwd"),
  /** Root for isolated task chats: ~/Documents/GrokBuildGUI */
  getTaskWorkspaceRoot: (): Promise<string> =>
    ipcRenderer.invoke("app:get-task-workspace-root"),
  /** Create ~/Documents/GrokBuildGUI/<timestamp>/ for a new task session. */
  createTaskWorkspace: (): Promise<string> =>
    ipcRenderer.invoke("app:create-task-workspace"),
  getComputerUseStatus: (): Promise<ComputerUseStatus> =>
    ipcRenderer.invoke("computer-use:get-status"),
  setComputerUseEnabled: (enabled: boolean): Promise<ComputerUseStatus> =>
    ipcRenderer.invoke("computer-use:set-enabled", enabled),
  checkComputerUsePermissions:
    (): Promise<ComputerUsePermissionCheckResult> =>
      ipcRenderer.invoke("computer-use:check-permissions"),
  getGrokAccount: (): Promise<GrokAccount> =>
    ipcRenderer.invoke("grok:get-account"),
  loginGrok: (): Promise<GrokAuthActionResult> =>
    ipcRenderer.invoke("grok:login"),
  cancelGrokLogin: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("grok:cancel-login"),
  logoutGrok: (): Promise<GrokAuthActionResult> =>
    ipcRenderer.invoke("grok:logout"),
  getGrokUsage: (): Promise<GrokUsage> =>
    ipcRenderer.invoke("grok:get-usage"),

  /**
   * ChatGPT subscription provider. Models reach the agent through a loopback
   * relay, so signing in or out reconnects the agent to refresh its catalog.
   */
  getChatGptStatus: (): Promise<ChatGptStatus> =>
    ipcRenderer.invoke("provider:chatgpt:get-status"),
  loginChatGpt: (): Promise<ChatGptActionResult> =>
    ipcRenderer.invoke("provider:chatgpt:login"),
  cancelChatGptLogin: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("provider:chatgpt:cancel-login"),
  logoutChatGpt: (): Promise<ChatGptActionResult> =>
    ipcRenderer.invoke("provider:chatgpt:logout"),
  getChatGptUsage: (): Promise<NormalizedUsage> =>
    ipcRenderer.invoke("provider:chatgpt:get-usage"),

  /**
   * User-added model endpoints (vendor APIs and relay gateways). API keys go
   * in and are never returned — `hasApiKey` is all the renderer learns.
   */
  listModelEndpoints: (): Promise<CustomEndpoint[]> =>
    ipcRenderer.invoke("provider:endpoints:list"),
  getEndpointPresets: (): Promise<EndpointPreset[]> =>
    ipcRenderer.invoke("provider:endpoints:presets"),
  discoverEndpointModels: (options: {
    endpointId?: string;
    baseUrl: string;
    apiKey?: string;
    apiBackend: ApiBackend;
  }): Promise<DiscoveryResult> =>
    ipcRenderer.invoke("provider:endpoints:discover", options),
  saveModelEndpoint: (
    input: CustomEndpointInput,
  ): Promise<
    { ok: true; endpoint: CustomEndpoint } | { ok: false; error: string }
  > => ipcRenderer.invoke("provider:endpoints:save", input),
  removeModelEndpoint: (id: string): Promise<{ ok: true }> =>
    ipcRenderer.invoke("provider:endpoints:remove", id),
  /**
   * Launch the bundled Grok Build interactive TUI in the system terminal.
   * Optional cwd defaults to the active workspace on the main process.
   */
  openGrokTui: (
    cwd?: string | null,
  ): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke("grok:open-tui", cwd),
  /**
   * User-invocable skills for `/` autocomplete.
   * Backed by `grok inspect --json` (same discovery as CLI/TUI).
   */
  listSlashCommands: (
    cwd?: string | null,
  ): Promise<
    | { ok: true; commands: SlashCommand[] }
    | { ok: false; error: string }
  > => ipcRenderer.invoke("grok:list-slash-commands", cwd),

  listPlugins: (): Promise<PluginListResult> =>
    ipcRenderer.invoke("grok:list-plugins"),
  installPlugin: (source: string): Promise<PluginActionResult> =>
    ipcRenderer.invoke("grok:install-plugin", source),
  uninstallPlugin: (name: string): Promise<PluginActionResult> =>
    ipcRenderer.invoke("grok:uninstall-plugin", name),
  enablePlugin: (name: string): Promise<PluginActionResult> =>
    ipcRenderer.invoke("grok:enable-plugin", name),
  disablePlugin: (name: string): Promise<PluginActionResult> =>
    ipcRenderer.invoke("grok:disable-plugin", name),

  /** Workspace file tree + text preview (Files panel). */
  listDir: (opts: {
    root: string;
    path?: string;
    showHidden?: boolean;
  }): Promise<
    | {
        ok: true;
        path: string;
        entries: Array<{
          name: string;
          path: string;
          kind: "file" | "dir";
          size?: number;
        }>;
      }
    | { ok: false; error: string }
  > => ipcRenderer.invoke("fs:list-dir", opts),
  readTextFile: (opts: {
    root: string;
    path: string;
    maxBytes?: number;
  }): Promise<
    | {
        ok: true;
        path: string;
        text: string;
        truncated: boolean;
        binary: boolean;
        size: number;
      }
    | { ok: false; error: string }
  > => ipcRenderer.invoke("fs:read-text", opts),
  /**
   * OS icon for a document type (the Word/Excel/PowerPoint glyph from Finder).
   * `dataUrl` is absent when the platform has no icon for the type.
   */
  fileIcon: (opts: {
    root: string;
    path: string;
  }): Promise<
    { ok: true; dataUrl?: string } | { ok: false; error: string }
  > => ipcRenderer.invoke("fs:file-icon", opts),
  /** Parse a spreadsheet / Word / PowerPoint file for the Office viewers. */
  readOfficeDoc: (opts: {
    root: string;
    path: string;
    /** Which workbook sheet to materialize; defaults to the first. */
    sheet?: string;
  }): Promise<
    | { ok: true; path: string; doc: OfficeDocument }
    | { ok: false; error: string }
  > => ipcRenderer.invoke("fs:read-office", opts),
  /** Write an edited grid back to a csv/tsv/xlsx file. */
  writeSheet: (opts: {
    root: string;
    path: string;
    sheet: string;
    rows: string[][];
  }): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke("fs:write-sheet", opts),
  /** Load imagine/session image from disk for inline chat display. */
  readImageDataUrl: (
    filePath: string,
  ): Promise<
    { ok: true; dataUrl: string } | { ok: false; error: string }
  > => ipcRenderer.invoke("fs:read-image-data-url", filePath),
  /** Save-as dialog for lightbox / chat images. */
  saveImage: (opts: {
    dataUrl?: string;
    sourcePath?: string;
    defaultName?: string;
  }): Promise<
    | { ok: true; path: string }
    | { ok: false; canceled?: boolean; error?: string }
  > => ipcRenderer.invoke("dialog:save-image", opts),
  revealInFolder: (opts: {
    root: string;
    path: string;
  }): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke("fs:reveal", opts),
  /** Apps that can open this file/folder (Open With submenu). */
  listOpenWith: (opts: {
    root: string;
    path: string;
  }): Promise<
    | {
        ok: true;
        apps: Array<{
          name: string;
          path: string;
          isDefault?: boolean;
          iconDataUrl?: string;
        }>;
      }
    | { ok: false; error: string }
  > => ipcRenderer.invoke("fs:list-open-with", opts),
  /** Open with a specific app; omit appPath for the OS default. */
  openWith: (opts: {
    root: string;
    path: string;
    appPath?: string;
  }): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke("fs:open-with", opts),

  /**
   * Built-in browser panes (one retained renderer <webview> per id).
   * Pass the split-panel tab id so right/bottom browsers stay independent.
   */
  getBrowserState: (id?: BrowserId): Promise<BrowserState> =>
    ipcRenderer.invoke("browser:get-state", id),
  browserOpen: (
    opts?:
      | string
      | {
          id?: BrowserId;
          startUrl?: string;
          width?: number;
          height?: number;
        },
  ): Promise<BrowserState> => ipcRenderer.invoke("browser:open", opts),
  /** Close one slot by id, or all slots when id is omitted. */
  browserClose: (id?: BrowserId | null): Promise<BrowserState> =>
    ipcRenderer.invoke("browser:close", id),
  browserNavigate: (
    urlOrOpts: string | { id?: BrowserId; url: string },
  ): Promise<BrowserState> =>
    ipcRenderer.invoke("browser:navigate", urlOrOpts),
  browserGoBack: (id?: BrowserId): Promise<BrowserState> =>
    ipcRenderer.invoke("browser:go-back", id),
  browserGoForward: (id?: BrowserId): Promise<BrowserState> =>
    ipcRenderer.invoke("browser:go-forward", id),
  browserReload: (id?: BrowserId): Promise<BrowserState> =>
    ipcRenderer.invoke("browser:reload", id),
  /** Bind an isolated webview guest to main-process state and automation. */
  browserAttachWebview: (payload: {
    id: BrowserId;
    webContentsId: number;
    width: number;
    height: number;
  }): Promise<BrowserState> =>
    ipcRenderer.invoke("browser:attach-webview", payload),
  /** Report viewport metadata without a request/response trip per drag frame. */
  browserSetViewport: (payload: {
    id: BrowserId;
    width: number;
    height: number;
  }): void => {
    ipcRenderer.send("browser:set-viewport", payload);
  },
  browserFocus: (id?: BrowserId | null): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("browser:focus", id),
  onBrowserState: (cb: (state: BrowserState) => void) =>
    on("browser:state", (p) => cb(p as BrowserState)),
  /** Browser MCP requested the visible right-side browser tab. */
  onBrowserOpenRequest: (cb: (request: BrowserOpenRequest) => void) =>
    on("browser:request-open", (p) => cb(p as BrowserOpenRequest)),
  /** Destroy the retained renderer webview after its browser tab closes. */
  onBrowserDestroyRequest: (cb: (id: BrowserId) => void) =>
    on("browser:destroy", (p) => cb(String(p))),
  /** @deprecated No longer emitted — embedded webview replaces screencast. */
  onBrowserFrame: (cb: (frame: BrowserFrameEvent) => void) =>
    on("browser:frame", (p) => cb(p as BrowserFrameEvent)),

  /** Built-in PTY terminals (node-pty + xterm). Id: "side" or "bottom-N". */
  listTerminalShells: (): Promise<TerminalShellOption[]> =>
    ipcRenderer.invoke("terminal:list-shells"),
  getTerminalState: (id?: TerminalId): Promise<TerminalState> =>
    ipcRenderer.invoke("terminal:get-state", id),
  terminalCreate: (opts?: TerminalSizeOpts): Promise<TerminalCreateResult> =>
    ipcRenderer.invoke("terminal:create", opts),
  terminalRestart: (opts?: TerminalSizeOpts): Promise<TerminalCreateResult> =>
    ipcRenderer.invoke("terminal:restart", opts),
  terminalWrite: (
    dataOrPayload: string | { id?: TerminalId; data: string },
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("terminal:write", dataOrPayload),
  terminalResize: (
    colsOrPayload: number | { id?: TerminalId; cols: number; rows: number },
    rows?: number,
  ): Promise<{ ok: boolean }> => {
    if (typeof colsOrPayload === "object" && colsOrPayload != null) {
      return ipcRenderer.invoke("terminal:resize", colsOrPayload);
    }
    return ipcRenderer.invoke("terminal:resize", {
      id: "side",
      cols: colsOrPayload,
      rows: rows ?? 24,
    });
  },
  terminalKill: (id?: TerminalId): Promise<TerminalState> =>
    ipcRenderer.invoke("terminal:kill", id),
  onTerminalState: (cb: (state: TerminalState) => void) =>
    on("terminal:state", (p) => cb(p as TerminalState)),
  onTerminalData: (cb: (ev: TerminalDataEvent) => void) =>
    on("terminal:data", (p) => cb(p as TerminalDataEvent)),
  onTerminalExit: (cb: (ev: TerminalExitEvent) => void) =>
    on("terminal:exit", (p) => cb(p as TerminalExitEvent)),

  /** App auto-update: status is push-driven; these only kick off transitions. */
  getUpdateStatus: (): Promise<UpdateStatus> =>
    ipcRenderer.invoke("update:get-status"),
  checkForUpdates: (): Promise<UpdateStatus> =>
    ipcRenderer.invoke("update:check"),
  downloadUpdate: (): Promise<UpdateStatus> =>
    ipcRenderer.invoke("update:download"),
  installUpdate: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("update:install"),
  onUpdateStatus: (cb: (status: UpdateStatus) => void) =>
    on("update:status", (p) => cb(p as UpdateStatus)),

  onState: (cb: (state: ConnectionState) => void) =>
    on("agent:state", (p) => cb(p as ConnectionState)),
  onSessions: (cb: (ev: SessionsEvent) => void) =>
    on("agent:sessions", (p) => cb(p as SessionsEvent)),
  onModels: (cb: (models: ModelState) => void) =>
    on("agent:models", (p) => cb(p as ModelState)),
  getContextUsage: (sessionId?: string | null): Promise<ContextUsage | null> =>
    ipcRenderer.invoke("agent:get-context-usage", sessionId ?? null),
  onContextUsage: (cb: (usage: ContextUsage) => void) =>
    on("agent:context-usage", (p) => cb(p as ContextUsage)),
  onHistoryStart: (cb: (ev: HistoryEvent) => void) =>
    on("agent:history-start", (p) => cb(p as HistoryEvent)),
  onHistoryProgress: (cb: (ev: HistoryEvent) => void) =>
    on("agent:history-progress", (p) => cb(p as HistoryEvent)),
  onHistoryEnd: (cb: (ev: HistoryEvent) => void) =>
    on("agent:history-end", (p) => cb(p as HistoryEvent)),
  onSessionLoaded: (cb: (ev: SessionLoadedEvent) => void) =>
    on("agent:session-loaded", (p) => cb(p as SessionLoadedEvent)),
  onSessionUpdate: (cb: (notification: unknown) => void) =>
    on("agent:session-update", cb),
  onWorktreeStatus: (cb: (ev: WorktreeStatusEvent) => void) =>
    on("agent:worktree-status", (p) => cb(p as WorktreeStatusEvent)),
  onPermission: (cb: (req: PermissionRequest) => void) =>
    on("agent:permission", (p) => cb(p as PermissionRequest)),
  onPermissionTimeout: (cb: (payload: { requestId: string }) => void) =>
    on("agent:permission-timeout", (p) => cb(p as { requestId: string })),
  onTurn: (cb: (event: TurnEvent) => void) =>
    on("agent:turn", (p) => cb(p as TurnEvent)),
  /**
   * Previewable files a finished turn left in the workspace. Arrives shortly
   * after `agent:turn` stopped — the scan must not delay the end of the turn.
   */
  onTurnArtifacts: (
    cb: (event: { sessionId: string; paths: string[] }) => void,
  ) =>
    on("agent:turn-artifacts", (p) =>
      cb(p as { sessionId: string; paths: string[] }),
    ),
  onLog: (cb: (entry: { level: string; text: string }) => void) =>
    on("agent:log", (p) => cb(p as { level: string; text: string })),
  onComputerUseStatus: (cb: (status: ComputerUseStatus) => void) =>
    on("computer-use:status", (p) => cb(p as ComputerUseStatus)),
};

contextBridge.exposeInMainWorld("grok", api);

export type GrokApi = typeof api;
