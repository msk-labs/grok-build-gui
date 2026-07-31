import {
  useCallback,
  useEffect,
  useState,
  type SyntheticEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

/** 25% … 400% — keeps detail usable without runaway zoom. */
const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const ZOOM_STEP = 0.25;

export type LightboxImage = {
  src: string;
  /** Absolute path when available (preferred for save-as copy). */
  path?: string;
  filename?: string;
  alt?: string;
};

function clampScale(s: number): number {
  const stepped = Math.round(s / ZOOM_STEP) * ZOOM_STEP;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(stepped * 100) / 100));
}

/**
 * Full-window image preview: dim mask, real size zoom (not CSS transform clip),
 * bottom zoom controls, save-as + close top-right.
 */
export function ImageLightbox({
  image,
  onClose,
}: {
  image: LightboxImage;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [scale, setScale] = useState(1);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  /** Display size at 100% (fitted into the viewport). Zoom multiplies this. */
  const [fit, setFit] = useState<{ w: number; h: number } | null>(null);

  const setScaleClamped = useCallback((next: number | ((s: number) => number)) => {
    setScale((prev) =>
      clampScale(typeof next === "function" ? next(prev) : next),
    );
  }, []);

  const zoomBy = useCallback(
    (delta: number) => setScaleClamped((s) => s + delta),
    [setScaleClamped],
  );

  const computeFit = useCallback((naturalW: number, naturalH: number) => {
    if (naturalW <= 0 || naturalH <= 0) return;
    const maxW = Math.min(window.innerWidth * 0.9, 1100);
    const maxH = Math.min(window.innerHeight * 0.78, 900);
    const r = Math.min(maxW / naturalW, maxH / naturalH, 1);
    setFit({
      w: Math.max(1, Math.round(naturalW * r)),
      h: Math.max(1, Math.round(naturalH * r)),
    });
  }, []);

  const onImgLoad = (e: SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    computeFit(img.naturalWidth, img.naturalHeight);
  };

  useEffect(() => {
    const onResize = () => {
      // Re-fit base size when the window changes; keep current scale.
      const img = document.querySelector(
        ".image-lightbox-img",
      ) as HTMLImageElement | null;
      if (img?.naturalWidth) computeFit(img.naturalWidth, img.naturalHeight);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [computeFit]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoomBy(ZOOM_STEP);
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomBy(-ZOOM_STEP);
      } else if (e.key === "0") {
        e.preventDefault();
        setScaleClamped(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, zoomBy, setScaleClamped]);

  const onWheel = (e: ReactWheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      // Trackpad pinch often reports as ctrl+wheel.
      e.preventDefault();
      zoomBy(e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP);
    }
  };

  const saveAs = async () => {
    if (saving) return;
    setSaving(true);
    setSaveStatus(null);
    try {
      const defaultName =
        image.filename ||
        (image.path ? image.path.split(/[/\\]/).pop() : null) ||
        "image.png";

      const save = window.grok?.saveImage;
      if (save) {
        // Always pass the displayed src when it is a data URL so main can
        // write bytes even if the on-disk path is missing or restricted.
        const result = await save({
          dataUrl: image.src.startsWith("data:") ? image.src : undefined,
          sourcePath: image.path,
          defaultName,
        });
        if (result.ok) {
          setSaveStatus(t("tools.saveImageDone"));
          window.setTimeout(() => setSaveStatus(null), 2000);
          return;
        }
        if (result.canceled) return;
        setSaveStatus(
          result.error
            ? t("tools.saveImageFailed", { error: result.error })
            : t("tools.saveImageFailed", { error: "unknown" }),
        );
        return;
      }

      // Non-Electron fallback.
      const a = document.createElement("a");
      a.href = image.src;
      a.download = defaultName;
      a.rel = "noreferrer";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setSaveStatus(t("tools.saveImageDone"));
      window.setTimeout(() => setSaveStatus(null), 2000);
    } catch (e) {
      setSaveStatus(
        t("tools.saveImageFailed", {
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    } finally {
      setSaving(false);
    }
  };

  const percent = Math.round(scale * 100);
  const atMin = scale <= MIN_SCALE + 1e-6;
  const atMax = scale >= MAX_SCALE - 1e-6;
  const displayW = fit ? Math.round(fit.w * scale) : undefined;
  const displayH = fit ? Math.round(fit.h * scale) : undefined;

  return createPortal(
    <div
      className="image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={t("tools.imagePreview")}
      onClick={onClose}
      onWheel={onWheel}
    >
      <div
        className="image-lightbox-toolbar"
        onClick={(e) => e.stopPropagation()}
      >
        {saveStatus ? (
          <span className="image-lightbox-save-status" role="status">
            {saveStatus}
          </span>
        ) : null}
        <button
          type="button"
          className="image-lightbox-btn"
          onClick={() => void saveAs()}
          disabled={saving}
          title={t("tools.saveImageAs")}
          aria-label={t("tools.saveImageAs")}
        >
          <DownloadIcon />
        </button>
        <button
          type="button"
          className="image-lightbox-btn"
          onClick={onClose}
          title={t("tools.closeImagePreview")}
          aria-label={t("tools.closeImagePreview")}
        >
          <CloseIcon />
        </button>
      </div>

      <div
        className="image-lightbox-stage"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="image-lightbox-canvas"
          style={
            displayW && displayH
              ? { width: displayW, height: displayH }
              : undefined
          }
        >
          <img
            src={image.src}
            alt={image.alt || t("tools.generatedImage")}
            className={
              fit
                ? "image-lightbox-img"
                : "image-lightbox-img image-lightbox-img-pending"
            }
            onLoad={onImgLoad}
            draggable={false}
            style={
              displayW && displayH
                ? { width: displayW, height: displayH }
                : undefined
            }
          />
        </div>
      </div>

      <div
        className="image-lightbox-zoombar"
        onClick={(e) => e.stopPropagation()}
        role="group"
        aria-label={t("tools.imageZoom")}
      >
        <button
          type="button"
          className="image-lightbox-btn image-lightbox-zoom-btn"
          onClick={() => zoomBy(-ZOOM_STEP)}
          disabled={atMin}
          title={t("tools.zoomOut")}
          aria-label={t("tools.zoomOut")}
        >
          <MinusIcon />
        </button>
        <button
          type="button"
          className="image-lightbox-zoom-label"
          onClick={() => setScaleClamped(1)}
          title={t("tools.zoomReset")}
          aria-label={t("tools.zoomReset")}
        >
          {percent}%
        </button>
        <button
          type="button"
          className="image-lightbox-btn image-lightbox-zoom-btn"
          onClick={() => zoomBy(ZOOM_STEP)}
          disabled={atMax}
          title={t("tools.zoomIn")}
          aria-label={t("tools.zoomIn")}
        >
          <PlusIcon />
        </button>
      </div>
    </div>,
    document.body,
  );
}

function DownloadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3v12m0 0 4-4m-4 4-4-4M4 21h16"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6 6l12 12M18 6 6 18"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 12h14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
