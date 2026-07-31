import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { isTaskWorkspaceCwd } from "../../lib/taskWorkspace";
import type { RecentProject } from "../../lib/recentProjects";
import { folderName } from "./permissionOptions";
import { CloseIcon, WorkspaceIcon } from "./icons";
import { useTranslation } from "react-i18next";

export type WorkspaceProps = {
  /** Absolute path of the workspace (cwd). Empty in task mode before first send. */
  cwd: string;
  /** True only before a session is created/selected — then cwd is locked. */
  canChange: boolean;
  /**
   * Draft with no project folder — isolated task workspace will be created
   * under Documents/GrokBuildGUI on first send.
   */
  isTaskMode?: boolean;
  onPick: () => void;
  /** Clear project folder → task mode (only when canChange). */
  onClear?: () => void;
  /** Previously used folders, newest first. Empty keeps the plain browse click. */
  recents?: readonly RecentProject[];
  /** Adopt a folder straight from the history (no OS dialog). */
  onSelectRecent?: (cwd: string) => void;
  /** Drop a folder from the history (e.g. it no longer exists). */
  onForgetRecent?: (cwd: string) => void;
};

export function WorkspacePicker({
  workspace,
  disabled,
}: {
  workspace: WorkspaceProps;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  /** Folders that failed their existence probe — shown as gone, then dropped. */
  const [missing, setMissing] = useState<readonly string[]>([]);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Never surface auto-created Documents/GrokBuildGUI/<timestamp> paths.
  const isEphemeralTaskPath = isTaskWorkspaceCwd(workspace.cwd);
  const inTaskMode =
    !!workspace.isTaskMode || !workspace.cwd || isEphemeralTaskPath;
  const canClear =
    workspace.canChange &&
    !!workspace.onClear &&
    !inTaskMode &&
    !!workspace.cwd;
  const recents = workspace.recents ?? [];
  const hasRecents = recents.length > 0 && !!workspace.onSelectRecent;

  useEffect(() => {
    if (!menuOpen) return;
    function onDocDown(e: MouseEvent) {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const wsLabel = inTaskMode
    ? t("workspace.selectFolder")
    : folderName(workspace.cwd);
  const wsTitle = inTaskMode ? t("workspace.taskModeHint") : workspace.cwd;

  function handleClear(e: ReactMouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    workspace.onClear?.();
  }

  function browse() {
    setMenuOpen(false);
    // Defer so the menu unmounts before the OS dialog steals focus.
    window.setTimeout(() => workspace.onPick(), 0);
  }

  /**
   * A remembered folder can be renamed or deleted between runs. Probe it
   * before adopting so the draft never points at a path that is gone.
   */
  async function selectRecent(cwd: string) {
    const probe = await window.grok?.listDir({ root: cwd });
    if (probe && !probe.ok) {
      setMissing((prev) => (prev.includes(cwd) ? prev : [...prev, cwd]));
      workspace.onForgetRecent?.(cwd);
      return;
    }
    setMenuOpen(false);
    workspace.onSelectRecent?.(cwd);
  }

  if (!workspace.canChange) {
    return (
      <div className="workspace-picker">
        <div
          className="workspace-picker-locked"
          title={
            wsTitle ? `${wsTitle}\n${t("workspace.lockedHint")}` : undefined
          }
        >
          <WorkspaceIcon />
          <span className="workspace-picker-name">{wsLabel}</span>
          <span className="workspace-picker-lock">{t("workspace.locked")}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="workspace-picker" ref={wrapRef}>
      <div className="workspace-picker-wrap">
        <button
          type="button"
          className={`workspace-picker-btn${inTaskMode ? " is-task-mode" : ""}${
            canClear ? " has-clear" : ""
          }${menuOpen ? " open" : ""}`}
          onClick={() => (hasRecents ? setMenuOpen((v) => !v) : browse())}
          disabled={disabled}
          aria-haspopup={hasRecents ? "menu" : undefined}
          aria-expanded={hasRecents ? menuOpen : undefined}
          title={
            inTaskMode
              ? t("workspace.choose")
              : `${wsTitle}\n${t("workspace.clickChange")}`
          }
        >
          {/*
            Leading slot is always the folder icon position.
            On hover (when a project is selected), the X appears here instead.
          */}
          <span className="workspace-picker-leading" aria-hidden={!canClear}>
            <span className="workspace-picker-folder-icon">
              <WorkspaceIcon />
            </span>
            {canClear ? (
              <span
                className="workspace-picker-clear"
                role="button"
                tabIndex={disabled ? -1 : 0}
                title={t("workspace.clear")}
                aria-label={t("workspace.clear")}
                onClick={handleClear}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    workspace.onClear?.();
                  }
                }}
              >
                <CloseIcon />
              </span>
            ) : null}
          </span>
          <span className="workspace-picker-name">{wsLabel}</span>
          {!inTaskMode ? (
            <span className="workspace-picker-action">
              {t("common.change")}
            </span>
          ) : null}
        </button>

        {hasRecents && menuOpen ? (
          <div className="composer-menu workspace-picker-menu" role="menu">
            <div className="workspace-picker-menu-label">
              {t("workspace.recent")}
            </div>
            {recents.map((project) => {
              const gone = missing.includes(project.cwd);
              return (
                <button
                  key={project.cwd}
                  type="button"
                  role="menuitem"
                  className={`composer-menu-item workspace-picker-recent${
                    gone ? " is-missing" : ""
                  }`}
                  disabled={gone}
                  title={project.cwd}
                  onClick={() => void selectRecent(project.cwd)}
                >
                  <span className="workspace-picker-recent-name">
                    {folderName(project.cwd)}
                  </span>
                  <span className="workspace-picker-recent-path">
                    {gone ? t("workspace.recentMissing") : project.cwd}
                  </span>
                </button>
              );
            })}
            <div className="workspace-picker-menu-sep" role="separator" />
            <button
              type="button"
              role="menuitem"
              className="composer-menu-item"
              onClick={browse}
            >
              <span className="composer-menu-item-row">
                <WorkspaceIcon />
                <span className="composer-menu-item-label">
                  {t("workspace.browse")}
                </span>
              </span>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
