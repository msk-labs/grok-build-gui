import { useEffect, useState } from "react";
import type { ToolImageContent } from "../../types/chat";
import { toolImageDataUrl } from "../../lib/toolImages";
import { useTranslation } from "react-i18next";
import { ImageLightbox, type LightboxImage } from "./ImageLightbox";

/**
 * Codex-style generated-image gallery in the chat trail.
 * Embedded base64 or on-disk paths; click opens lightbox (zoom + save-as).
 */
export function ToolResultImages({
  images,
  className,
}: {
  images: ToolImageContent[];
  className?: string;
}) {
  const [lightbox, setLightbox] = useState<LightboxImage | null>(null);

  if (images.length === 0) return null;
  return (
    <>
      <div
        className={["tool-result-images", className].filter(Boolean).join(" ")}
        data-testid="generated-image-gallery"
      >
        {images.map((img, i) => (
          <ToolResultImage
            key={
              img.path || `${img.mimeType}-${i}-${(img.data ?? "").slice(0, 12)}`
            }
            image={img}
            onOpen={(entry) => setLightbox(entry)}
          />
        ))}
      </div>
      {lightbox ? (
        <ImageLightbox image={lightbox} onClose={() => setLightbox(null)} />
      ) : null}
    </>
  );
}

function ToolResultImage({
  image,
  onOpen,
}: {
  image: ToolImageContent;
  onOpen: (entry: LightboxImage) => void;
}) {
  const { t } = useTranslation();
  const embedded = toolImageDataUrl(image);
  const [src, setSrc] = useState<string | null>(embedded);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (embedded) {
      setSrc(embedded);
      setFailed(false);
      return;
    }
    const path = image.path;
    if (!path) {
      setSrc(null);
      return;
    }
    let cancelled = false;
    setFailed(false);
    const read = window.grok?.readImageDataUrl;
    if (!read) {
      setSrc(null);
      setFailed(true);
      return;
    }
    void read(path).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setSrc(res.dataUrl);
        setFailed(false);
      } else {
        setSrc(null);
        setFailed(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [embedded, image.path]);

  if (failed && !src) {
    return (
      <div className="tool-result-image-missing" title={image.path || undefined}>
        {image.filename || image.path || t("tools.openImage")}
      </div>
    );
  }
  if (!src) {
    return (
      <div className="tool-result-image-loading" aria-busy="true">
        {t("tools.loadingImage")}
      </div>
    );
  }

  const label = image.filename || image.path || t("tools.openImage");

  return (
    <button
      type="button"
      className="tool-result-image-link"
      data-testid="generated-image-preview"
      title={label}
      aria-label={label}
      onClick={() =>
        onOpen({
          src,
          path: image.path,
          filename: image.filename,
          alt: image.filename || t("tools.generatedImage"),
        })
      }
    >
      <img
        src={src}
        alt={image.filename || t("tools.generatedImage")}
        className="tool-result-image"
        decoding="async"
        draggable={false}
      />
    </button>
  );
}
