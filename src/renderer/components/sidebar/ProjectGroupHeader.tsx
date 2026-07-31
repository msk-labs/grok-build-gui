import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { FolderIcon, SquarePenIcon } from "./icons";

type Props = {
  cwd: string;
  name: string;
  open: boolean;
  menuOpen: boolean;
  renaming: boolean;
  newDisabled: boolean;
  disabled: boolean;
  onToggle: () => void;
  onNew: () => void;
  onOpenMenu: (e: ReactMouseEvent) => void;
  onRename: () => void;
  onRenameCommit: (nextName: string) => void;
  onRenameCancel: () => void;
  /** Open the project folder in the OS file manager (Finder / Explorer). */
  onRevealInFolder: () => void;
  onDelete: (e: ReactMouseEvent) => void;
};

function fileManagerLabelKey():
  | "nav.openInFinder"
  | "nav.openInExplorer"
  | "nav.openInFolder" {
  const ua = navigator.userAgent || "";
  const plat = navigator.platform || "";
  if (/Mac|iPhone|iPad/i.test(plat) || /Mac OS/i.test(ua)) {
    return "nav.openInFinder";
  }
  if (/Win/i.test(plat) || /Windows/i.test(ua)) {
    return "nav.openInExplorer";
  }
  return "nav.openInFolder";
}

/**
 * Project folder row: expand/collapse, optional inline rename, new-chat, and ⋯ menu.
 */
export function ProjectGroupHeader({
  cwd,
  name,
  open,
  menuOpen,
  renaming,
  newDisabled,
  disabled,
  onToggle,
  onNew,
  onOpenMenu,
  onRename,
  onRenameCommit,
  onRenameCancel,
  onRevealInFolder,
  onDelete,
}: Props) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!renaming) return;
    setDraft(name);
    // Focus after paint so the input is mounted.
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.select();
    });
  }, [renaming, name]);

  function commitRename() {
    onRenameCommit(draft);
  }

  function onRenameKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onRenameCancel();
    }
  }

  function onRenameSubmit(e: FormEvent) {
    e.preventDefault();
    commitRename();
  }

  return (
    <div
      className={`session-group-header${menuOpen ? " menu-open" : ""}${
        renaming ? " is-renaming" : ""
      }`}
    >
      {renaming ? (
        <form className="session-group-rename" onSubmit={onRenameSubmit}>
          <FolderIcon open={open} />
          <input
            ref={inputRef}
            className="session-group-rename-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onRenameKeyDown}
            onBlur={commitRename}
            aria-label={t("nav.renameProject")}
            maxLength={120}
          />
        </form>
      ) : (
        <button
          type="button"
          className="session-group-toggle"
          onClick={onToggle}
          title={cwd || undefined}
          aria-expanded={open}
        >
          <FolderIcon open={open} />
          <span className="session-group-name">{name}</span>
        </button>
      )}

      {!renaming ? (
        <div className="session-group-actions">
          <button
            type="button"
            className="session-group-more"
            aria-label={t("nav.projectActions")}
            aria-expanded={menuOpen}
            disabled={disabled}
            onClick={onOpenMenu}
          >
            ···
          </button>
          <button
            type="button"
            className="session-group-new"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onNew();
            }}
            disabled={newDisabled}
            title={
              cwd ? t("nav.newChatIn", { name }) : t("nav.newChat")
            }
            aria-label={
              cwd ? t("nav.newChatIn", { name }) : t("nav.newChat")
            }
          >
            <SquarePenIcon />
          </button>
          {menuOpen ? (
            <div className="session-item-menu session-group-menu">
              <button
                type="button"
                className="session-item-menu-item"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onRename();
                }}
              >
                {t("nav.renameProject")}
              </button>
              {cwd ? (
                <button
                  type="button"
                  className="session-item-menu-item"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onRevealInFolder();
                  }}
                >
                  {t(fileManagerLabelKey())}
                </button>
              ) : null}
              <button
                type="button"
                className="session-item-menu-item danger"
                onClick={onDelete}
              >
                {t("nav.deleteProject")}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
