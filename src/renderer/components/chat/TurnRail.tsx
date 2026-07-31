import { memo, useRef, useState } from "react";

export type ChatTurn = {
  id: string;
  summary: string;
};

type Props = {
  turns: ChatTurn[];
  activeId: string | null;
  label: string;
  onSelect: (id: string) => void;
};

/** Compact Codex-style map of user turns in the current transcript. */
export const TurnRail = memo(function TurnRail({
  turns,
  activeId,
  label,
  onSelect,
}: Props) {
  const railRef = useRef<HTMLElement>(null);
  const [hovered, setHovered] = useState<{
    turn: ChatTurn;
    top: number;
  } | null>(null);

  if (turns.length < 2) return null;

  function showSummary(turn: ChatTurn, marker: HTMLButtonElement) {
    const rail = railRef.current;
    if (!rail) return;
    const railRect = rail.getBoundingClientRect();
    const markerRect = marker.getBoundingClientRect();
    setHovered({
      turn,
      top: markerRect.top - railRect.top + markerRect.height / 2,
    });
  }

  return (
    <nav
      ref={railRef}
      className="chat-turn-rail"
      aria-label={label}
      onMouseLeave={() => setHovered(null)}
    >
      <div className="chat-turn-markers">
        {turns.map((turn) => (
          <button
            key={turn.id}
            type="button"
            className={
              turn.id === activeId
                ? "chat-turn-marker chat-turn-marker-active"
                : "chat-turn-marker"
            }
            aria-label={turn.summary}
            aria-current={turn.id === activeId ? "location" : undefined}
            onMouseEnter={(event) => showSummary(turn, event.currentTarget)}
            onFocus={(event) => showSummary(turn, event.currentTarget)}
            onBlur={() => setHovered(null)}
            onClick={() => onSelect(turn.id)}
          />
        ))}
      </div>
      {hovered ? (
        <div
          className="chat-turn-tooltip"
          role="tooltip"
          style={{ top: `${hovered.top}px` }}
        >
          {hovered.turn.summary}
        </div>
      ) : null}
    </nav>
  );
});
