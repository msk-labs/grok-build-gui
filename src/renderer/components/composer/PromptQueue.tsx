import type { QueuedPrompt } from "../../types/promptQueue";
import { useTranslation } from "react-i18next";

type Props = {
  items: QueuedPrompt[];
  /** Promote this item into the running turn (interject / send now). */
  onSendNow: (id: string) => void;
  onRemove: (id: string) => void;
  disabled?: boolean;
};

function QueueIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
    >
      <path
        d="M3 4.5h10M3 8h10M3 11.5h7"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
    >
      <path
        d="M4 4l8 8M12 4l-8 8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Codex-style follow-up queue above the composer.
 * Soft rounded rows; Send now steers the running turn.
 */
export function PromptQueue({
  items,
  onSendNow,
  onRemove,
  disabled,
}: Props) {
  const { t } = useTranslation();
  if (items.length === 0) return null;

  return (
    <div className="prompt-queue" aria-label={t("composer.queued")}>
      <ul className="prompt-queue-list">
        {items.map((item) => {
          const preview =
            item.text.trim() ||
            (item.images.length > 0
              ? `Image${item.images.length > 1 ? "s" : ""}`
              : item.files.length > 0
                ? item.files.map((f) => f.name).join(", ")
                : "(empty)");
          const firstLine =
            preview
              .split("\n")
              .map((l) => l.trim())
              .find(Boolean) || preview;

          return (
            <li key={item.id}>
              <div className="prompt-queue-row">
                <span className="prompt-queue-icon" aria-hidden>
                  <QueueIcon />
                </span>
                <button
                  type="button"
                  className="prompt-queue-body"
                  title={preview}
                  disabled={disabled}
                  onClick={() => onSendNow(item.id)}
                >
                  <span className="prompt-queue-line">{firstLine}</span>
                </button>
                <div className="prompt-queue-actions">
                  <button
                    type="button"
                    className="prompt-queue-send"
                    disabled={disabled}
                    title={t("composer.sendNow")}
                    onClick={() => onSendNow(item.id)}
                  >
                    {t("composer.sendNow")}
                  </button>
                  <button
                    type="button"
                    className="prompt-queue-dismiss"
                    disabled={disabled}
                    title={t("common.remove")}
                    aria-label={t("composer.removeQueue")}
                    onClick={() => onRemove(item.id)}
                  >
                    <CloseIcon />
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
