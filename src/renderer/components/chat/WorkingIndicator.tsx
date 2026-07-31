import { useTranslation } from "react-i18next";

/** Animated “Working…” status — used while waiting, not a blinking cursor. */
export function WorkingIndicator({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <div className="working-indicator" role="status" aria-live="polite">
      <span className="working-label">{label ?? t("tools.working")}</span>
      <span className="working-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
    </div>
  );
}
