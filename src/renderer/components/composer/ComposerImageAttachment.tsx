import { type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import type { ChatImage } from "../../types/chat";

export function ComposerImageAttachment({
  image,
  onRemove,
}: {
  image: ChatImage;
  onRemove?: (id: string) => void;
}) {
  const { t, i18n } = useTranslation();

  async function openMenu(event: MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const action = await window.grok?.popupImageAttachmentMenu?.({
      locale: i18n.resolvedLanguage ?? i18n.language,
    });
    if (action === "copy") {
      await window.grok?.copyImage?.(image.dataUrl);
      return;
    }
    if (action === "save") {
      await window.grok?.saveImage?.({
        dataUrl: image.dataUrl,
        defaultName: image.name || "screenshot.png",
      });
      return;
    }
    if (action === "remove") {
      onRemove?.(image.id);
    }
  }

  return (
    <div
      className="composer-attachment"
      onContextMenu={(event) => void openMenu(event)}
    >
      <img
        src={image.dataUrl}
        alt={image.name ?? t("composer.attachment")}
        width={image.width}
        height={image.height}
        draggable={false}
      />
      {onRemove ? (
        <button
          type="button"
          className="composer-attachment-remove"
          onClick={() => onRemove(image.id)}
          title={t("common.remove")}
          aria-label={t("composer.removeAttachment")}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
