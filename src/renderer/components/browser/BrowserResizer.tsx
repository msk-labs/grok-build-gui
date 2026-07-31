import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  BROWSER_WIDTH_MAX,
  BROWSER_WIDTH_MIN,
  clampBrowserWidth,
  saveBrowserWidth,
} from "./browserWidth";
import { useTranslation } from "react-i18next";

type Props = {
  width: number;
  onWidthChange: (px: number) => void;
};

/**
 * Drag handle on the left edge of the browser pane.
 * Dragging left widens the pane; dragging right narrows it.
 */
export function BrowserResizer({ width, onWidthChange }: Props) {
  const { t } = useTranslation();
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  const startX = useRef(0);
  const startW = useRef(width);
  const widthRef = useRef(width);
  widthRef.current = width;

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      startX.current = e.clientX;
      startW.current = widthRef.current;
      draggingRef.current = true;
      setDragging(true);
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      // Left edge: move left → wider.
      onWidthChange(
        clampBrowserWidth(startW.current - (e.clientX - startX.current)),
      );
    },
    [onWidthChange],
  );

  const endDrag = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Already released.
    }
    saveBrowserWidth(widthRef.current);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
    };
  }, [dragging]);

  return (
    <div
      className={`browser-resizer${dragging ? " browser-resizer-active" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={t("resize.browser")}
      aria-valuenow={width}
      aria-valuemin={BROWSER_WIDTH_MIN}
      aria-valuemax={BROWSER_WIDTH_MAX}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 24 : 12;
        // ArrowLeft widens (pane grows leftward); ArrowRight narrows.
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          const next = clampBrowserWidth(width + step);
          onWidthChange(next);
          saveBrowserWidth(next);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          const next = clampBrowserWidth(width - step);
          onWidthChange(next);
          saveBrowserWidth(next);
        }
      }}
    />
  );
}
