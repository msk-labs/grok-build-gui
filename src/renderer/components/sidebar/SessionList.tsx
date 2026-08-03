import {
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { ConnectionState } from "../../../electron/preload";
import type { LocalSession } from "../../types/chat";
import type { SessionGroup } from "./groupSessions";
import { getGroupSessionVisibility, sessionTime } from "./groupSessions";
import { SectionChevronIcon, SquarePenIcon } from "./icons";
import { ProjectGroupHeader } from "./ProjectGroupHeader";
import { SessionItem } from "./SessionItem";
import { useTranslation } from "react-i18next";

/** Keys in the shared collapsed map for top-level sidebar sections. */
export const SECTION_PROJECTS_KEY = "__section:projects";
export const SECTION_TASKS_KEY = "__section:tasks";

/** Menu id prefix for project-folder ⋯ menus (distinct from session ids). */
export function projectMenuId(cwd: string): string {
  return `project:${cwd}`;
}

export function isProjectMenuId(menuId: string | null): menuId is string {
  return !!menuId && menuId.startsWith("project:");
}

export function cwdFromProjectMenuId(menuId: string): string {
  return menuId.slice("project:".length);
}

type Props = {
  /** Project sessions only (not task workspaces, not side tasks). */
  sessions: LocalSession[];
  groups: SessionGroup[];
  /** Flat task sessions under Documents/GrokBuildGUI. */
  taskSessions?: LocalSession[];
  activeId: string | null;
  state: ConnectionState;
  fault: string | null;
  collapsed: Record<string, boolean>;
  menuId: string | null;
  /** Project cwd currently being renamed (inline input). */
  renamingCwd: string | null;
  disabled: boolean;
  loadingHistory?: boolean;
  onToggleGroup: (cwd: string) => void;
  /** Pin draft to a project cwd, or `null` for a fresh task draft. */
  onNew: (cwd?: string | null) => void;
  onSelect: (id: string) => void;
  onOpenMenu: (e: ReactMouseEvent, id: string) => void;
  onDelete: (e: ReactMouseEvent, id: string) => void;
  onRenameProject: (cwd: string) => void;
  onRenameProjectCommit: (cwd: string, nextName: string) => void;
  onRenameProjectCancel: () => void;
  onRevealProjectInFolder: (cwd: string) => void;
  onDeleteProject: (e: ReactMouseEvent, cwd: string, name: string) => void;
};

/**
 * Codex-style list body:
 *   Projects  (collapsible section)
 *     📁 project folder  (⋯ rename / delete, + new chat)
 *       session / thread rows
 *   Tasks  (collapsible section)
 *     flat session rows (isolated default workspaces)
 */
export function SessionList({
  sessions,
  groups,
  taskSessions = [],
  activeId,
  state,
  fault,
  collapsed,
  menuId,
  renamingCwd,
  disabled,
  loadingHistory,
  onToggleGroup,
  onNew,
  onSelect,
  onOpenMenu,
  onDelete,
  onRenameProject,
  onRenameProjectCommit,
  onRenameProjectCancel,
  onRevealProjectInFolder,
  onDeleteProject,
}: Props) {
  const { t } = useTranslation();
  /** cwd → true when the user expanded past the per-project session preview. */
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(
    {},
  );
  const sortedTasks = [...taskSessions].sort(
    (a, b) => sessionTime(b) - sessionTime(a),
  );
  const hasAny = sessions.length > 0 || sortedTasks.length > 0;
  const newDisabled =
    loadingHistory || !!fault || state.status === "connecting";

  // undefined / false = expanded (default)
  const projectsOpen = !collapsed[SECTION_PROJECTS_KEY];
  const tasksOpen = !collapsed[SECTION_TASKS_KEY];

  function toggleGroupSessions(cwd: string) {
    setExpandedGroups((prev) => ({ ...prev, [cwd]: !prev[cwd] }));
  }

  return (
    <div className="session-list">
      <div className="sidebar-section">
        <button
          type="button"
          className="sidebar-section-toggle"
          onClick={() => onToggleGroup(SECTION_PROJECTS_KEY)}
          aria-expanded={projectsOpen}
        >
          <span className="sidebar-section-label-text">{t("nav.projects")}</span>
          <span
            className={`sidebar-section-chevron${projectsOpen ? " open" : ""}`}
          >
            <SectionChevronIcon />
          </span>
        </button>

        {projectsOpen ? (
          !hasAny ? (
            <div className="session-empty">
              {state.status === "connecting"
                ? t("nav.connecting")
                : fault
                  ? t("nav.connectionUnavailable")
                  : t("nav.noProjects")}
            </div>
          ) : sessions.length === 0 ? (
            <div className="session-empty">{t("nav.noProjects")}</div>
          ) : (
            groups.map((group) => {
              const open = !collapsed[group.cwd];
              const menuKey = projectMenuId(group.cwd);
              const sessionsExpanded = !!expandedGroups[group.cwd];
              const { visible, canToggle, hiddenCount } =
                getGroupSessionVisibility(group.sessions, {
                  expanded: sessionsExpanded,
                  activeId,
                });
              return (
                <div key={group.cwd || "__empty__"} className="session-group">
                  <ProjectGroupHeader
                    cwd={group.cwd}
                    name={group.name}
                    open={open}
                    menuOpen={menuId === menuKey}
                    renaming={renamingCwd === group.cwd}
                    newDisabled={newDisabled}
                    disabled={disabled}
                    onToggle={() => onToggleGroup(group.cwd)}
                    onNew={() => onNew(group.cwd || undefined)}
                    onOpenMenu={(e) => onOpenMenu(e, menuKey)}
                    onRename={() => onRenameProject(group.cwd)}
                    onRenameCommit={(next) =>
                      onRenameProjectCommit(group.cwd, next)
                    }
                    onRenameCancel={onRenameProjectCancel}
                    onRevealInFolder={() =>
                      onRevealProjectInFolder(group.cwd)
                    }
                    onDelete={(e) =>
                      onDeleteProject(e, group.cwd, group.name)
                    }
                  />
                  {open ? (
                    <>
                      {visible.map((s) => (
                        <SessionItem
                          key={s.id}
                          session={s}
                          active={s.id === activeId}
                          menuOpen={menuId === s.id}
                          disabled={disabled}
                          onSelect={onSelect}
                          onOpenMenu={onOpenMenu}
                          onDelete={onDelete}
                        />
                      ))}
                      {canToggle ? (
                        <button
                          type="button"
                          className="session-group-show-more"
                          aria-expanded={sessionsExpanded}
                          onClick={() => toggleGroupSessions(group.cwd)}
                        >
                          {sessionsExpanded
                            ? t("nav.showLessSessions")
                            : hiddenCount > 0
                              ? t("nav.showMoreSessionsCount", {
                                  count: hiddenCount,
                                })
                              : t("nav.showMoreSessions")}
                        </button>
                      ) : null}
                    </>
                  ) : null}
                </div>
              );
            })
          )
        ) : null}
      </div>

      {sortedTasks.length > 0 ? (
        <div className="sidebar-section">
          <div className="sidebar-section-header-row">
            <button
              type="button"
              className="sidebar-section-toggle"
              onClick={() => onToggleGroup(SECTION_TASKS_KEY)}
              aria-expanded={tasksOpen}
            >
              <span className="sidebar-section-label-text">
                {t("nav.tasks")}
              </span>
              <span
                className={`sidebar-section-chevron${tasksOpen ? " open" : ""}`}
              >
                <SectionChevronIcon />
              </span>
            </button>
            <button
              type="button"
              className="session-group-new session-section-new"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onNew(null);
              }}
              disabled={newDisabled}
              title={t("nav.newTask")}
              aria-label={t("nav.newTask")}
            >
              <SquarePenIcon />
            </button>
          </div>
          {tasksOpen ? (
            <div className="session-task-list">
              {sortedTasks.map((s) => (
                <SessionItem
                  key={s.id}
                  session={s}
                  active={s.id === activeId}
                  menuOpen={menuId === s.id}
                  disabled={disabled}
                  onSelect={onSelect}
                  onOpenMenu={onOpenMenu}
                  onDelete={onDelete}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
