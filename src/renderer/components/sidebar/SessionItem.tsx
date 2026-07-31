import type { MouseEvent as ReactMouseEvent } from "react";
import type { LocalSession } from "../../types/chat";
import {
  SessionDoneDot,
  SessionSpinner,
  SessionWorktreeBadge,
} from "./icons";
import { useTranslation } from "react-i18next";
import { isPlaceholderSessionTitle } from "../../lib/sessionTitle";

type Props = {
  session: LocalSession;
  active: boolean;
  menuOpen: boolean;
  disabled: boolean;
  onSelect: (id: string) => void;
  onOpenMenu: (e: ReactMouseEvent, id: string) => void;
  onDelete: (e: ReactMouseEvent, id: string) => void;
};

export function SessionItem({
  session: s,
  active,
  menuOpen,
  disabled,
  onSelect,
  onOpenMenu,
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
  const showSpinner = !!s.running;
  const showDoneDot = !s.running && !!s.unreadDone;

  return (
    <div
      className={`session-item${active ? " active" : ""}${
        menuOpen ? " menu-open" : ""
      }${showSpinner ? " is-running" : ""}${showDoneDot ? " is-done" : ""}`}
    >
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
      <div className="session-item-trailing">
        {showSpinner ? <SessionSpinner /> : null}
        {showDoneDot ? <SessionDoneDot /> : null}
        <button
          type="button"
          className="session-item-more"
          aria-label={t("nav.sessionActions")}
          disabled={disabled}
          onClick={(e) => onOpenMenu(e, s.id)}
        >
          ···
        </button>
      </div>
      {menuOpen ? (
        <div className="session-item-menu">
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
