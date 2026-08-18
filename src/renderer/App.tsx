import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  GrokAccount,
  GrokAuthActionResult,
} from "../electron/preload";
import { LoginScreen } from "./components/auth/LoginScreen";
import { SignInReminderModal } from "./components/auth/SignInReminderModal";
import { ChatView } from "./components/chat";
import type { ChatSearchFocus } from "./components/chat/ChatView";
import type { OpenFileViewRequest } from "./components/chat/FileChangeBar";
import { Composer } from "./components/composer";
import { MainPanel } from "./components/layout/MainPanel";
import { SidebarResizer } from "./components/layout/SidebarResizer";
import { WindowTitleBar } from "./components/layout/WindowTitleBar";
import {
  loadSidebarCollapsed,
  loadSidebarWidth,
  saveSidebarCollapsed,
} from "./components/layout/sidebarWidth";
import { PermissionModal } from "./components/PermissionModal";
import { PluginsPanel } from "./components/plugins";
import { SettingsDialog, type SettingsSection } from "./components/settings";
import {
  SplitPanel,
  type SplitFocusRequest,
} from "./components/split-panel";
import { Sidebar } from "./components/sidebar";
import type { ChatSearchHit } from "./lib/chatSearch";
import { selectedModelNeedsGrokLogin } from "./lib/modelAuth";
import { useAppUpdate } from "./hooks/useAppUpdate";
import { useGrokApp } from "./hooks/useGrokApp";
import { useGrokAuth } from "./hooks/useGrokAuth";
import {
  loadGuiSettings,
  saveGuiSettings,
  subscribeGuiSettings,
  type GuiSettings,
} from "./lib/guiSettings";
import { detectHostPlatform } from "./lib/platform";
import { resolveUiLanguage } from "./lib/uiLanguage";

/** Settings is a modal, not a view — it must not tear down chat / terminals. */
type MainView = "chat" | "plugins";
type PendingGuestSend = () => void | Promise<void>;

export function App() {
  const [guiSettings, setGuiSettings] = useState<GuiSettings>(loadGuiSettings);
  const [, setSystemLanguageRevision] = useState(0);
  const language = resolveUiLanguage(guiSettings.uiLanguage);
  const { i18n } = useTranslation();

  useEffect(() => {
    if (i18n.resolvedLanguage !== language) {
      void i18n.changeLanguage(language);
    }
    document.documentElement.lang = language;
  }, [i18n, language]);

  useEffect(() => {
    if (guiSettings.uiLanguage !== "system") return;
    const onLanguageChange = () => setSystemLanguageRevision((value) => value + 1);
    window.addEventListener("languagechange", onLanguageChange);
    return () => window.removeEventListener("languagechange", onLanguageChange);
  }, [guiSettings.uiLanguage]);

  // Keep in sync when other panes write settings (e.g. side-task exit Markdown).
  useEffect(() => subscribeGuiSettings(setGuiSettings), []);

  function updateGuiSettings(next: GuiSettings) {
    setGuiSettings(next);
    saveGuiSettings(next);
  }

  return (
    <AuthenticatedApp
      guiSettings={guiSettings}
      onGuiSettingsChange={updateGuiSettings}
    />
  );
}

function AuthenticatedApp({
  guiSettings,
  onGuiSettingsChange,
}: {
  guiSettings: GuiSettings;
  onGuiSettingsChange: (next: GuiSettings) => void;
}) {
  const auth = useGrokAuth();

  if (auth.loading || (!auth.account?.loggedIn && !auth.skippedLogin)) {
    return (
      <LoginScreen
        loading={auth.loading}
        signingIn={auth.signingIn}
        error={auth.error}
        onLogin={() => void auth.login()}
        onSkip={auth.skipLogin}
        onCancel={() => void auth.cancelLogin()}
      />
    );
  }

  return (
    <WorkspaceApp
      account={auth.account!}
      onLogin={auth.login}
      onLogout={auth.logout}
      guiSettings={guiSettings}
      onGuiSettingsChange={onGuiSettingsChange}
    />
  );
}

type WorkspaceAppProps = {
  account: GrokAccount;
  onLogin: () => Promise<GrokAuthActionResult>;
  onLogout: () => Promise<GrokAuthActionResult>;
  guiSettings: GuiSettings;
  onGuiSettingsChange: (next: GuiSettings) => void;
};

function WorkspaceApp({
  account,
  onLogin,
  onLogout,
  guiSettings,
  onGuiSettingsChange,
}: WorkspaceAppProps) {
  const { t } = useTranslation();
  const app = useGrokApp();
  const update = useAppUpdate();
  const [mainView, setMainView] = useState<MainView>("chat");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] =
    useState<SettingsSection>("interface");
  /** Bump after plugin changes so composer reloads slash skills. */
  const [slashRefreshKey, setSlashRefreshKey] = useState(0);
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(loadSidebarCollapsed);
  /** After search modal pick: scroll + highlight this message. */
  const [chatSearchFocus, setChatSearchFocus] =
    useState<ChatSearchFocus | null>(null);
  const [pendingGuestSend, setPendingGuestSend] =
    useState<PendingGuestSend | null>(null);
  const [guestLoginError, setGuestLoginError] = useState<string | null>(null);
  const [guestLoginPending, setGuestLoginPending] = useState(false);

  function setSidebarCollapsedPersist(next: boolean) {
    setSidebarCollapsed(next);
    saveSidebarCollapsed(next);
  }

  function openSettings(section: SettingsSection = "interface") {
    setSettingsSection(section);
    setSettingsOpen(true);
  }

  function sendWithGuestReminder(action: PendingGuestSend) {
    if (account.loggedIn || !selectedModelNeedsGrokLogin(app.models)) {
      void action();
      return;
    }
    setGuestLoginError(null);
    setPendingGuestSend(() => action);
  }

  async function loginAndContinueGuestSend() {
    const action = pendingGuestSend;
    setGuestLoginPending(true);
    setGuestLoginError(null);
    try {
      const result = await onLogin();
      if (!result.ok || !result.account.loggedIn) {
        setGuestLoginError(result.error || t("auth.signInFailed"));
        return;
      }
      setPendingGuestSend(null);
      if (action) await action();
    } finally {
      setGuestLoginPending(false);
    }
  }

  const [rightOpen, setRightOpen] = useState(false);
  const [rightMounted, setRightMounted] = useState(false);
  const [rightFocus, setRightFocus] = useState<SplitFocusRequest | null>(null);
  /** Right panel has a tool tab (file / browser / …) — enable maximize. */
  const [rightHasContent, setRightHasContent] = useState(false);
  /** Bumped on session switch — see `leaveSession`. */
  const [closeFileViewsKey, setCloseFileViewsKey] = useState(0);
  /** Codex: right panel fills upper row; chat column hidden. */
  const [rightMaximized, setRightMaximized] = useState(false);

  const [bottomOpen, setBottomOpen] = useState(false);
  /** Keep dock mounted after first open so tabs/sessions survive collapse. */
  const [bottomMounted, setBottomMounted] = useState(false);

  function goChat() {
    setMainView("chat");
  }

  /**
   * Leaving a session invalidates its open file views — they render a snapshot
   * of that transcript's tool output. Bumped here rather than watched inside
   * the panel so a provisional id turning real is not mistaken for a switch.
   */
  function leaveSession() {
    goChat();
    setCloseFileViewsKey((n) => n + 1);
  }

  function handleNew(cwd?: string | null) {
    leaveSession();
    void app.handleNew(cwd);
  }

  function handleSelect(id: string) {
    leaveSession();
    void app.handleSelect(id);
  }

  function handleSearchHit(hit: ChatSearchHit) {
    leaveSession();
    // Leave maximized-right so the chat column is visible for the jump.
    setRightMaximized(false);
    void app.handleSelect(hit.sessionId, { cwd: hit.cwd || undefined });
    // Jump + highlight for local message hits and agent content (resolve id after load).
    if (
      hit.query.trim() &&
      (hit.kind === "message" || hit.kind === "content")
    ) {
      setChatSearchFocus({
        messageId: hit.messageId ?? "",
        query: hit.query,
        nonce: Date.now(),
      });
    } else {
      setChatSearchFocus(null);
    }
  }

  // Escape dismisses in-chat search jump highlight (keyword mark + message outline).
  useEffect(() => {
    if (!chatSearchFocus) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setChatSearchFocus(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chatSearchFocus]);

  function toggleRightPanel() {
    if (rightOpen) {
      setRightOpen(false);
      setRightMaximized(false);
      return;
    }
    setRightMounted(true);
    setRightOpen(true);
  }

  function toggleRightMaximize() {
    setRightMaximized((v) => !v);
  }

  function toggleBottomTerminal() {
    if (bottomOpen) {
      setBottomOpen(false);
      return;
    }
    setBottomMounted(true);
    setBottomOpen(true);
  }

  // Slash `/browser` only — open the *right* dock's browser tab.
  // Bottom-panel browsers must never set this (they use their own tab ids).
  useEffect(() => {
    if (!app.browserFocus) return;
    setRightMounted(true);
    setRightOpen(true);
    setRightFocus({
      tool: "browser",
      nonce: app.browserFocus.nonce,
      startUrl: app.browserFocus.startUrl,
      placement: "right",
    });
  }, [app.browserFocus]);

  // Browser MCP: create/focus the same visible right-side browser the agent controls.
  useEffect(() => {
    if (!window.grok?.onBrowserOpenRequest) return;
    return window.grok.onBrowserOpenRequest((request) => {
      setMainView("chat");
      setRightMounted(true);
      setRightOpen(true);
      setRightFocus({
        tool: "browser",
        nonce: request.nonce,
        startUrl: request.startUrl,
        placement: "right",
      });
    });
  }, []);

  /** Chat file chip / tool path → right split fileview (diff or content). */
  function handleOpenFile(req: OpenFileViewRequest) {
    setRightMounted(true);
    setRightOpen(true);
    setRightFocus({
      tool: "fileview",
      nonce: Date.now(),
      placement: "right",
      fileView: {
        path: req.path,
        root: req.root,
        mode: req.mode,
        oldText: req.oldText,
        newText: req.newText,
      },
    });
  }

  const pluginsActive = mainView === "plugins";
  /** Full-page main views replace chat + hide split docks (Codex-style). */
  // Settings is a separate modal child window, so it never locks this chrome.
  const chromeLocked = pluginsActive;
  /** Windows-only custom title bar; macOS keeps traffic lights + brand chrome. */
  const winCustomChrome = detectHostPlatform() === "win32";

  const workspace = (
    <div
      className={
        sidebarCollapsed ? "app app-sidebar-collapsed" : "app"
      }
      style={{
        ["--sidebar-w" as string]: sidebarCollapsed
          ? "0px"
          : `${sidebarWidth}px`,
      }}
    >
      {!sidebarCollapsed ? (
        <>
          <Sidebar
            sessions={app.sessions}
            sideTasks={app.sideTasks}
            taskWorkspaceRoot={app.taskWorkspaceRoot}
            activeId={chromeLocked ? null : app.activeId}
            state={app.state}
            loadingHistory={app.loadingHistory}
            onNew={handleNew}
            onSelect={handleSelect}
            onRename={(id, title) => void app.handleRename(id, title)}
            onDelete={(id) => void app.handleDelete(id)}
            onDeleteProject={(cwd, name) =>
              void app.handleDeleteProject(cwd, name)
            }
            onRetryConnect={() => void app.connect()}
            pluginsActive={pluginsActive}
            onOpenPlugins={() => setMainView("plugins")}
            onOpenSettings={() => openSettings()}
            grokAccount={account}
            onLogin={onLogin}
            onLogout={onLogout}
            update={update}
            /* Windows: collapse lives in the custom title bar only. */
            onCollapse={
              winCustomChrome
                ? undefined
                : () => setSidebarCollapsedPersist(true)
            }
            onSearchHit={handleSearchHit}
          />
          <SidebarResizer
            width={sidebarWidth}
            onWidthChange={setSidebarWidth}
          />
        </>
      ) : null}

      <MainPanel
        sessionTitle={pluginsActive ? t("main.plugins") : app.sessionTitle}
        worktree={pluginsActive ? null : app.active?.worktree}
        loadingHistory={chromeLocked ? false : app.loadingHistory}
        connectionFault={chromeLocked ? null : app.connectionFault}
        sidebarCollapsed={sidebarCollapsed}
        onExpandSidebar={
          /* Windows expand is on the custom title bar. */
          !winCustomChrome && sidebarCollapsed
            ? () => setSidebarCollapsedPersist(false)
            : undefined
        }
        bottomTerminalOpen={chromeLocked ? false : bottomOpen}
        onToggleBottomTerminal={
          chromeLocked ? undefined : toggleBottomTerminal
        }
        rightPanelOpen={chromeLocked ? false : rightOpen}
        onToggleRightPanel={chromeLocked ? undefined : toggleRightPanel}
        rightMaximizeVisible={
          !chromeLocked && rightOpen && rightHasContent
        }
        rightMaximized={!chromeLocked && rightMaximized}
        onToggleRightMaximize={
          chromeLocked ? undefined : toggleRightMaximize
        }
        messageDisplayMode={
          chromeLocked ? undefined : guiSettings.messageDisplayMode
        }
        onMessageDisplayModeChange={
          chromeLocked
            ? undefined
            : (mode) =>
                onGuiSettingsChange({
                  ...guiSettings,
                  messageDisplayMode: mode,
                })
        }
      >
        {pluginsActive ? (
          <PluginsPanel
            onBack={goChat}
            onPluginsChanged={() => setSlashRefreshKey((n) => n + 1)}
          />
        ) : (
          <div
            className={
              bottomOpen ? "main-body main-body-with-bottom" : "main-body"
            }
          >
            {/* Left/right split only on the upper pane; bottom spans full width. */}
            <div
              className={
                rightOpen
                  ? rightMaximized
                    ? "main-body-upper main-body-split main-body-right-max"
                    : "main-body-upper main-body-split"
                  : "main-body-upper"
              }
            >
              <div
                className={
                  rightMaximized
                    ? "main-chat-col main-chat-col-hidden"
                    : "main-chat-col"
                }
                aria-hidden={rightMaximized ? true : undefined}
              >
                <ChatView
                  messages={app.active?.messages ?? []}
                  loading={app.loadingHistory}
                  onOpenFile={handleOpenFile}
                  workspaceRoot={app.workspaceCwd}
                  searchFocus={chatSearchFocus}
                  onRewindToMessage={app.handleRewindToMessage}
                  messageDisplayMode={guiSettings.messageDisplayMode}
                  onExitMarkdownView={() =>
                    onGuiSettingsChange({
                      ...guiSettings,
                      messageDisplayMode: "rendered",
                    })
                  }
                  emptyHint={
                    app.loadingHistory
                      ? t("main.loadingHistory")
                      : app.connectionFault
                        ? app.connectionFault
                        : !app.activeId
                          ? app.taskMode
                            ? t("main.startTask")
                            : t("main.chooseWorkspace")
                          : app.sessions.length > 0
                            ? t("main.selectSession")
                            : t("main.startChat")
                  }
                />

                <Composer
                  value={app.input}
                  onChange={app.setInput}
                  onSubmit={(text) =>
                    sendWithGuestReminder(() => app.handleSubmit(text))
                  }
                  onCancel={app.handleCancel}
                  disabled={
                    app.state.status === "connecting" ||
                    app.loadingHistory ||
                    app.state.status === "error" ||
                    app.state.status === "disconnected"
                  }
                  busy={app.busy}
                  promptQueue={app.promptQueue}
                  onSendNowQueued={(id) => void app.handleSendNow(id)}
                  onRemoveQueued={app.handleRemoveQueued}
                  pendingImages={app.pendingImages}
                  pendingFiles={app.pendingFiles}
                  onRemoveImage={app.removePendingImage}
                  onRemoveFile={app.removePendingFile}
                  onAddFiles={(files) => void app.handleAddFiles(files)}
                  onCaptureScreenshot={(mode, options) =>
                    void app.handleCaptureScreenshot(mode, options)
                  }
                  screenshotError={app.screenshotError}
                  permissionMode={app.permissionMode}
                  onPermissionModeChange={(mode) =>
                    void app.handlePermissionModeChange(mode)
                  }
                  models={app.models}
                  onModelChange={(id, effort) =>
                    void app.handleModelChange(id, effort)
                  }
                  onConfigureModels={() => openSettings("providers")}
                  contextUsage={app.contextUsage}
                  slashCwd={app.workspaceCwd}
                  slashRefreshKey={slashRefreshKey}
                  voiceSttLanguage={guiSettings.voiceSttLanguage}
                  workspace={
                    !app.activeId
                      ? {
                          // Hide ephemeral task paths from the chip (never show
                          // Documents/GrokBuildGUI/<timestamp> on draft).
                          cwd: app.taskMode ? "" : app.workspaceCwd,
                          canChange: app.canChangeWorkspace,
                          recents: app.recentProjects,
                          onSelectRecent: (dir) => app.selectProjectCwd(dir),
                          onForgetRecent: (dir) => app.dropRecentProject(dir),
                          isTaskMode: app.taskMode,
                          onPick: () => void app.pickCwd(),
                          onClear: () => app.clearWorkspace(),
                        }
                      : undefined
                  }
                  worktree={
                    !app.activeId && app.canChangeWorkspace && !!app.projectCwd
                      ? {
                          isRepo: app.workspaceGit.isRepo,
                          branch: app.workspaceGit.branch,
                          cwd: app.projectCwd,
                          baseRef: app.worktreeBaseRef,
                          enabled: app.worktreeEnabled,
                          onToggle: app.toggleWorktree,
                          onSelectBranch: app.selectWorktreeBranch,
                        }
                      : undefined
                  }
                  worktreeProgress={app.worktreeProgress}
                />
              </div>

              {rightMounted || rightOpen ? (
                <SplitPanel
                  placement="right"
                  open={rightOpen && !chromeLocked}
                  onCollapse={() => {
                    setRightOpen(false);
                    setRightMaximized(false);
                  }}
                  entry="home"
                  focusTool={rightFocus}
                  closeFileViewsKey={closeFileViewsKey}
                  workspaceRoot={app.workspaceCwd}
                  maximized={rightMaximized && rightOpen && !chromeLocked}
                  onHasContentChange={(has) => {
                    setRightHasContent(has);
                    if (!has) setRightMaximized(false);
                  }}
                  onCreateSideTask={() => app.createSideTaskSession()}
                  sideTaskEnabled={!!app.activeId}
                  onCloseSideTask={(sessionId) =>
                    void app.closeSideTaskSession(sessionId)
                  }
                  sideTaskSessions={app.sideTasks}
                  sideTaskDisabled={
                    app.state.status === "connecting" ||
                    app.state.status === "error" ||
                    app.state.status === "disconnected"
                  }
                  onSubmitSideTask={(sessionId, text, images, files) =>
                    sendWithGuestReminder(() =>
                      app.submitSideTaskPrompt(sessionId, text, images, files),
                    )
                  }
                  onCancelSideTask={(sessionId) =>
                    void app.cancelSession(sessionId)
                  }
                  sideTaskPromptQueue={app.sideTaskPromptQueue}
                  onSendNowSideTask={app.handleSendNow}
                  onRemoveQueuedSideTask={app.handleRemoveQueued}
                  models={app.models}
                  permissionMode={app.permissionMode}
                  onPermissionModeChange={(mode) =>
                    void app.handlePermissionModeChange(mode)
                  }
                  onModelChange={(id, effort) =>
                    void app.handleModelChange(id, effort)
                  }
                  onConfigureModels={() => openSettings("providers")}
                  slashRefreshKey={slashRefreshKey}
                  voiceSttLanguage={guiSettings.voiceSttLanguage}
                  onOpenFile={handleOpenFile}
                />
              ) : null}
            </div>

            {bottomMounted || bottomOpen ? (
              <SplitPanel
                placement="bottom"
                open={bottomOpen && !chromeLocked}
                onCollapse={() => setBottomOpen(false)}
                entry="terminal"
                closeFileViewsKey={closeFileViewsKey}
                workspaceRoot={app.workspaceCwd}
                onCreateSideTask={() => app.createSideTaskSession()}
                sideTaskEnabled={!!app.activeId}
                onCloseSideTask={(sessionId) =>
                  void app.closeSideTaskSession(sessionId)
                }
                sideTaskSessions={app.sideTasks}
                sideTaskDisabled={
                  app.state.status === "connecting" ||
                  app.state.status === "error" ||
                  app.state.status === "disconnected"
                }
                onSubmitSideTask={(sessionId, text, images, files) =>
                  sendWithGuestReminder(() =>
                    app.submitSideTaskPrompt(sessionId, text, images, files),
                  )
                }
                onCancelSideTask={(sessionId) =>
                  void app.cancelSession(sessionId)
                }
                sideTaskPromptQueue={app.sideTaskPromptQueue}
                onSendNowSideTask={app.handleSendNow}
                onRemoveQueuedSideTask={app.handleRemoveQueued}
                models={app.models}
                permissionMode={app.permissionMode}
                onPermissionModeChange={(mode) =>
                  void app.handlePermissionModeChange(mode)
                }
                onModelChange={(id, effort) =>
                  void app.handleModelChange(id, effort)
                }
                onConfigureModels={() => openSettings("providers")}
                slashRefreshKey={slashRefreshKey}
                voiceSttLanguage={guiSettings.voiceSttLanguage}
                onOpenFile={handleOpenFile}
              />
            ) : null}
          </div>
        )}
      </MainPanel>

      <SettingsDialog
        open={settingsOpen}
        initialSection={settingsSection}
        settings={guiSettings}
        onChange={onGuiSettingsChange}
        onClose={() => setSettingsOpen(false)}
        update={update}
      />

      <PermissionModal
        request={app.permission}
        onRespond={app.handlePermission}
      />

      <SignInReminderModal
        open={pendingGuestSend !== null}
        signingIn={guestLoginPending}
        error={guestLoginError}
        onCancel={() => {
          setPendingGuestSend(null);
          setGuestLoginError(null);
        }}
        onLogin={() => void loginAndContinueGuestSend()}
      />
    </div>
  );

  /* Windows: title bar is a sibling of .app so overflow:hidden cannot clip it
   * and -webkit-app-region drag hit-tests reliably. */
  if (winCustomChrome) {
    return (
      <div className="app-shell">
        <WindowTitleBar
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() =>
            setSidebarCollapsedPersist(!sidebarCollapsed)
          }
        />
        {workspace}
      </div>
    );
  }

  return workspace;
}
