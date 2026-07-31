import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { clampPanelSize, savePanelSize, sizeLimits } from "./size";
import type { SplitPlacement } from "./types";
import { useTranslation } from "react-i18next";

type Props = {
  placement: SplitPlacement;
  size: number;
  /** Hot path: update the panel element directly without rendering React. */
  onSizePreview: (px: number) => void;
  /** Commit once when dragging or keyboard adjustment finishes. */
  onSizeCommit: (px: number) => void;
};

/**
 * Edge drag handle: left edge for right panel, top edge for bottom panel.
 * Pointer moves stay outside React's render path, matching Codex's panel drag.
 */
export function SplitResizer({
  placement,
  size,
  onSizePreview,
  onSizeCommit,
}: Props) {
  const { t } = useTranslation();
  const [dragging, setDragging] = useState(false);
  const handleRef = useRef<HTMLDivElement | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const startPtr = useRef(0);
  const startSize = useRef(size);
  const sizeRef = useRef(size);
  if (!dragging) sizeRef.current = size;

  const vertical = placement === "right";
  const limits = sizeLimits(placement);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      pointerIdRef.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
      startPtr.current = vertical ? event.clientX : event.clientY;
      startSize.current = sizeRef.current;
      setDragging(true);
    },
    [vertical],
  );

  useEffect(() => {
    if (!dragging) return;
    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.cursor = vertical ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerIdRef.current) return;
      const delta = vertical
        ? startPtr.current - event.clientX
        : startPtr.current - event.clientY;
      const next = clampPanelSize(placement, startSize.current + delta);
      if (next === sizeRef.current) return;
      sizeRef.current = next;
      onSizePreview(next);
    };

    const finish = (event: PointerEvent) => {
      if (event.pointerId !== pointerIdRef.current) return;
      const pointerId = pointerIdRef.current;
      pointerIdRef.current = null;
      if (pointerId != null && handleRef.current?.hasPointerCapture(pointerId)) {
        handleRef.current.releasePointerCapture(pointerId);
      }
      savePanelSize(placement, sizeRef.current);
      onSizeCommit(sizeRef.current);
      setDragging(false);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
    };
  }, [
    dragging,
    onSizeCommit,
    onSizePreview,
    placement,
    vertical,
  ]);

  const growKey = vertical ? "ArrowLeft" : "ArrowUp";
  const shrinkKey = vertical ? "ArrowRight" : "ArrowDown";

  const commitKeyboardSize = (next: number) => {
    sizeRef.current = next;
    onSizePreview(next);
    onSizeCommit(next);
    savePanelSize(placement, next);
  };

  return (
    <div
      ref={handleRef}
      className={`split-panel-resizer${dragging ? " split-panel-resizer-active" : ""}`}
      role="separator"
      aria-orientation={vertical ? "vertical" : "horizontal"}
      aria-label={
        placement === "right" ? t("tools.resizeRight") : t("tools.resizeBottom")
      }
      aria-valuenow={size}
      aria-valuemin={limits.min}
      aria-valuemax={limits.max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 24 : 12;
        if (event.key === growKey) {
          event.preventDefault();
          commitKeyboardSize(clampPanelSize(placement, size + step));
        } else if (event.key === shrinkKey) {
          event.preventDefault();
          commitKeyboardSize(clampPanelSize(placement, size - step));
        }
      }}
    />
  );
}
