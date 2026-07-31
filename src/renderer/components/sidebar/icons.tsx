import { useTranslation } from "react-i18next";

/**
 * Lucide icons as used by Codex desktop (icon-xs = 16px, viewBox 24).
 * FolderOpen / FolderClosed double as the collapse affordance.
 * SquarePen is the per-project “new thread” control.
 */
export function FolderIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg
        className="session-group-folder-icon open"
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
        <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
      </svg>
    );
  }
  return (
    <svg
      className="session-group-folder-icon"
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
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
      <path d="M2 10h20" />
    </svg>
  );
}

/**
 * Single-stroke chevron (like `>`). Rotated via CSS when the section is open.
 * Shown on hover next to Projects / Tasks section labels.
 */
export function SectionChevronIcon() {
  return (
    <svg
      className="sidebar-section-chevron-icon"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4.25 2.5 7.75 6 4.25 9.5" />
    </svg>
  );
}

/** Lucide PanelLeft — collapse / expand the session sidebar. */
export function PanelLeftIcon() {
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

/** Lucide SquarePen — Codex “Start new chat in {folder}” icon. */
export function SquarePenIcon() {
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
      <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z" />
    </svg>
  );
}

/** Lucide Puzzle — plugins manager entry. */
export function PuzzleIcon() {
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
      <path d="M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 2.997 3.015 1 1 0 0 0-.822 1.139l.546 9.124a2 2 0 0 1-1.978 2.162H6.177a2 2 0 0 1-1.978-2.162l.546-9.124A1 1 0 0 0 3.923 6.93a2.5 2.5 0 1 1 2.997-3.014 1 1 0 0 0 1.68.474L10 6.5l5.39-2.11Z" />
      <path d="M10 12h4" />
      <path d="M10 16h4" />
    </svg>
  );
}

/** Lucide Search — session / thread search (Codex-style). */
export function SearchIcon() {
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
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

/** Lucide X — clear / close search. */
export function XIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

/** Codex-style spinner shown on the right while a session turn is running. */
export function SessionSpinner() {
  const { t } = useTranslation();
  return (
    <span
      className="session-item-spinner"
      aria-label={t("common.running")}
      title={t("common.running")}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
        <circle
          cx="7"
          cy="7"
          r="5.25"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeOpacity="0.22"
        />
        <path
          d="M12.25 7A5.25 5.25 0 0 0 7 1.75"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

/** Git-branch glyph marking a chat that runs in an isolated worktree. */
export function SessionWorktreeBadge({ label }: { label: string }) {
  const { t } = useTranslation();
  const title = t("worktree.badge", { label });
  return (
    <span className="session-worktree-badge" aria-label={title} title={title}>
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
        <circle cx="4.5" cy="3.5" r="1.6" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="4.5" cy="12.5" r="1.6" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="11.5" cy="3.5" r="1.6" stroke="currentColor" strokeWidth="1.2" />
        <path
          d="M4.5 5.1v5.8M11.5 5.1v1.2a2.4 2.4 0 0 1-2.4 2.4H6.9a2.4 2.4 0 0 0-2.4 2.4"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

/** Blue dot after a background turn finishes (clears when session is opened). */
export function SessionDoneDot() {
  const { t } = useTranslation();
  return (
    <span
      className="session-item-done-dot"
      aria-label={t("common.finished")}
      title={t("common.workFinished")}
    />
  );
}
