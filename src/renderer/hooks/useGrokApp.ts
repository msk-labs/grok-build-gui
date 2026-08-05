import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ConnectionState,
  ContextUsage,
  ModelState,
  PermissionMode,
  PermissionRequest,
} from "../../electron/preload";
import {
  fileToResourceUri,
  prepareFiles,
} from "../lib/attachments";
import { parseBrowserSlash } from "../lib/browserSlash";
import { parseComputerSlash } from "../lib/computerSlash";
import { useTranslation } from "react-i18next";
import {
  adoptProvisionalSession,
  isProvisionalSessionId,
  makeProvisionalSessionId,
  mergeSessionList,
  sessionProjectCwd,
} from "../lib/sessionList";
import { isPlaceholderSessionTitle } from "../lib/sessionTitle";
import { markAssistantDone, uid } from "../lib/sessionUpdate";
import { forgetSessionArtifacts } from "../lib/turnArtifacts";
import {
  markSideTask,
  unmarkSideTask,
} from "../lib/sideTasks";
import type {
  ChatFile,
  ChatImage,
  ChatMessage,
  LocalSession,
} from "../types/chat";
import type { QueuedPrompt } from "../types/promptQueue";
import type { WorkspaceGit } from "../types/worktree";
import { localizeUiError } from "../lib/uiError";
import { isTaskWorkspaceCwd } from "../lib/taskWorkspace";
import {
  forgetRecentProject,
  loadRecentProjects,
  mergeRecentProjects,
  rememberRecentProject,
} from "../lib/recentProjects";
import { createSelectionIntent } from "../lib/selectionIntent";
import { attachAgentSubscriptions } from "./agentSubscriptions";

export function useGrokApp() {
  const { t } = useTranslation();
  const [state, setState] = useState<ConnectionState>({ status: "disconnected" });
  const [sessions, setSessions] = useState<LocalSession[]>([]);
  const [sideTaskIds, setSideTaskIds] = useState<Set<string>>(() => new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [permission, setPermission] = useState<PermissionRequest | null>(null);
  const [defaultCwd, setDefaultCwd] = useState("");
  const [cwd, setCwd] = useState("");
  /** ~/Documents/GrokBuildGUI — used to classify task sessions in the sidebar. */
  const [taskWorkspaceRoot, setTaskWorkspaceRoot] = useState("");
  /** Explicitly picked folders; merged with session cwds for the picker menu. */
  const [storedRecentProjects, setStoredRecentProjects] =
    useState(loadRecentProjects);
  /**
   * New-chat draft with no project folder. On first send, a timestamped
   * dir is created under taskWorkspaceRoot and used as session cwd.
   */
  const [taskMode, setTaskMode] = useState(false);
  const taskModeRef = useRef(false);
  taskModeRef.current = taskMode;
  /**
   * New-chat draft that should run in an isolated git worktree instead of the
   * project folder itself. Name and base ref are left to the agent.
   */
  const [worktreeEnabled, setWorktreeEnabled] = useState(false);
  const worktreeEnabledRef = useRef(false);
  worktreeEnabledRef.current = worktreeEnabled;
  /**
   * Branch the new chat should start from. Empty = the workspace's current
   * branch; anything else is passed to the agent as the worktree's base ref.
   */
  const [worktreeBaseRef, setWorktreeBaseRef] = useState("");
  const worktreeBaseRefRef = useRef("");
  worktreeBaseRefRef.current = worktreeBaseRef;
  /** Repo + branch of the workspace, for the branch chip and the checkbox. */
  const [workspaceGit, setWorkspaceGit] = useState<WorkspaceGit>({
    isRepo: false,
    branch: "",
  });
  /** Live text from `worktree/status` while a worktree is being created. */
  const [worktreeProgress, setWorktreeProgress] = useState("");
  const [models, setModels] = useState<ModelState>({
    currentModelId: null,
    currentReasoningEffort: null,
    availableModels: [],
  });
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("auto");
  /**
   * Context-window usage per session id. Kept for every session (not only the
   * focused one) so a tab switch shows the right gauge without a round-trip.
   */
  const [contextUsage, setContextUsage] = useState<
    Record<string, ContextUsage>
  >({});
  /** Draft image attachments (region screenshots, drops, etc.). */
  const [pendingImages, setPendingImages] = useState<ChatImage[]>([]);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);
  /** Draft non-image file attachments. */
  const [pendingFiles, setPendingFiles] = useState<ChatFile[]>([]);
  /**
   * Explicit right-panel browser open request (slash `/browser` only).
   * Intentionally NOT driven by browser engine state:
   * opening a browser in the bottom dock must not open/focus the right dock.
   */
  const [browserFocus, setBrowserFocus] = useState<{
    nonce: number;
    startUrl?: string;
  } | null>(null);
  /**
   * Follow-ups queued while a turn is running (TUI prompt-queue analogue).
   * Drained automatically when the session turn stops; "Send now" interjects.
   */
  const [promptQueue, setPromptQueue] = useState<QueuedPrompt[]>([]);
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const sideTaskIdsRef = useRef(sideTaskIds);
  sideTaskIdsRef.current = sideTaskIds;
  const promptQueueRef = useRef(promptQueue);
  promptQueueRef.current = promptQueue;
  /** Prevent concurrent drain of the same session. */
  const drainingRef = useRef<Set<string>>(new Set());
  /** Rapid sidebar clicks are last-click-wins; see `selectionIntent`. */
  const selectionRef = useRef(createSelectionIntent());

  /**
   * `/browser` slash: ask App to open the *right* split and focus its browser tab.
   * Chrome starts in that panel's BrowserPane with a right-* tab id.
   * Bottom-panel browsers are opened only via that panel's + menu (bottom-* ids).
   */
  async function openBrowser(url?: string) {
    setBrowserFocus({
      nonce: Date.now(),
      startUrl: url?.trim() || undefined,
    });
  }

  async function closeBrowser() {
    // Slash close: tear down all browser slots (right + bottom).
    if (window.grok?.browserClose) {
      await window.grok.browserClose();
    }
    setBrowserFocus(null);
  }

  function applySideTaskFlags(list: LocalSession[]): LocalSession[] {
    const ids = sideTaskIdsRef.current;
    return list.map((s) => ({
      ...s,
      isSideTask: !!s.isSideTask || ids.has(s.id),
    }));
  }

  const setSessionsWithSideTaskFlags = useCallback(
    (
      value:
        | LocalSession[]
        | ((prev: LocalSession[]) => LocalSession[]),
    ) => {
      setSessions((prev) => {
        const decoratedPrev = applySideTaskFlags(prev);
        const next =
          typeof value === "function" ? value(decoratedPrev) : value;
        return applySideTaskFlags(next);
      });
    },
    [],
  );

  async function toggleBrowser() {
    if (browserFocus) await closeBrowser();
    else await openBrowser();
  }

  function syncComposerFromState(st: ConnectionState) {
    if (st.status !== "ready") return;
    if (st.models) setModels(st.models);
    else if (st.modelId) {
      setModels((prev) => ({
        currentModelId: st.modelId ?? prev.currentModelId,
        currentReasoningEffort: prev.currentReasoningEffort,
        availableModels: prev.availableModels,
      }));
    }
    if (st.permissionMode) setPermissionMode(st.permissionMode);
  }

  // Keep chips in sync when connect/load return state without a separate event.
  useEffect(() => {
    syncComposerFromState(state);
    // Disconnect / errors: no live agent turns — clear sticky spinners.
    if (state.status !== "ready") {
      setSessions((prev) =>
        prev.some((s) => s.running)
          ? prev.map((s) => (s.running ? { ...s, running: false } : s))
          : prev,
      );
    }
  }, [state]);

  const active = useMemo(
    () => sessions.find((s) => s.id === activeId) ?? null,
    [sessions, activeId],
  );

  /** Composer busy only for the focused session — others may still be running. */
  const busy = !!active?.running;

  /**
   * Patch a session by id. Upserts when the row is missing so the first prompt
   * can paint title/messages even if `agent:session-loaded` has not landed yet
   * (IPC race with session/new invoke response).
   */
  const patchSession = useCallback(
    (
      id: string,
      fn: (s: LocalSession) => LocalSession,
      seed?: Partial<Pick<LocalSession, "cwd" | "isSideTask">>,
    ) => {
      setSessions((prev) => {
        const idx = prev.findIndex((s) => s.id === id);
        if (idx >= 0) {
          return prev.map((s) => (s.id === id ? fn(s) : s));
        }
        const base: LocalSession = {
          id,
          title: "",
          cwd: seed?.cwd || cwd || defaultCwd || "",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages: [],
          historyReady: true,
          isSideTask: seed?.isSideTask,
        };
        return [fn(base), ...prev];
      });
    },
    [cwd, defaultCwd],
  );

  useEffect(() => {
    return attachAgentSubscriptions({
      getActiveId: () => activeIdRef.current,
      setActiveId: (id) => {
        setActiveId(id);
        activeIdRef.current = id;
      },
      setState,
      setModels,
      setContextUsage: (usage) =>
        setContextUsage((prev) => ({ ...prev, [usage.sessionId]: usage })),
      setPermissionMode,
      setPermission,
      setSessions: setSessionsWithSideTaskFlags,
      setLoadingHistory,
      isSelectionCurrent: (id) => selectionRef.current.isCurrent(id),
      setDefaultCwd,
      setCwd,
      syncComposerFromState,
    }, t);
  }, [setSessionsWithSideTaskFlags, t]);

  async function refreshSessions() {
    if (!window.grok) return;
    const listed = await window.grok.listSessions();
    if (listed.ok && listed.sessions) {
      setSessionsWithSideTaskFlags((prev) =>
        mergeSessionList(
          prev,
          listed.sessions!,
          listed.runningSessionIds ?? [],
        ),
      );
    } else if (listed.error) {
      console.warn("[grok-gui] listSessions:", listed.error);
      if (listed.runningSessionIds) {
        const live = new Set(listed.runningSessionIds);
        setSessionsWithSideTaskFlags((prev) =>
          prev.map((s) => ({ ...s, running: live.has(s.id) })),
        );
      }
    }
  }

  /** Only on new-chat draft — started sessions hide the workspace picker entirely. */
  const canChangeWorkspace = !activeId && !loadingHistory;

  // Cache task workspace root once (path classification + create IPC).
  useEffect(() => {
    if (!window.grok?.getTaskWorkspaceRoot) return;
    void window.grok.getTaskWorkspaceRoot().then((root) => {
      if (root) setTaskWorkspaceRoot(root);
    });
  }, []);

  /** Folder the composer acts on: the focused session's, else the draft's. */
  const workspaceCwd = active?.cwd || cwd || (taskMode ? "" : defaultCwd);
  /**
   * Project folder actually chosen, "" when there is none. An auto-created
   * `Documents/GrokBuildGUI/<stamp>` workspace counts as none — the folder chip
   * hides those too, and the branch/worktree strip must agree with it.
   */
  const projectCwd =
    taskMode || isTaskWorkspaceCwd(workspaceCwd, taskWorkspaceRoot)
      ? ""
      : workspaceCwd;

  // Probe exactly the folder the workspace chip names, so the branch/worktree
  // strip can never disagree with it.
  const gitProbeCwd = projectCwd;
  useEffect(() => {
    if (!gitProbeCwd || !window.grok?.gitInfo) {
      setWorkspaceGit({ isRepo: false, branch: "" });
      return;
    }
    let cancelled = false;
    void window.grok.gitInfo(gitProbeCwd).then((info) => {
      if (!cancelled) setWorkspaceGit(info);
    });
    return () => {
      cancelled = true;
    };
  }, [gitProbeCwd]);

  // The opt-in belongs to the draft: a non-git folder can never honour it, and
  // once a session exists its directory is already decided.
  useEffect(() => {
    if (!worktreeEnabled && !worktreeBaseRef) return;
    if (!workspaceGit.isRepo || activeId) {
      setWorktreeEnabled(false);
      setWorktreeBaseRef("");
    }
  }, [workspaceGit.isRepo, worktreeEnabled, worktreeBaseRef, activeId]);

  // Creation is CoW-fast on APFS but can take seconds on a big/cold repo —
  // relay the agent's own progress line instead of a generic spinner.
  useEffect(() => {
    if (!window.grok?.onWorktreeStatus) return;
    return window.grok.onWorktreeStatus((event) => {
      if (event.status === "progress") {
        setWorktreeProgress(event.message || t("worktree.creating"));
      } else {
        setWorktreeProgress("");
      }
    });
  }, [t]);

  /** Adopt `dir` as the draft workspace and push it to the front of recents. */
  function selectProjectCwd(dir: string) {
    if (!canChangeWorkspace || !dir) return;
    setCwd(dir);
    setTaskMode(false);
    rememberRecentProject(dir);
    setStoredRecentProjects(loadRecentProjects());
    // New chats use this workspace; session list stays global (recent).
  }

  async function pickCwd() {
    if (!window.grok || !canChangeWorkspace) return;
    const dir = await window.grok.selectDirectory();
    if (dir) selectProjectCwd(dir);
  }

  function dropRecentProject(dir: string) {
    forgetRecentProject(dir);
    setStoredRecentProjects(loadRecentProjects());
  }

  /** Clear project folder on the new-chat draft → isolated task workspace mode. */
  function clearWorkspace() {
    if (!canChangeWorkspace) return;
    setCwd("");
    setTaskMode(true);
    setWorktreeEnabled(false);
    setWorktreeBaseRef("");
  }

  /** Flip the draft's worktree opt-in (ignored outside a git checkout). */
  function toggleWorktree(on: boolean) {
    if (!canChangeWorkspace) return;
    setWorktreeEnabled(on && workspaceGit.isRepo);
    if (!on) setWorktreeBaseRef("");
  }

  /**
   * Start the new chat from `branch`. Working on another branch without
   * touching the checkout is exactly what a worktree is for, so picking one
   * turns the opt-in on; going back to the current branch leaves it alone.
   */
  function selectWorktreeBranch(branch: string) {
    if (!canChangeWorkspace || !workspaceGit.isRepo) return;
    if (!branch || branch === workspaceGit.branch) {
      setWorktreeBaseRef("");
      return;
    }
    setWorktreeBaseRef(branch);
    setWorktreeEnabled(true);
  }

  /** Reconnect after a fault (startup already auto-connects). */
  async function connect() {
    if (!window.grok) return;
    // Task-mode draft has no project cwd yet — still need a bootstrap path for agent.
    const target =
      active?.cwd ||
      (taskModeRef.current ? defaultCwd : cwd || defaultCwd);
    if (!target) return;
    if (!taskModeRef.current) {
      setCwd(active?.cwd || cwd || target);
    }
    const result = await window.grok.connect(target);
    setState(result);
    if (result.status === "ready") {
      if (result.sessions && result.sessions.length > 0) {
        setSessionsWithSideTaskFlags(mergeSessionList([], result.sessions));
      } else {
        await refreshSessions();
      }
    }
  }

  /**
   * Prefer the focused session's cwd, else the most recently updated session.
   * A worktree session reports its project instead of the worktree itself —
   * isolation is opt-in per chat and must not leak into the next draft.
   */
  function lastUsedSessionCwd(): string {
    if (active?.cwd) return sessionProjectCwd(active);
    let best: LocalSession | null = null;
    for (const s of sessions) {
      if (!s.cwd) continue;
      if (!best) {
        best = s;
        continue;
      }
      const t = s.updatedAt ?? s.createdAt;
      const bt = best.updatedAt ?? best.createdAt;
      if (t > bt) best = s;
    }
    return (best ? sessionProjectCwd(best) : "") || cwd || defaultCwd;
  }

  /**
   * Enter draft "new chat" mode — pick workspace above the composer; session is created on first send.
   * When `workspaceCwd` is a path (e.g. from a project folder +), pin the draft to that workspace.
   * When `workspaceCwd` is `null`, force task mode (no project folder).
   * Permission mode always resets to Auto (does not inherit the previous session's chip).
   */
  async function handleNew(workspaceCwd?: string | null) {
    if (!window.grok) return;
    // Other sessions may keep running; only block while history is loading.
    if (loadingHistory) return;
    if (state.status !== "ready") {
      await connect();
      const st = await window.grok.getState();
      if (st.status !== "ready") return;
    }
    setInput("");
    // Worktree opt-in is per draft, never inherited by the next chat.
    setWorktreeEnabled(false);
    setWorktreeBaseRef("");
    setWorktreeProgress("");
    // A load still in flight must not drag focus back onto the draft.
    selectionRef.current.claimNone();
    setLoadingHistory(false);
    setActiveId(null);
    activeIdRef.current = null;

    if (workspaceCwd === null) {
      // Explicit task draft (Tasks section +).
      setCwd("");
      setTaskMode(true);
    } else if (workspaceCwd) {
      setCwd(workspaceCwd);
      setTaskMode(false);
    } else {
      // Inherit last workspace, but start a fresh task draft if last was a task.
      const last = lastUsedSessionCwd();
      if (taskWorkspaceRoot && isTaskWorkspaceCwd(last, taskWorkspaceRoot)) {
        setCwd("");
        setTaskMode(true);
      } else if (last) {
        setCwd(last);
        setTaskMode(false);
      } else {
        setCwd(defaultCwd);
        setTaskMode(false);
      }
    }
    // New chats always start on Auto, regardless of the previous session's mode.
    setPermissionMode("auto");
    if (window.grok.setPermissionMode) {
      void window.grok.setPermissionMode("auto").then((result) => {
        if (result.permissionMode) setPermissionMode(result.permissionMode);
      });
    }
  }

  async function createSideTaskSession(
    workspaceCwd?: string,
  ): Promise<string | null> {
    if (!window.grok) return null;
    if (loadingHistory) return null;
    const previousActiveId = activeIdRef.current;
    const previousCwd =
      sessionsRef.current.find((s) => s.id === previousActiveId)?.cwd ||
      cwd ||
      defaultCwd;
    if (state.status !== "ready") {
      await connect();
      const st = await window.grok.getState();
      if (st.status !== "ready") return null;
    }

    const workspace = workspaceCwd || lastUsedSessionCwd();
    const created = await window.grok.newSideTaskSession(
      workspace || defaultCwd,
    );
    setState(created);
    if (created.status !== "ready" || !created.sessionId) return null;

    const nextIds = markSideTask(sideTaskIdsRef.current, created.sessionId);
    setSideTaskIds(nextIds);
    sideTaskIdsRef.current = nextIds;
    if (previousActiveId) {
      setActiveId(previousActiveId);
      activeIdRef.current = previousActiveId;
      void window.grok.focusSession?.(previousActiveId, previousCwd);
    } else {
      setActiveId(null);
      activeIdRef.current = null;
    }
    setSessionsWithSideTaskFlags((prev) =>
      prev.map((s) =>
        s.id === created.sessionId
          ? {
              ...s,
              title: s.title === "New chat" ? "Side task" : s.title,
              isSideTask: true,
            }
          : s,
      ),
    );
    void refreshSessions();
    return created.sessionId;
  }

  async function closeSideTaskSession(sessionId: string) {
    if (!window.grok || !sessionId) return;
    setPromptQueue((prev) => prev.filter((q) => q.sessionId !== sessionId));
    promptQueueRef.current = promptQueueRef.current.filter(
      (q) => q.sessionId !== sessionId,
    );
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    if (activeIdRef.current === sessionId) {
      setActiveId(null);
      activeIdRef.current = null;
    }
    const deleted = await window.grok.deleteSession(sessionId);
    if (!deleted.ok) {
      // Keep the id marked so an undeleted scratch session cannot leak into
      // Projects/search on the next agent session-list update.
      console.warn("[grok-gui] close side task:", deleted.error);
      return;
    }
    const nextIds = unmarkSideTask(sideTaskIdsRef.current, sessionId);
    setSideTaskIds(nextIds);
    sideTaskIdsRef.current = nextIds;
    void refreshSessions();
  }

  async function submitSideTaskPrompt(
    sessionId: string,
    text: string,
    images: ChatImage[] = [],
    files: ChatFile[] = [],
  ) {
    const displayText = text.trim();
    if (
      (!displayText && images.length === 0 && files.length === 0) ||
      loadingHistory
    ) {
      return;
    }

    const browserCmd = displayText
      ? parseBrowserSlash(displayText)
      : { kind: "none" as const };
    if (browserCmd.kind === "close") {
      await closeBrowser();
      return;
    }
    let promptText = displayText;
    if (browserCmd.kind === "open") {
      await openBrowser(browserCmd.url);
      if (!browserCmd.agentText && images.length === 0 && files.length === 0) {
        return;
      }
      promptText = browserCmd.agentText || "";
    }

    const sessionRunning = !!sessionsRef.current.find(
      (s) => s.id === sessionId,
    )?.running;
    if (sessionRunning) {
      const entry: QueuedPrompt = {
        id: uid("q"),
        sessionId,
        text: promptText || displayText,
        images: cloneDraftImages(images),
        files: cloneDraftFiles(files),
        createdAt: Date.now(),
      };
      setPromptQueue((prev) => [...prev, entry]);
      return;
    }

    await dispatchPrompt({
      sessionId,
      promptText: promptText || displayText,
      displayText,
      images,
      files,
    });
  }

  /** Drop a session from local UI state after a successful agent delete. */
  function forgetSessionLocally(id: string) {
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (sideTaskIdsRef.current.has(id)) {
      const nextIds = unmarkSideTask(sideTaskIdsRef.current, id);
      setSideTaskIds(nextIds);
      sideTaskIdsRef.current = nextIds;
    }
    if (activeIdRef.current === id) {
      selectionRef.current.claimNone();
      setActiveId(null);
      activeIdRef.current = null;
      setInput("");
      setPendingImages([]);
      setLoadingHistory(false);
    }
  }

  async function handleDelete(id: string) {
    // Allow delete even while another session's history is loading — blocking
    // here left empty "Untitled session" rows stuck in the sidebar.
    if (!window.grok) return;
    const row = sessions.find((s) => s.id === id);
    const label =
      !row?.title || isPlaceholderSessionTitle(row.title)
        ? t("nav.untitledSession")
        : row.title;
    if (!window.confirm(t("nav.deleteSessionConfirm", { name: label }))) {
      return;
    }

    // The worktree outlives the session unless the user says otherwise —
    // it may still hold work that was never merged back.
    const worktree = row?.worktree;
    const removeWorktree =
      !!worktree &&
      window.confirm(t("worktree.removeBody", { path: worktree.path }));

    // If we're deleting the session currently loading, clear the lock so the
    // UI can recover even if history IPC arrives late.
    if (activeIdRef.current === id && loadingHistory) {
      setLoadingHistory(false);
    }

    const result = await window.grok.deleteSession(id);
    if (!result.ok) {
      console.error("[grok-gui] deleteSession failed:", result.error);
      window.alert(
        localizeUiError(result.error, t, "nav.deleteSessionFailed"),
      );
      return;
    }

    forgetSessionArtifacts(id);

    if (removeWorktree && worktree && window.grok.removeWorktree) {
      const removed = await window.grok.removeWorktree(worktree.path);
      if (!removed.ok) {
        console.error("[grok-gui] removeWorktree failed:", removed.error);
        window.alert(
          t("worktree.removeFailed", { error: removed.error ?? "" }),
        );
      }
    }

    forgetSessionLocally(id);
    const st = await window.grok.getState();
    setState(st);
    await refreshSessions();
  }

  /**
   * Delete every non-side-task session under a project cwd (sidebar folder).
   * Confirms once, then removes rows one by one via the agent delete path.
   */
  async function handleDeleteProject(cwd: string, projectName: string) {
    if (!window.grok) return;
    // Match the sidebar grouping: worktree chats belong to their source repo.
    const rows = sessions.filter(
      (s) => !s.isSideTask && sessionProjectCwd(s) === (cwd || ""),
    );
    if (rows.length === 0) return;
    if (
      !window.confirm(
        t("nav.deleteProjectConfirm", {
          name: projectName,
          count: rows.length,
        }),
      )
    ) {
      return;
    }

    if (
      activeIdRef.current &&
      rows.some((s) => s.id === activeIdRef.current) &&
      loadingHistory
    ) {
      setLoadingHistory(false);
    }

    const errors: string[] = [];
    for (const row of rows) {
      const result = await window.grok.deleteSession(row.id);
      if (result.ok) {
        forgetSessionLocally(row.id);
      } else {
        errors.push(result.error || row.id);
        console.error(
          "[grok-gui] deleteSession failed (project):",
          row.id,
          result.error,
        );
      }
    }

    if (errors.length > 0) {
      window.alert(
        localizeUiError(errors[0], t, "nav.deleteProjectFailed"),
      );
    }

    const st = await window.grok.getState();
    setState(st);
    await refreshSessions();
  }

  /**
   * Open a session by id. Optional `cwd` allows loading agent-search hits that
   * are not yet in the sidebar list.
   *
   * Clicks are never dropped, including while another history load is in
   * flight: the newest click claims the selection intent, and the superseded
   * load stops driving focus (see `selectionIntent`).
   */
  async function handleSelect(id: string, opts?: { cwd?: string }) {
    // Allow switching while other sessions run, and while history is loading.
    if (!window.grok) return;
    const selection = selectionRef.current;
    selection.claim(id);

    // Note: re-clicking the focused session is NOT special-cased here. That
    // shortcut read `activeId` from the render closure, so a click landing
    // before React re-rendered a previous switch saw a stale id, matched, and
    // returned early — stranding the spinner that switch had turned on. The
    // ready-session paths below handle it and always settle the spinner.
    const row = sessions.find((s) => s.id === id);
    const sessionCwd = row?.cwd || opts?.cwd || cwd || defaultCwd;
    // Nothing to open. This click still superseded any load in flight, whose
    // `history-end` will now be ignored — so settle the spinner here.
    if (!row && !sessionCwd) {
      setLoadingHistory(false);
      return;
    }

    // Selecting an existing session leaves new-chat task draft mode.
    setTaskMode(false);

    if (state.status !== "ready") {
      const result = await window.grok.connect(sessionCwd);
      if (!selection.isCurrent(id)) return;
      setState(result);
      if (result.status !== "ready") {
        // No load will start, so no `history-end` is coming.
        setLoadingHistory(false);
        return;
      }
      await refreshSessions();
      if (!selection.isCurrent(id)) return;
    }

    // Session from agent search may not be in the local sidebar list yet.
    if (!row) {
      setInput("");
      if (opts?.cwd) setCwd(opts.cwd);
      const result = await window.grok.loadSession(id, sessionCwd);
      // A newer click owns the UI now — its own load will set the state.
      if (!selection.isCurrent(id)) return;
      if (result.status !== "ready") setLoadingHistory(false);
      setState(result);
      void refreshSessions();
      return;
    }

    // Already have transcript in memory — switch UI focus and sync main process
    // so prompt/cancel target this session (not the previously loaded one).
    if (row.historyReady && (row.messages.length > 0 || row.running)) {
      focusLoadedSession(row);
      // Reconcile spinners from main-process truth (clears sticky running flags).
      void refreshSessions();
      return;
    }

    // Empty history-ready session (new chat with no messages yet).
    if (row.historyReady) {
      focusLoadedSession(row);
      void refreshSessions();
      return;
    }

    setInput("");
    if (row.cwd) setCwd(row.cwd);
    // Own the spinner and focus here rather than waiting for `history-start`:
    // re-clicking a session whose load is still replaying joins that load in
    // the main process, and a joined load emits no second `history-start`.
    setActiveId(id);
    activeIdRef.current = id;
    setLoadingHistory(true);
    const result = await window.grok.loadSession(
      id,
      row.cwd || cwd || defaultCwd,
    );
    if (!selection.isCurrent(id)) return;
    // `loadSession` can refuse before starting a load (e.g. not connected),
    // and then no `history-end` is coming to turn the spinner back off.
    if (result.status !== "ready") setLoadingHistory(false);
    setState(result);
    // A superseded load that errored clears the main-process focus; re-assert
    // ours so prompt/cancel keep targeting the session on screen.
    if (window.grok.focusSession) {
      void window.grok.focusSession(id, row.cwd || undefined);
    }
  }

  /**
   * Switch to a session whose transcript is already in memory — no IPC load,
   * so the view is ready immediately. Clearing `loadingHistory` matters: a
   * slower load the user just clicked past is now superseded and will never
   * send the `history-end` that would otherwise have cleared it.
   */
  function focusLoadedSession(row: LocalSession) {
    setActiveId(row.id);
    activeIdRef.current = row.id;
    setLoadingHistory(false);
    if (row.cwd) setCwd(row.cwd);
    patchSession(row.id, (s) => ({ ...s, unreadDone: false }));
    if (window.grok?.focusSession) {
      void window.grok.focusSession(row.id, row.cwd || undefined);
    }
  }

  async function handleCaptureScreenshot(
    mode: "region" | "screen" | "window",
    options?: { keepParentVisible?: boolean },
  ) {
    // Allow attach while busy so follow-ups can include screenshots.
    if (!window.grok?.captureScreenshot || loadingHistory) return;
    setScreenshotError(null);
    const result = await window.grok.captureScreenshot(mode, options);
    if (!result.ok) {
      console.warn("[grok-gui] captureScreenshot:", result.error);
      setScreenshotError(t("composer.captureFailed", { message: result.error }));
      return;
    }
    if (result.cancelled) return;
    const img = result.image;
    setPendingImages((prev) => [
      ...prev,
      {
        id: uid("img"),
        mimeType: img.mimeType,
        dataUrl: img.dataUrl,
        width: img.width,
        height: img.height,
        // Keep raw base64 for ACP prompt payload.
        data: img.data,
      } as ChatImage & { data: string },
    ]);
  }

  function handleCaptureRegion() {
    return handleCaptureScreenshot("region");
  }

  function removePendingImage(id: string) {
    setPendingImages((prev) => prev.filter((i) => i.id !== id));
  }

  function removePendingFile(id: string) {
    setPendingFiles((prev) => prev.filter((f) => f.id !== id));
  }

  async function handleAddFiles(fileList: File[]) {
    // Allow attach while busy — items ride along on the next queue entry.
    if (!fileList.length || loadingHistory) return;
    const prepared = await prepareFiles(fileList);
    if (prepared.errors.length > 0) {
      console.warn("[grok-gui] attach:", prepared.errors.join("; "));
    }
    if (prepared.images.length > 0) {
      setPendingImages((prev) => [...prev, ...prepared.images]);
    }
    if (prepared.files.length > 0) {
      setPendingFiles((prev) => [...prev, ...prepared.files]);
    }
  }

  function cloneDraftImages(images: ChatImage[]): ChatImage[] {
    return images.map((i) => ({ ...i }));
  }

  function cloneDraftFiles(files: ChatFile[]): ChatFile[] {
    return files.map((f) => ({ ...f }));
  }

  function toPromptImages(images: ChatImage[]) {
    return images
      .map((i) => {
        const data =
          (i as ChatImage & { data?: string }).data ||
          (i.dataUrl.startsWith("data:")
            ? i.dataUrl.replace(/^data:[^;]+;base64,/, "")
            : "");
        return data ? { data, mimeType: i.mimeType } : null;
      })
      .filter((x): x is { data: string; mimeType: string } => !!x);
  }

  function toPromptFiles(files: ChatFile[]) {
    return files.map((f) => ({
      name: f.name,
      mimeType: f.mimeType,
      uri: fileToResourceUri(f),
      text: f.text,
      data: f.data,
      size: f.size,
    }));
  }

  function shortTitleForPrompt(
    displayText: string,
    images: ChatImage[],
    files: ChatFile[],
  ): string {
    if (displayText.length > 0) {
      return displayText.length > 48
        ? `${displayText.slice(0, 48)}…`
        : displayText;
    }
    if (images.length > 0) return "Screenshot";
    if (files.length === 1) return files[0]!.name;
    return "Attachments";
  }

  function buildOptimisticTurnMessages(
    displayText: string,
    images: ChatImage[],
    files: ChatFile[],
  ): { userMsg: ChatMessage; assistantMsg: ChatMessage } {
    const userMsg: ChatMessage = {
      id: uid("u"),
      role: "user",
      text: displayText,
      images: images.map(({ id, mimeType, dataUrl, width, height, name }) => ({
        id,
        mimeType,
        dataUrl,
        width,
        height,
        name,
      })),
      files: files.map(({ id, name, mimeType, path, size }) => ({
        id,
        name,
        mimeType,
        path,
        size,
      })),
      createdAt: Date.now(),
    };
    const assistantMsg: ChatMessage = {
      id: uid("a"),
      role: "assistant",
      blocks: [],
      streaming: true,
      createdAt: Date.now(),
    };
    return { userMsg, assistantMsg };
  }

  /**
   * Actually start a turn (or fail). Used by idle submit and queue drain.
   * Does not clear the composer — caller owns draft state.
   *
   * `skipPaint`: first-send path already painted a provisional row + messages
   * (Codex-style); only the ACP prompt call remains.
   */
  async function dispatchPrompt(opts: {
    sessionId: string;
    promptText: string;
    displayText: string;
    images: ChatImage[];
    files: ChatFile[];
    skipPaint?: boolean;
  }) {
    if (!window.grok) return;
    const { sessionId, promptText, displayText, images, files, skipPaint } =
      opts;

    if (!skipPaint) {
      const shortTitle = shortTitleForPrompt(displayText, images, files);
      const { userMsg, assistantMsg } = buildOptimisticTurnMessages(
        displayText,
        images,
        files,
      );

      // Paint user bubble + sidebar title immediately (before the ACP round-trip).
      patchSession(sessionId, (s) => ({
        ...s,
        title:
          s.messages.length === 0 && isPlaceholderSessionTitle(s.title)
            ? shortTitle
            : s.title || shortTitle,
        updatedAt: Date.now(),
        messages: [...s.messages, userMsg, assistantMsg],
        historyReady: true,
        running: true,
        unreadDone: false,
      }));
    } else {
      patchSession(sessionId, (s) => ({
        ...s,
        running: true,
        unreadDone: false,
        updatedAt: Date.now(),
      }));
    }

    const promptImages = toPromptImages(images);
    const promptFiles = toPromptFiles(files);

    const result = await window.grok.prompt(
      promptText,
      promptImages.length > 0 ? promptImages : undefined,
      sessionId,
      promptFiles.length > 0 ? promptFiles : undefined,
    );

    if (!result.ok && result.error) {
      patchSession(sessionId, (s) => ({
        ...s,
        running: false,
        messages: [
          ...markAssistantDone(s.messages),
          {
            id: uid("sys"),
            role: "system",
            text: localizeUiError(
              result.error,
              t,
              "composer.promptFailed",
            ),
            createdAt: Date.now(),
          },
        ],
      }));
    }
  }

  /** After a turn ends, send the next queued follow-up for that session. */
  async function drainQueueForSession(sessionId: string) {
    if (drainingRef.current.has(sessionId)) return;
    const next = promptQueueRef.current.find((q) => q.sessionId === sessionId);
    if (!next) return;

    drainingRef.current.add(sessionId);
    try {
      // Brief yield so cancel/stop clears main-process runningTurns first.
      await new Promise((r) => setTimeout(r, 50));
      // Another drain may have taken this id, or user removed it.
      if (!promptQueueRef.current.some((q) => q.id === next.id)) return;
      setPromptQueue((prev) => prev.filter((q) => q.id !== next.id));
      promptQueueRef.current = promptQueueRef.current.filter(
        (q) => q.id !== next.id,
      );
      await dispatchPrompt({
        sessionId,
        promptText: next.text,
        displayText: next.text,
        images: next.images,
        files: next.files,
      });
    } finally {
      drainingRef.current.delete(sessionId);
    }
  }

  /**
   * "Send now" / 立即引导: interject into the running turn (TUI Send now).
   * Removes the item from the queue and paints a user bubble.
   */
  async function handleSendNow(queueId: string) {
    if (!window.grok) return;
    const item = promptQueueRef.current.find((q) => q.id === queueId);
    if (!item) return;

    const session = sessionsRef.current.find((s) => s.id === item.sessionId);
    const running = !!session?.running;

    setPromptQueue((prev) => prev.filter((q) => q.id !== queueId));
    promptQueueRef.current = promptQueueRef.current.filter(
      (q) => q.id !== queueId,
    );

    // Prefer mid-turn interject when a turn is live.
    if (running && window.grok.interject) {
      const result = await window.grok.interject(item.text, item.sessionId);
      if (result.ok) {
        const userMsg: ChatMessage = {
          id: uid("u"),
          role: "user",
          text: item.text,
          images: item.images.map(
            ({ id, mimeType, dataUrl, width, height, name }) => ({
              id,
              mimeType,
              dataUrl,
              width,
              height,
              name,
            }),
          ),
          files: item.files.map(({ id, name, mimeType, path, size }) => ({
            id,
            name,
            mimeType,
            path,
            size,
          })),
          createdAt: Date.now(),
        };
        patchSession(item.sessionId, (s) => ({
          ...s,
          messages: [...s.messages, userMsg],
        }));
        return;
      }
      console.warn(
        "[grok-gui] interject failed, falling back to cancel+prompt:",
        result.error,
      );
      // Fall through: cancel current turn then run as next prompt.
      void window.grok.cancel(item.sessionId);
      patchSession(item.sessionId, (s) =>
        s.running
          ? { ...s, running: false, messages: markAssistantDone(s.messages) }
          : s,
      );
    }

    await dispatchPrompt({
      sessionId: item.sessionId,
      promptText: item.text,
      displayText: item.text,
      images: item.images,
      files: item.files,
    });
  }

  function handleRemoveQueued(queueId: string) {
    setPromptQueue((prev) => prev.filter((q) => q.id !== queueId));
  }

  /** Optional `overrideText` is used for voice → STT submit (bypasses input state race). */
  async function handleSubmit(overrideText?: string) {
    const text = (overrideText ?? input).trim();
    const images = pendingImages;
    const files = pendingFiles;
    if (loadingHistory || !window.grok) return;

    const hasContent = !!(text || images.length > 0 || files.length > 0);

    // TUI: empty Enter while busy + queue non-empty → Send now (top item).
    if (!hasContent) {
      if (busy && activeIdRef.current) {
        const top = promptQueueRef.current.find(
          (q) => q.sessionId === activeIdRef.current,
        );
        if (top) {
          await handleSendNow(top.id);
        }
      }
      return;
    }

    // GUI-local `/browser` — open/close pane; optional remainder goes to agent.
    const browserCmd = text ? parseBrowserSlash(text) : { kind: "none" as const };
    if (browserCmd.kind === "close") {
      setInput("");
      await closeBrowser();
      return;
    }
    let promptText = text;
    if (browserCmd.kind === "open") {
      setInput("");
      await openBrowser(browserCmd.url);
      if (!browserCmd.agentText && images.length === 0 && files.length === 0) {
        // Pane-only: no agent turn.
        return;
      }
      promptText = browserCmd.agentText || "";
    }

    const computerCmd = text
      ? parseComputerSlash(text)
      : { kind: "none" as const };
    if (computerCmd.kind === "prompt") {
      promptText = computerCmd.agentText;
    }

    if (state.status !== "ready") {
      await connect();
      const st = await window.grok.getState();
      if (st.status !== "ready") return;
    }

    const displayText =
      browserCmd.kind === "open" || computerCmd.kind === "prompt"
        ? text
        : promptText;

    // Clear the composer immediately so the first-turn create/prompt path does
    // not feel frozen while session/new and model sync round-trip.
    setInput("");
    setPendingImages([]);
    setPendingFiles([]);

    // Codex-style first send: paint sidebar row + transcript *before* any
    // session/new IPC so the UI never waits on agent create.
    if (!activeIdRef.current) {
      const creatingTaskSession = taskModeRef.current;
      // Task drafts: park under the tasks root so the row groups correctly
      // before createTaskWorkspace returns the timestamped folder.
      const provisionalCwd = creatingTaskSession
        ? taskWorkspaceRoot || defaultCwd || ""
        : cwd || defaultCwd || "";
      const shortTitle = shortTitleForPrompt(
        displayText,
        images,
        files,
      );
      const { userMsg, assistantMsg } = buildOptimisticTurnMessages(
        displayText,
        images,
        files,
      );
      const provisionalId = makeProvisionalSessionId(uid("pending"));
      const now = Date.now();
      const provisional: LocalSession = {
        id: provisionalId,
        title: shortTitle,
        cwd: provisionalCwd,
        createdAt: now,
        updatedAt: now,
        messages: [userMsg, assistantMsg],
        historyReady: true,
        running: true,
        unreadDone: false,
      };

      setSessionsWithSideTaskFlags((prev) => [provisional, ...prev]);
      activeIdRef.current = provisionalId;
      setActiveId(provisionalId);
      // Hide workspace picker immediately (requires a focused session).
      if (creatingTaskSession) setTaskMode(false);

      let sessionCwd = provisionalCwd;
      if (creatingTaskSession) {
        if (!window.grok.createTaskWorkspace) {
          patchSession(provisionalId, (s) => ({
            ...s,
            running: false,
            messages: [
              ...markAssistantDone(s.messages),
              {
                id: uid("sys"),
                role: "system",
                text: t("composer.promptFailed"),
                createdAt: Date.now(),
              },
            ],
          }));
          return;
        }
        try {
          sessionCwd = await window.grok.createTaskWorkspace();
        } catch (err) {
          console.error("[grok-gui] createTaskWorkspace:", err);
          patchSession(provisionalId, (s) => ({
            ...s,
            running: false,
            messages: [
              ...markAssistantDone(s.messages),
              {
                id: uid("sys"),
                role: "system",
                text: localizeUiError(
                  err instanceof Error ? err.message : String(err),
                  t,
                  "composer.promptFailed",
                ),
                createdAt: Date.now(),
              },
            ],
          }));
          return;
        }
        if (!sessionCwd) return;
      }

      // Worktree creation happens inside newSession and can take a few
      // seconds; the draft row is already painted, so just narrate it.
      const worktreeOption =
        !creatingTaskSession && worktreeEnabledRef.current
          ? { gitRef: worktreeBaseRefRef.current || undefined }
          : null;
      if (worktreeOption) setWorktreeProgress(t("worktree.creating"));
      const created = await window.grok
        .newSession(sessionCwd, worktreeOption)
        .finally(() => setWorktreeProgress(""));
      setState(created);
      if (created.status !== "ready" || !created.sessionId) {
        const stillHere =
          activeIdRef.current === provisionalId ||
          isProvisionalSessionId(activeIdRef.current);
        if (stillHere) {
          patchSession(provisionalId, (s) => ({
            ...s,
            running: false,
            messages: [
              ...markAssistantDone(s.messages),
              {
                id: uid("sys"),
                role: "system",
                text:
                  created.status === "error"
                    ? localizeUiError(created.message, t, "composer.promptFailed")
                    : t("composer.promptFailed"),
                createdAt: Date.now(),
              },
            ],
          }));
        }
        return;
      }

      const realId = created.sessionId;
      // With a worktree the agent runs somewhere else than the picked folder;
      // the session's real cwd comes back on the ready state.
      const realCwd = created.cwd || sessionCwd;
      // session-loaded may already have remapped the provisional row.
      setSessionsWithSideTaskFlags((prev) =>
        adoptProvisionalSession(prev, provisionalId, realId, realCwd),
      );
      // Only steal focus back if the user is still on this first-send row.
      if (
        activeIdRef.current === provisionalId ||
        activeIdRef.current === realId ||
        isProvisionalSessionId(activeIdRef.current)
      ) {
        activeIdRef.current = realId;
        setActiveId(realId);
        setCwd(realCwd);
      }

      await dispatchPrompt({
        sessionId: realId,
        promptText: promptText || displayText,
        displayText,
        images,
        files,
        skipPaint: true,
      });
      return;
    }

    const targetId = activeIdRef.current;
    if (!targetId) return;

    // Turn running → enqueue follow-up (TUI plain Enter while busy).
    const sessionRunning =
      sessionsRef.current.find((s) => s.id === targetId)?.running ?? busy;
    if (sessionRunning) {
      const entry: QueuedPrompt = {
        id: uid("q"),
        sessionId: targetId,
        text: promptText || displayText,
        images: cloneDraftImages(images),
        files: cloneDraftFiles(files),
        createdAt: Date.now(),
      };
      setPromptQueue((prev) => [...prev, entry]);
      return;
    }

    await dispatchPrompt({
      sessionId: targetId,
      promptText: promptText || displayText,
      displayText,
      images,
      files,
    });
  }

  function handleCancel() {
    const id = activeIdRef.current;
    if (!id || !window.grok) return;
    cancelSession(id);
  }

  function cancelSession(id: string) {
    if (!id || !window.grok) return;
    // Optimistic clear — main also emits agent:turn stopped immediately.
    patchSession(id, (s) =>
      s.running
        ? { ...s, running: false, messages: markAssistantDone(s.messages) }
        : s,
    );
    void window.grok.cancel(id);
    // Do not clear the queue on cancel — remaining items drain after stop.
  }

  /**
   * "Rewind to here": copy a sent message back into the composer so it can be
   * tweaked and sent again. Transcript, session, and agent state are untouched.
   */
  function handleRewindToMessage(messageId: string) {
    const session = sessionsRef.current.find(
      (s) => s.id === activeIdRef.current,
    );
    const target = session?.messages.find(
      (m): m is Extract<ChatMessage, { role: "user" }> =>
        m.role === "user" && m.id === messageId,
    );
    if (!target?.text) return;
    setInput(target.text);
  }

  // When any session turn ends, drain its local follow-up queue.
  useEffect(() => {
    if (!window.grok?.onTurn) return;
    return window.grok.onTurn((ev) => {
      if (!ev.sessionId) return;
      if (ev.status === "started") return;
      // Defer so session `running` is cleared by agentSubscriptions first.
      window.setTimeout(() => {
        void drainQueueForSession(ev.sessionId);
      }, 0);
    });
  }, []);

  function handlePermission(requestId: string, optionId: string | null) {
    void window.grok?.respondPermission(requestId, optionId);
    setPermission(null);
  }

  async function handlePermissionModeChange(mode: PermissionMode) {
    setPermissionMode(mode);
    if (!window.grok?.setPermissionMode) return;
    const result = await window.grok.setPermissionMode(mode);
    if (result.permissionMode) setPermissionMode(result.permissionMode);
    if (!result.ok && result.error) {
      console.warn("[grok-gui] setPermissionMode:", result.error);
    }
  }

  async function handleModelChange(
    modelId: string,
    reasoningEffort?: string | null,
  ) {
    setModels((prev) => ({
      ...prev,
      currentModelId: modelId,
      currentReasoningEffort:
        reasoningEffort === undefined
          ? prev.currentReasoningEffort
          : reasoningEffort,
    }));
    if (!window.grok?.setModel) return;
    const result = await window.grok.setModel(modelId, reasoningEffort);
    if (result.models) setModels(result.models);
    if (!result.ok && result.error) {
      console.warn("[grok-gui] setModel:", result.error);
    }
  }

  /** Draft task mode has no folder yet; avoid falling back to process defaultCwd. */
  /** Quick-pick history for the draft workspace picker. */
  const recentProjects = useMemo(
    () =>
      mergeRecentProjects(storedRecentProjects, sessions, {
        exclude: taskMode ? "" : workspaceCwd,
        taskRoot: taskWorkspaceRoot,
      }),
    [storedRecentProjects, sessions, taskMode, workspaceCwd, taskWorkspaceRoot],
  );
  const sideTasks = useMemo(
    () => sessions.filter((s) => s.isSideTask),
    [sessions],
  );
  const sessionTitle = active
    ? active.isSideTask &&
      (active.title === "Side task" ||
        isPlaceholderSessionTitle(active.title))
      ? t("tools.sideTask")
      : isPlaceholderSessionTitle(active.title)
        ? t("nav.untitledSession")
        : active.title
    : null;
  const connectionFault =
    state.status === "error"
      ? state.message
      : state.status === "disconnected"
        ? t("main.connectionIssue")
        : null;

  return {
    state,
    sessions,
    sideTasks,
    activeId,
    active,
    input,
    setInput,
    loadingHistory,
    permission,
    models,
    /** Context-window usage of the focused session (null before its first turn). */
    contextUsage: activeId ? (contextUsage[activeId] ?? null) : null,
    /** Same, keyed by session id — for panes that render their own composer. */
    contextUsageBySession: contextUsage,
    permissionMode,
    pendingImages,
    screenshotError,
    pendingFiles,
    /** Slash/topbar: open right-panel browser once per nonce. Not "any browser open". */
    browserFocus,
    /** Follow-ups for the focused session (TUI queue pane). */
    promptQueue: promptQueue.filter(
      (q) => !activeId || q.sessionId === activeId,
    ),
    sideTaskPromptQueue: promptQueue.filter((q) =>
      sideTaskIds.has(q.sessionId),
    ),
    busy,
    canChangeWorkspace,
    workspaceCwd,
    /** New-chat draft without a project folder (isolated task workspace). */
    taskMode,
    /** New-chat draft that will run in an isolated git worktree (null = off). */
    worktreeEnabled,
    toggleWorktree,
    /** Branch the draft starts from ("" = the workspace's current branch). */
    worktreeBaseRef,
    selectWorktreeBranch,
    /** Repo + branch of the workspace behind the composer's branch chip. */
    workspaceGit,
    /** Chosen project folder, "" when the draft has none (task workspace). */
    projectCwd,
    /** Non-empty while a worktree is being created for the first send. */
    worktreeProgress,
    /** Root used to bucket sessions into the sidebar Tasks group. */
    taskWorkspaceRoot,
    sessionTitle,
    connectionFault,
    handleNew,
    createSideTaskSession,
    closeSideTaskSession,
    submitSideTaskPrompt,
    handleDelete,
    handleDeleteProject,
    handleSelect,
    handleCaptureRegion,
    handleCaptureScreenshot,
    handleAddFiles,
    removePendingImage,
    removePendingFile,
    handleSubmit,
    handleCancel,
    cancelSession,
    handleRewindToMessage,
    handleSendNow,
    handleRemoveQueued,
    handlePermission,
    handlePermissionModeChange,
    handleModelChange,
    openBrowser,
    closeBrowser,
    toggleBrowser,
    pickCwd,
    /** Draft workspace picker: recent folders + select / forget one. */
    recentProjects,
    selectProjectCwd,
    dropRecentProject,
    clearWorkspace,
    connect,
  };
}
