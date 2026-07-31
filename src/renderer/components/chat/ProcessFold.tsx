import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Collapsible fold that only mounts body content when opened — keeps history
 * load light (Codex-style auto-collapse of thinking / tools).
 *
 * Uses a button + controlled body instead of nested <details>: React-controlled
 * <details> + toggle bubbling was a source of folds occasionally opening on
 * their own during streaming remounts.
 *
 * Default: always collapsed. Only opens for explicit user click, defaultOpen,
 * or openWhen (e.g. search jump). Live status never auto-expands the body.
 */
export function ProcessFold({
  label,
  live,
  className,
  children,
  defaultOpen = false,
  openWhen = false,
}: {
  label: ReactNode;
  /** Show pulse dots after the label (live thinking / running tool). */
  live?: boolean;
  /** Extra class (e.g. process-fold-l2 / process-fold-tool-group). */
  className?: string;
  children: ReactNode;
  /** Start expanded (e.g. search jump into folded process trail). */
  defaultOpen?: boolean;
  /** Open when external navigation (for example search) targets this fold. */
  openWhen?: boolean;
}) {
  const userToggled = useRef(false);
  const wasOpenWhen = useRef(Boolean(openWhen));
  const [open, setOpen] = useState(() => Boolean(defaultOpen || openWhen));

  // Search / external navigation may open a fold; when that signal clears,
  // re-collapse unless the user has toggled it themselves.
  useEffect(() => {
    if (openWhen) {
      setOpen(true);
      wasOpenWhen.current = true;
      return;
    }
    if (wasOpenWhen.current && !userToggled.current) {
      setOpen(false);
    }
    wasOpenWhen.current = false;
  }, [openWhen]);

  return (
    <div
      className={["process-fold", open ? "is-open" : null, className]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        type="button"
        className="process-summary"
        aria-expanded={open}
        onClick={() => {
          userToggled.current = true;
          setOpen((value) => !value);
        }}
      >
        <span className="process-summary-label">{label}</span>
        {live ? (
          <span className="working-dots compact" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        ) : null}
      </button>
      {open ? <div className="process-fold-body">{children}</div> : null}
    </div>
  );
}
