import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SlidesDocument } from "../../../../electron/office/types";
import { base64ToBytes } from "./bytes";

type Props = { doc: SlidesDocument };

/** 16:9 — the ratio of every modern deck; 4:3 decks letterbox harmlessly. */
const SLIDE_RATIO = 9 / 16;
/** Re-render only on a real size change, not on sub-pixel scroll jitter. */
const RESIZE_EPSILON = 24;

/**
 * PowerPoint preview with real layout.
 *
 * `pptx-preview` walks the OOXML and draws each shape at its own position with
 * the deck's theme colours, so slides look like slides instead of a bullet
 * list. It renders into a DOM node, hence the bytes-over-IPC arrangement.
 */
export function SlidesView({ doc }: Props) {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // The renderer needs explicit pixel dimensions, so track the pane width.
  useEffect(() => {
    const container = host.current?.parentElement;
    if (!container) return;
    const apply = () => {
      const next = Math.max(320, Math.floor(container.clientWidth) - 24);
      setWidth((current) =>
        Math.abs(current - next) > RESIZE_EPSILON ? next : current,
      );
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const container = host.current;
    if (!container || width === 0) return;

    let cancelled = false;
    let previewer: { destroy: () => void } | null = null;
    setLoading(true);
    setError(null);
    container.replaceChildren();

    void (async () => {
      try {
        const { init } = await import("pptx-preview");
        if (cancelled) return;
        const instance = init(container, {
          width,
          height: Math.round(width * SLIDE_RATIO),
          mode: "list",
        });
        previewer = instance;
        const bytes = base64ToBytes(doc.base64);
        await instance.preview(
          bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ) as ArrayBuffer,
        );
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      try {
        previewer?.destroy();
      } catch {
        // Destroy races an in-flight render — the container is dropped anyway.
      }
    };
  }, [doc.base64, width]);

  return (
    <div className="office-slides">
      {loading ? (
        <div className="office-empty">{t("common.loading")}</div>
      ) : null}
      {error ? <div className="office-error">{error}</div> : null}
      <div className="office-slides-host" ref={host} />
    </div>
  );
}
