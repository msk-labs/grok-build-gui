import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { LocalSession } from "../../types/chat";
import {
  SessionDoneDot,
  SessionSpinner,
  SessionWorktreeBadge,
} from "./icons";
import { useTranslation } from "react-i18next";
import { isProvisionalSessionId } from "../../lib/sessionList";
import { isPlaceholderSessionTitle } from "../../lib/sessionTitle";

type Props = {
  session: LocalSession;
  active: boolean;
  menuOpen: boolean;
  renaming: boolean;
  disabled: boolean;
  onSelect: (id: string) => void;
  onOpenMenu: (e: ReactMouseEvent, id: string) => void;
  onRename: (id: string) => void;
  onRenameCommit: (id: string, nextTitle: string) => void;
  onRenameCancel: () => void;
  onDelete: (e: ReactMouseEvent, id: string) => void;
};

export function SessionItem({
  session: s,
  active,
  menuOpen,
  renaming,
  disabled,
  onSelect,
  onOpenMenu,
  onRename,
  onRenameCommit,
  onRenameCancel,
  onDelete,
}: Props) {
  const { t } = useTranslation();
  const rawTitle = s.title?.trim();
  const title =
    s.isSideTask &&
    (rawTitle === "Side task" || isPlaceholderSessionTitle(rawTitle))
      ? t("tools.sideTask")
      : isPlaceholderSessionTitle(rawTitle)
      ? t("nav.untitledSession")
      : rawTitle;
  const editableTitle = isPlaceholderSessionTitle(rawTitle) ? "" : rawTitle;
  const showSpinner = !!s.running;
  const showDoneDot = !s.running && !!s.unreadDone;
  const [draft, setDraft] = useState(editableTitle);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const finishingRef = useRef(false);

  useEffect(() => {
    if (!renaming) return;
    finishingRef.current = false;
    setDraft(editableTitle);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [editableTitle, renaming]);

  function commitRename() {
    if (finishingRef.current) return;
    const nextTitle = draft.trim();
    finishingRef.current = true;
    if (!nextTitle) {
      onRenameCancel();
      return;
    }
    onRenameCommit(s.id, nextTitle);
  }

  function cancelRename() {
    if (finishingRef.current) return;
    finishingRef.current = true;
    onRenameCancel();
  }

  function handleRenameKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelRename();
    }
  }

  function handleRenameSubmit(e: FormEvent) {
    e.preventDefault();
    commitRename();
  }

  return (
    <div
      className={`session-item${active ? " active" : ""}${
        menuOpen ? " menu-open" : ""
      }${showSpinner ? " is-running" : ""}${showDoneDot ? " is-done" : ""}${
        renaming ? " is-renaming" : ""
      }`}
    >
      {renaming ? (
        <form className="session-item-rename" onSubmit={handleRenameSubmit}>
          <input
            ref={inputRef}
            className="session-item-rename-input"
            value={draft}
            placeholder={t("nav.untitledSession")}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={commitRename}
            aria-label={t("nav.renameSession")}
            maxLength={120}
          />
        </form>
      ) : (
        <button
          type="button"
          className="session-item-main"
          onClick={() => onSelect(s.id)}
          disabled={disabled}
          title={title}
        >
          {/*
            The trailing slot is a single 24px grid cell shared by the spinner,
            done dot and ⋯ button — the badge has to lead the title instead.
          */}
          {s.worktree ? (
            <SessionWorktreeBadge label={s.worktree.label || s.worktree.path} />
          ) : null}
          <span className="session-item-title">{title}</span>
        </button>
      )}
      {!renaming ? (
        <div className="session-item-trailing">
          {showSpinner ? <SessionSpinner /> : null}
          {showDoneDot ? <SessionDoneDot /> : null}
          <button
            type="button"
            className="session-item-more"
            aria-label={t("nav.sessionActions")}
            aria-expanded={menuOpen}
            disabled={disabled}
            onClick={(e) => onOpenMenu(e, s.id)}
          >
            ···
          </button>
        </div>
      ) : null}
      {menuOpen && !renaming ? (
        <div className="session-item-menu">
          <button
            type="button"
            className="session-item-menu-item"
            disabled={isProvisionalSessionId(s.id)}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onRename(s.id);
            }}
          >
            {t("nav.renameSession")}
          </button>
          <button
            type="button"
            className="session-item-menu-item danger"
            onClick={(e) => onDelete(e, s.id)}
          >
            {t("nav.deleteSession")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
