import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type {
  ConnectionState,
  GrokAccount,
  GrokAuthActionResult,
} from "../../../electron/preload";
import type { LocalSession } from "../../types/chat";
import type { AppUpdate } from "../../hooks/useAppUpdate";
import type { ChatSearchHit } from "../../lib/chatSearch";
import { useTranslation } from "react-i18next";
import { isTaskWorkspaceCwd } from "../../lib/taskWorkspace";
import { AccountFooter } from "./AccountFooter";
import {
  loadCollapsedFolders,
  saveCollapsedFolders,
} from "./collapsedFolders";
import { folderName, groupSessions } from "./groupSessions";
import {
  PanelLeftIcon,
  PuzzleIcon,
  SearchIcon,
  SquarePenIcon,
} from "./icons";
import { loadProjectNames, saveProjectNames } from "./projectNames";
import { SessionList } from "./SessionList";
import { SessionSearchModal } from "./SessionSearchModal";

export type SidebarProps = {
  sessions: LocalSession[];
  sideTasks?: LocalSession[];
  /** ~/Documents/GrokBuildGUI — sessions under this path list as Tasks. */
  taskWorkspaceRoot?: string;
  activeId: string | null;
  state: ConnectionState;
  loadingHistory?: boolean;
  /** Start a new chat; path pins project draft, `null` forces task draft. */
  onNew: (cwd?: string | null) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  /** Delete all sessions under a project folder (cwd). */
  onDeleteProject: (cwd: string, projectName: string) => void;
  /** Only used when connection failed — re-try auto connect. */
  onRetryConnect: () => void;
  /** Plugins main-view is active (Codex-style nav tab). */
  pluginsActive?: boolean;
  /** Switch main content to the plugins manager. */
  onOpenPlugins?: () => void;
  /** Switch main content to Settings (from account menu). */
  onOpenSettings?: () => void;
  grokAccount: GrokAccount;
  onLogin: () => Promise<GrokAuthActionResult>;
  onLogout: () => Promise<GrokAuthActionResult>;
  /** App update state for the footer button. */
  update: AppUpdate;
  /** Collapse the session sidebar to a thin rail. */
  onCollapse?: () => void;
  /**
   * Codex-style global search: open a hit (session + optional message).
   * Parent loads the session, scrolls, and highlights.
   */
  onSearchHit?: (hit: ChatSearchHit) => void;
};

export function Sidebar({
  sessions,
  sideTasks = [],
  taskWorkspaceRoot = "",
  activeId,
  state,
  loadingHistory,
  onNew,
  onSelect,
  onDelete,
  onDeleteProject,
  onRetryConnect,
  pluginsActive,
  onOpenPlugins,
  onOpenSettings,
  grokAccount,
  onLogin,
  onLogout,
  update,
  onCollapse,
  onSearchHit,
}: SidebarProps) {
  const { t } = useTranslation();
  const fault =
    state.status === "error" || state.status === "disconnected"
      ? state.status === "error"
        ? state.message || t("nav.cannotConnect")
        : t("nav.notConnected")
      : null;

  const mainSessions = useMemo(
    () => sessions.filter((s) => !s.isSideTask),
    [sessions],
  );
  const taskSessions = useMemo(
    () =>
      mainSessions.filter((s) =>
        isTaskWorkspaceCwd(s.cwd, taskWorkspaceRoot),
      ),
    [mainSessions, taskWorkspaceRoot],
  );
  const projectSessions = useMemo(
    () =>
      mainSessions.filter(
        (s) => !isTaskWorkspaceCwd(s.cwd, taskWorkspaceRoot),
      ),
    [mainSessions, taskWorkspaceRoot],
  );
  const [projectNames, setProjectNames] = useState<Record<string, string>>(
    loadProjectNames,
  );
  const groups = useMemo(() => {
    const base = groupSessions(projectSessions);
    return base.map((g) => {
      const custom = projectNames[g.cwd]?.trim();
      return custom ? { ...g, name: custom } : g;
    });
  }, [projectSessions, projectNames]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(
    loadCollapsedFolders,
  );
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renamingCwd, setRenamingCwd] = useState<string | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);

  function openSearch() {
    setSearchOpen(true);
    setAccountMenuOpen(false);
    setMenuId(null);
    setRenamingCwd(null);
  }

  useEffect(() => {
    if (!menuId && !accountMenuOpen) return;
    function onDocDown(e: MouseEvent) {
      const target = e.target as Node;
      const el = target as Element;
      // Let ⋯ buttons own open/close via their click handlers.
      if (el.closest?.(".session-item-menu")) return;
      if (el.closest?.(".session-group-more")) return;
      if (el.closest?.(".session-item-more")) return;
      if (el.closest?.(".session-group-rename")) return;
      if (accountMenuRef.current?.contains(target)) return;
      setMenuId(null);
      setAccountMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenuId(null);
        setAccountMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuId, accountMenuOpen]);

  // ⌘K / Ctrl+K opens chat search (Codex-style). ⌘F only when not typing.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (searchOpen) return;
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key !== "k" && key !== "f") return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (
        key === "f" &&
        (tag === "INPUT" ||
          tag === "TEXTAREA" ||
          el?.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      openSearch();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [searchOpen]);

  function toggleGroup(cwd: string) {
    setCollapsed((prev) => {
      const next = { ...prev, [cwd]: !prev[cwd] };
      saveCollapsedFolders(next);
      return next;
    });
  }

  function openMenu(e: ReactMouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    setAccountMenuOpen(false);
    setRenamingCwd(null);
    setMenuId((cur) => (cur === id ? null : id));
  }

  function handleDelete(e: ReactMouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    setMenuId(null);
    onDelete(id);
  }

  function handleRenameProject(cwd: string) {
    setMenuId(null);
    setRenamingCwd(cwd);
  }

  function handleRenameProjectCommit(cwd: string, nextName: string) {
    setRenamingCwd(null);
    const trimmed = nextName.trim();
    const defaultName = folderName(cwd);
    setProjectNames((prev) => {
      const next = { ...prev };
      if (!trimmed || trimmed === defaultName) {
        delete next[cwd];
      } else {
        next[cwd] = trimmed;
      }
      saveProjectNames(next);
      return next;
    });
  }

  function handleRenameProjectCancel() {
    setRenamingCwd(null);
  }

  function handleDeleteProject(
    e: ReactMouseEvent,
    cwd: string,
    name: string,
  ) {
    e.preventDefault();
    e.stopPropagation();
    setMenuId(null);
    onDeleteProject(cwd, name);
  }

  /** Open the project folder with the OS file manager (Finder / Explorer). */
  function handleRevealProjectInFolder(cwd: string) {
    setMenuId(null);
    if (!cwd || !window.grok?.openWith) return;
    void window.grok.openWith({ root: cwd, path: ".", appPath: "" });
  }

  // History load only blocks selecting rows — keep ⋯ / Delete usable so empty
  // "Untitled session" rows can still be removed mid-load.
  const disabled = !!fault;

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-brand-chrome">
          {onCollapse ? (
            <button
              type="button"
              className="sidebar-collapse-btn"
              onClick={onCollapse}
              title={t("nav.collapseSidebar")}
              aria-label={t("nav.collapseSidebar")}
            >
              <PanelLeftIcon />
            </button>
          ) : (
            <span className="sidebar-brand-spacer" aria-hidden />
          )}
        </div>
        <div className="brand-title-row">
          <div className="brand-title">Grok Build GUI</div>
          <button
            type="button"
            className={
              searchOpen
                ? "sidebar-search-btn sidebar-search-btn-active"
                : "sidebar-search-btn"
            }
            onClick={openSearch}
            title={t("nav.searchChatsShortcut")}
            aria-label={t("nav.searchChats")}
            aria-pressed={searchOpen}
          >
            <SearchIcon />
          </button>
        </div>
      </div>

      <div className="sidebar-nav">
        <button
          type="button"
          className="sidebar-nav-btn"
          onClick={() => onNew()}
          disabled={loadingHistory || !!fault || state.status === "connecting"}
        >
          <SquarePenIcon />
          <span>{t("nav.newChat")}</span>
        </button>
        {onOpenPlugins ? (
          <button
            type="button"
            className={`sidebar-nav-btn sidebar-plugins-btn${pluginsActive ? " active" : ""}`}
            onClick={onOpenPlugins}
            title={t("nav.managePlugins")}
            aria-current={pluginsActive ? "page" : undefined}
          >
            <PuzzleIcon />
            <span>{t("nav.plugins")}</span>
          </button>
        ) : null}
      </div>

      <SessionList
        sessions={projectSessions}
        groups={groups}
        taskSessions={taskSessions}
        activeId={activeId}
        state={state}
        fault={fault}
        collapsed={collapsed}
        menuId={menuId}
        renamingCwd={renamingCwd}
        disabled={disabled}
        loadingHistory={loadingHistory}
        onToggleGroup={toggleGroup}
        onNew={onNew}
        onSelect={onSelect}
        onOpenMenu={openMenu}
        onDelete={handleDelete}
        onRenameProject={handleRenameProject}
        onRenameProjectCommit={handleRenameProjectCommit}
        onRenameProjectCancel={handleRenameProjectCancel}
        onRevealProjectInFolder={handleRevealProjectInFolder}
        onDeleteProject={handleDeleteProject}
      />

      <AccountFooter
        state={state}
        fault={fault}
        onRetryConnect={onRetryConnect}
        menuOpen={accountMenuOpen}
        accountMenuRef={accountMenuRef}
        onOpenChange={(open) => {
          setMenuId(null);
          setAccountMenuOpen(open);
        }}
        onOpenSettings={onOpenSettings}
        account={grokAccount}
        onLogin={onLogin}
        onLogout={onLogout}
        update={update}
      />

      <SessionSearchModal
        open={searchOpen}
        sessions={mainSessions}
        excludedSessionIds={sideTasks.map((s) => s.id)}
        onClose={() => setSearchOpen(false)}
        onSelectHit={(hit) => {
          setSearchOpen(false);
          if (onSearchHit) onSearchHit(hit);
          else onSelect(hit.sessionId);
        }}
      />
    </aside>
  );
}
