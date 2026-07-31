import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MessageDisplayMode } from "../../lib/guiSettings";
import type { SessionWorktree } from "../../types/chat";

type Props = {
  sessionTitle: string | null;
  /** Set when the focused chat runs in an isolated git worktree. */
  worktree?: SessionWorktree | null;
  loadingHistory: boolean;
  connectionFault: string | null;
  /** Replace the session title with a back control for full-page views. */
  onBack?: () => void;
  /**
   * When the session sidebar is collapsed, show the expand control here
   * (next to macOS traffic lights) and inset the bar for the lights.
   */
  sidebarCollapsed?: boolean;
  onExpandSidebar?: () => void;
  /** Bottom terminal dock (chat column split). */
  bottomTerminalOpen?: boolean;
  onToggleBottomTerminal?: () => void;
  /** Right-side panel open state. */
  rightPanelOpen?: boolean;
  /** Toggle right split panel. */
  onToggleRightPanel?: () => void;
  /**
   * Codex-style maximize: hide chat, expand right panel.
   * Only shown when the right panel has real content (file / browser / …).
   */
  rightMaximizeVisible?: boolean;
  rightMaximized?: boolean;
  onToggleRightMaximize?: () => void;
  /** How assistant markdown is shown in the active chat. */
  messageDisplayMode?: MessageDisplayMode;
  onMessageDisplayModeChange?: (mode: MessageDisplayMode) => void;
};

/** Lucide PanelLeft — expand collapsed session sidebar. */
function PanelLeftIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
    </svg>
  );
}

/** Lucide ChevronLeft — return from a full-page view. */
function ChevronLeftIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

/** Lucide PanelBottom — toggle the bottom terminal dock. */
function PanelBottomIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M3 15h18" />
    </svg>
  );
}

/** Lucide PanelRight — toggle the right split panel. */
function PanelRightIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M15 3v18" />
    </svg>
  );
}

/** Lucide Maximize2 — expand right panel over chat. */
function MaximizeIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" x2="14" y1="3" y2="10" />
      <line x1="3" x2="10" y1="21" y2="14" />
    </svg>
  );
}

/** Lucide Minimize2 — restore split (chat + right panel). */
function MinimizeIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="4 14 10 14 10 20" />
      <polyline points="20 10 14 10 14 4" />
      <line x1="14" x2="21" y1="10" y2="3" />
      <line x1="3" x2="10" y1="21" y2="14" />
    </svg>
  );
}

function SessionTitleMenu({
  messageDisplayMode,
  onMessageDisplayModeChange,
}: {
  messageDisplayMode: MessageDisplayMode;
  onMessageDisplayModeChange: (mode: MessageDisplayMode) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      const el = rootRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Already viewing source — exit via the floating chat pill, not this menu.
  if (messageDisplayMode === "raw") return null;

  return (
    <div
      className={`topbar-session-menu${open ? " is-open" : ""}`}
      ref={rootRef}
    >
      <button
        type="button"
        className="topbar-session-more"
        aria-label={t("main.sessionMenu")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        ···
      </button>
      {open ? (
        <div className="topbar-session-dropdown" role="menu">
          <button
            type="button"
            className="topbar-session-menu-item"
            role="menuitem"
            onClick={() => {
              onMessageDisplayModeChange("raw");
              setOpen(false);
            }}
          >
            {t("main.showMarkdown")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function Topbar({
  sessionTitle,
  worktree,
  loadingHistory,
  connectionFault,
  onBack,
  sidebarCollapsed,
  onExpandSidebar,
  bottomTerminalOpen,
  onToggleBottomTerminal,
  rightPanelOpen,
  onToggleRightPanel,
  rightMaximizeVisible,
  rightMaximized,
  onToggleRightMaximize,
  messageDisplayMode = "rendered",
  onMessageDisplayModeChange,
}: Props) {
  const { t } = useTranslation();
  const showActions =
    onToggleBottomTerminal ||
    onToggleRightPanel ||
    (rightMaximizeVisible && onToggleRightMaximize);
  const showExpand = Boolean(sidebarCollapsed && onExpandSidebar);
  const showSessionMenu = Boolean(
    !onBack && sessionTitle && onMessageDisplayModeChange,
  );

  return (
    <header
      className={
        showExpand ? "topbar topbar-sidebar-collapsed" : "topbar"
      }
    >
      {showExpand ? (
        <button
          type="button"
          className="sidebar-collapse-btn topbar-sidebar-toggle"
          onClick={onExpandSidebar}
          title={t("nav.expandSidebar")}
          aria-label={t("nav.expandSidebar")}
        >
          <PanelLeftIcon />
        </button>
      ) : null}
      <div className="topbar-title-block">
        {onBack ? (
          <button
            type="button"
            className="topbar-back-btn"
            onClick={onBack}
            title={t("common.back")}
            aria-label={t("common.back")}
          >
            <ChevronLeftIcon />
          </button>
        ) : sessionTitle ? (
          <div className="topbar-title-row">
            <h1 className="session-title" title={sessionTitle}>
              {sessionTitle}
            </h1>
            {worktree ? (
              <span
                className="topbar-worktree-chip"
                title={t("worktree.badge", {
                  label: worktree.label || worktree.path,
                })}
              >
                {worktree.label || worktree.path}
              </span>
            ) : null}
            {showSessionMenu ? (
              <SessionTitleMenu
                messageDisplayMode={messageDisplayMode}
                onMessageDisplayModeChange={onMessageDisplayModeChange!}
              />
            ) : null}
          </div>
        ) : (
          <h1 className="session-title muted">
            {loadingHistory
              ? t("common.loading")
              : connectionFault
                ? t("main.connectionIssue")
                : t("nav.newChat")}
          </h1>
        )}
      </div>
      {showActions ? (
        <div className="topbar-actions">
          {rightMaximizeVisible && onToggleRightMaximize ? (
            <button
              type="button"
              className={
                rightMaximized
                  ? "topbar-panel-btn topbar-panel-btn-active"
                  : "topbar-panel-btn"
              }
              onClick={onToggleRightMaximize}
              title={
                rightMaximized
                  ? t("main.restoreChat")
                  : t("main.maximizeRight")
              }
              aria-label={
                rightMaximized
                  ? t("main.restoreChat")
                  : t("main.maximizeRight")
              }
              aria-pressed={rightMaximized ? true : false}
            >
              {rightMaximized ? <MinimizeIcon /> : <MaximizeIcon />}
            </button>
          ) : null}
          {onToggleBottomTerminal ? (
            <button
              type="button"
              className={
                bottomTerminalOpen
                  ? "topbar-panel-btn topbar-panel-btn-active"
                  : "topbar-panel-btn"
              }
              onClick={onToggleBottomTerminal}
              title={
                bottomTerminalOpen
                  ? t("main.hideBottom")
                  : t("main.showBottom")
              }
              aria-label={
                bottomTerminalOpen
                  ? t("main.hideBottom")
                  : t("main.showBottom")
              }
              aria-pressed={bottomTerminalOpen ? true : false}
            >
              <PanelBottomIcon />
            </button>
          ) : null}
          {onToggleRightPanel ? (
            <button
              type="button"
              className={
                rightPanelOpen
                  ? "topbar-panel-btn topbar-panel-btn-active"
                  : "topbar-panel-btn"
              }
              onClick={onToggleRightPanel}
              title={
                rightPanelOpen ? t("main.hideRight") : t("main.showRight")
              }
              aria-label={
                rightPanelOpen ? t("main.hideRight") : t("main.showRight")
              }
              aria-pressed={rightPanelOpen ? true : false}
            >
              <PanelRightIcon />
            </button>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
