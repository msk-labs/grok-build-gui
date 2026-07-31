import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  clampSidebarWidth,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  saveSidebarWidth,
} from "./sidebarWidth";
import { useTranslation } from "react-i18next";

type Props = {
  width: number;
  onWidthChange: (px: number) => void;
};

/**
 * Drag handle between the left session list and the main pane.
 * Positioned on the sidebar's right edge via --sidebar-w.
 */
export function SidebarResizer({ width, onWidthChange }: Props) {
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
      onWidthChange(
        clampSidebarWidth(startW.current + (e.clientX - startX.current)),
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
    saveSidebarWidth(widthRef.current);
  }, []);

  // While dragging: lock cursor + disable text selection globally.
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
      className={`sidebar-resizer${dragging ? " sidebar-resizer-active" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={t("resize.sidebar")}
      aria-valuenow={width}
      aria-valuemin={SIDEBAR_WIDTH_MIN}
      aria-valuemax={SIDEBAR_WIDTH_MAX}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 24 : 12;
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          const next = clampSidebarWidth(width - step);
          onWidthChange(next);
          saveSidebarWidth(next);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          const next = clampSidebarWidth(width + step);
          onWidthChange(next);
          saveSidebarWidth(next);
        }
      }}
    />
  );
}
