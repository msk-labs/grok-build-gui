import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BranchIcon, CheckIcon } from "./icons";

export type WorktreeBarProps = {
  /** Workspace is a git checkout. Worktrees are impossible without one. */
  isRepo: boolean;
  /** Branch currently checked out in the workspace. */
  branch: string;
  /** Workspace folder — the branch list is read from this repo. */
  cwd: string;
  /** Branch the new chat will start from ("" = stay on `branch`). */
  baseRef: string;
  /** Draft will run in an isolated worktree. */
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  onSelectBranch: (branch: string) => void;
};

/**
 * Branch picker + worktree opt-in, shown only on a new-chat draft: both
 * choices are frozen the moment a session is created.
 *
 * Picking a branch other than the checked-out one implies a worktree — that is
 * how you work on another branch without disturbing the working copy — so the
 * caller turns the opt-in on for us.
 */
export function WorktreeBar({
  isRepo,
  branch,
  cwd,
  baseRef,
  enabled,
  onToggle,
  onSelectBranch,
  disabled,
}: WorktreeBarProps & { disabled: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<readonly string[]>([]);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const selected = baseRef || branch;

  useEffect(() => {
    if (!open) return;
    function onDocDown(e: MouseEvent) {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Branches can be created outside the app, so re-read on every open.
  useEffect(() => {
    if (!open || !cwd || !isRepo || !window.grok?.gitBranches) return;
    let cancelled = false;
    void window.grok.gitBranches(cwd).then((list) => {
      if (!cancelled) setBranches(list);
    });
    return () => {
      cancelled = true;
    };
  }, [open, cwd]);

  const rows = branches.length > 0 ? branches : branch ? [branch] : [];

  return (
    <div
      className={`worktree-bar${enabled ? " is-on" : ""}`}
      ref={wrapRef}
    >
      {isRepo && selected ? (
        <>
          <button
            type="button"
            className={`worktree-bar-branch${open ? " open" : ""}`}
            onClick={() => setOpen((v) => !v)}
            disabled={disabled}
            aria-haspopup="menu"
            aria-expanded={open}
            title={t("worktree.branchHint")}
          >
            <BranchIcon />
            <span className="worktree-bar-branch-name">{selected}</span>
          </button>
          <span className="worktree-bar-sep" aria-hidden />
        </>
      ) : null}

      <label
        className="worktree-bar-check"
        title={isRepo ? t("worktree.hint") : t("worktree.needGit")}
      >
        <input
          type="checkbox"
          checked={enabled}
          disabled={disabled || !isRepo}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <span>{t("worktree.pill")}</span>
      </label>

      {open ? (
        <div className="composer-menu worktree-branch-menu" role="menu">
          <div className="worktree-branch-menu-label">
            {t("worktree.branchCount", { count: rows.length })}
          </div>
          {rows.map((name) => (
            <button
              key={name}
              type="button"
              role="menuitemradio"
              aria-checked={name === selected}
              className={`composer-menu-item worktree-branch-item${
                name === selected ? " is-selected" : ""
              }`}
              onClick={() => {
                onSelectBranch(name);
                setOpen(false);
              }}
            >
              <span className="worktree-branch-item-check">
                {name === selected ? <CheckIcon /> : null}
              </span>
              <span className="worktree-branch-item-name">{name}</span>
              {name === branch ? (
                <span className="worktree-branch-item-tag">
                  {t("worktree.branchCurrent")}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
