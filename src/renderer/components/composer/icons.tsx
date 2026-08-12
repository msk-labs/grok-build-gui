export function WorkspaceIcon() {
  return (
    <svg
      className="workspace-picker-icon"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
    >
      <path
        d="M1.5 4.25A1.75 1.75 0 0 1 3.25 2.5h3.1c.3 0 .58.12.79.33l.9.9c.1.1.24.16.38.16h4.33A1.75 1.75 0 0 1 14.5 5.64v6.11A1.75 1.75 0 0 1 12.75 13.5h-9.5A1.75 1.75 0 0 1 1.5 11.75V4.25Z"
        stroke="currentColor"
        strokeWidth="1.2"
        fill="currentColor"
        fillOpacity="0.08"
      />
    </svg>
  );
}

/** Lucide-style git-branch — isolated worktree trigger. */
export function BranchIcon() {
  return (
    <svg
      className="workspace-picker-icon"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
    >
      <circle cx="4.5" cy="3.5" r="1.75" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="4.5" cy="12.5" r="1.75" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="11.5" cy="3.5" r="1.75" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M4.5 5.25v5.5M11.5 5.25v1.1a2.4 2.4 0 0 1-2.4 2.4H6.9a2.4 2.4 0 0 0-2.4 2.4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Check mark for the selected row of a composer menu. */
export function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="m3.5 8.5 3 3 6-7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Lucide-style shield — Codex permissions trigger. */
export function ShieldIcon() {
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
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    </svg>
  );
}

/** Plus — open attach menu. */
export function PlusIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

/** Paperclip — attach files from the + menu. */
export function PaperclipIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

/** Crop / region capture icon. */
export function CaptureIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 2v4H2" />
      <path d="M18 2v4h4" />
      <path d="M2 18h4v4" />
      <path d="M22 18h-4v4" />
      <rect x="6" y="6" width="12" height="12" rx="1" />
    </svg>
  );
}

/** Lucide ChevronDown. */
export function ChevronDownIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** Lucide ChevronRight — nested submenu affordance. */
export function ChevronRightIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

/** Lucide ChevronLeft — submenu back. */
export function ChevronLeftIcon() {
  return (
    <svg
      width="12"
      height="12"
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


/** Pencil used by the custom-model configuration row. */
export function EditModelIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m4 20 4.3-1 10.3-10.3a2.1 2.1 0 0 0-3-3L5.3 16 4 20Z" />
      <path d="m13.5 7.5 3 3" />
    </svg>
  );
}

/** Codex send: upward arrow. */
export function ArrowUpIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m5 12 7-7 7 7" />
      <path d="M12 19V5" />
    </svg>
  );
}

/** Codex stop: player-style filled square. */
export function StopSquareIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
      <rect x="2.25" y="2.25" width="9.5" height="9.5" rx="1.5" />
    </svg>
  );
}

/** Microphone — start voice input. */
export function MicIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  );
}

/** Close / cancel (X). */
export function CloseIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
