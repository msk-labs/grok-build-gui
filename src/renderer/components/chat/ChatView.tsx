import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent as ReactWheelEvent,
} from "react";
import type { ChatMessage } from "../../types/chat";
import type { MessageDisplayMode } from "../../lib/guiSettings";
import { findMessageIdForQuery } from "../../lib/chatSearch";
import type { OpenFileViewRequest } from "./FileChangeBar";
import { MessageBubble } from "./MessageBubble";
import { TurnRail, type ChatTurn } from "./TurnRail";
import { WorkingIndicator } from "./WorkingIndicator";
import { useTranslation } from "react-i18next";

/** Jump + highlight a message after global chat search (Codex-style). */
export type ChatSearchFocus = {
  /**
   * Target message id. Empty string = resolve first match of `query` after
   * history loads (agent FTS hits are session-level).
   */
  messageId: string;
  query: string;
  /** Bump to re-run scroll when selecting the same message again. */
  nonce: number;
};

type Props = {
  messages: ChatMessage[];
  emptyHint?: string;
  /** Session history is loading from the agent (Codex-style Working state). */
  loading?: boolean;
  /** Open a file/diff in the right split (Codex-style). */
  onOpenFile?: (req: OpenFileViewRequest) => void;
  /** Workspace root for Undo restore / path display. */
  workspaceRoot?: string;
  /** From session search modal: scroll to message and highlight query. */
  searchFocus?: ChatSearchFocus | null;
  onSearchFocusDone?: () => void;
  /** Assistant bodies: formatted markdown vs raw source. */
  messageDisplayMode?: MessageDisplayMode;
  /** Leave raw-markdown mode (floating exit control). */
  onExitMarkdownView?: () => void;
  /** Put a sent message's text back into the composer for editing. */
  onRewindToMessage?: (messageId: string) => void;
};

/** Distance from bottom (px) still treated as “pinned” for auto-scroll. */
const NEAR_BOTTOM_PX = 72;
/** Account for fractional scroll positions when selecting the final turn. */
const AT_BOTTOM_PX = 2;

function isNearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
}

function distanceFromBottom(el: HTMLElement): number {
  return el.scrollHeight - el.scrollTop - el.clientHeight;
}

function ArrowDownIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m5 12 7 7 7-7" />
      <path d="M12 5v14" />
    </svg>
  );
}

function scrollMessageIntoChat(
  container: HTMLElement,
  messageEl: HTMLElement,
): void {
  const cRect = container.getBoundingClientRect();
  const eRect = messageEl.getBoundingClientRect();
  const offset = eRect.top - cRect.top + container.scrollTop;
  const target = Math.max(0, offset - container.clientHeight * 0.28);
  container.scrollTo({ top: target, behavior: "smooth" });
}

function summarizeTurn(
  message: Extract<ChatMessage, { role: "user" }>,
  imageLabel: string,
  turnLabel: string,
): string {
  const text = message.text.replace(/\s+/g, " ").trim();
  if (text) return text.length > 72 ? `${text.slice(0, 72)}…` : text;
  const names = message.files?.map((file) => file.name).filter(Boolean) ?? [];
  if (names.length > 0) return names.join(", ");
  if (message.images?.length) return imageLabel;
  return turnLabel;
}

export function ChatView({
  messages,
  emptyHint,
  loading,
  onOpenFile,
  workspaceRoot,
  searchFocus,
  onSearchFocusDone,
  messageDisplayMode = "rendered",
  onExitMarkdownView,
  onRewindToMessage,
}: Props) {
  const { t } = useTranslation();
  const chatRef = useRef<HTMLDivElement>(null);
  /** When true, new content keeps the viewport pinned to the bottom. */
  const stickRef = useRef(true);
  /** Ignore scroll events while we programmatically jump to bottom. */
  const jumpingRef = useRef(false);
  /** A wheel-up gesture wins over streaming auto-scroll until bottom is reached again. */
  const userPausedRef = useRef(false);
  /** Prevent an onScroll at the old bottom from immediately undoing wheel pause. */
  const userLeftBottomRef = useRef(false);
  const [showJump, setShowJump] = useState(false);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const turnFrameRef = useRef<number | null>(null);
  const turnPositionsRef = useRef<Array<{ id: string; top: number }>>([]);
  /** First message id — session/list changes re-pin to bottom. */
  const firstIdRef = useRef<string | undefined>(messages[0]?.id);
  const lastFocusNonce = useRef<number | null>(null);
  const rootedOpenFile = useMemo(
    () =>
      onOpenFile
        ? (request: OpenFileViewRequest) =>
            onOpenFile({
              ...request,
              root: request.root ?? workspaceRoot,
            })
        : undefined,
    [onOpenFile, workspaceRoot],
  );
  const turns = useMemo<ChatTurn[]>(
    () =>
      messages
        .filter(
          (message): message is Extract<ChatMessage, { role: "user" }> =>
            message.role === "user",
        )
        .map((message, index) => ({
          id: message.id,
          summary: summarizeTurn(
            message,
            t("chat.imageTurn", { number: index + 1 }),
            t("chat.turnLabel", { number: index + 1 }),
          ),
        })),
    [messages, t],
  );

  const measureTurnPositions = useCallback(() => {
    const container = chatRef.current;
    if (!container) return;
    const rootTop = container.getBoundingClientRect().top;
    turnPositionsRef.current = turns.flatMap((turn) => {
      const safeId = turn.id.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const node = container.querySelector<HTMLElement>(
        `[data-message-id="${safeId}"]`,
      );
      return node
        ? [{
            id: turn.id,
            top:
              node.getBoundingClientRect().top -
              rootTop +
              container.scrollTop,
          }]
        : [];
    });
  }, [turns]);

  const syncActiveTurn = useCallback(() => {
    const container = chatRef.current;
    const positions = turnPositionsRef.current;
    if (!container || positions.length === 0) {
      setActiveTurnId(null);
      return;
    }
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceFromBottom <= AT_BOTTOM_PX) {
      const last = positions[positions.length - 1]!.id;
      setActiveTurnId((previous) => (previous === last ? previous : last));
      return;
    }
    const anchor = container.scrollTop + container.clientHeight * 0.3;
    let low = 0;
    let high = positions.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (positions[mid]!.top <= anchor) low = mid;
      else high = mid - 1;
    }
    const current = positions[low]!.id;
    setActiveTurnId((previous) => (previous === current ? previous : current));
  }, []);

  const scheduleTurnSync = useCallback(() => {
    if (turnFrameRef.current != null) return;
    turnFrameRef.current = window.requestAnimationFrame(() => {
      turnFrameRef.current = null;
      syncActiveTurn();
    });
  }, [syncActiveTurn]);

  const pinToBottom = useCallback(() => {
    userPausedRef.current = false;
    userLeftBottomRef.current = false;
    stickRef.current = true;
    setShowJump(false);
    jumpingRef.current = true;
    const el = chatRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
    // Smooth scroll fires intermediate onScroll; hold the pin until settled.
    window.setTimeout(() => {
      jumpingRef.current = false;
      stickRef.current = true;
      setShowJump(false);
      const node = chatRef.current;
      if (node) node.scrollTop = node.scrollHeight;
      scheduleTurnSync();
    }, 320);
  }, [scheduleTurnSync]);

  const onScroll = useCallback(() => {
    if (jumpingRef.current) return;
    const el = chatRef.current;
    if (!el) return;
    const distance = distanceFromBottom(el);
    if (userPausedRef.current) {
      if (distance > AT_BOTTOM_PX) {
        userLeftBottomRef.current = true;
      } else if (userLeftBottomRef.current) {
        userPausedRef.current = false;
        userLeftBottomRef.current = false;
        stickRef.current = true;
        setShowJump(false);
        scheduleTurnSync();
        return;
      }
      stickRef.current = false;
      setShowJump(distance > AT_BOTTOM_PX && messages.length > 0);
      scheduleTurnSync();
      return;
    }
    const near = isNearBottom(el);
    stickRef.current = near;
    setShowJump(!near && messages.length > 0);
    scheduleTurnSync();
  }, [messages.length, scheduleTurnSync]);

  const onWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      if (event.deltaY >= 0) return;
      const el = chatRef.current;
      if (!el) return;
      userPausedRef.current = true;
      userLeftBottomRef.current = distanceFromBottom(el) > AT_BOTTOM_PX;
      stickRef.current = false;
      jumpingRef.current = false;
      // Abort a smooth "jump to bottom" before its next animation frame can
      // counteract the user's upward wheel gesture.
      el.scrollTo({ top: el.scrollTop, behavior: "auto" });
      setShowJump(messages.length > 0);
      scheduleTurnSync();
    },
    [messages.length, scheduleTurnSync],
  );

  const selectTurn = useCallback((id: string) => {
    const container = chatRef.current;
    if (!container) return;
    const safeId = id.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const node = container.querySelector<HTMLElement>(
      `[data-message-id="${safeId}"]`,
    );
    if (!node) return;
    userPausedRef.current = true;
    userLeftBottomRef.current = true;
    stickRef.current = false;
    setShowJump(true);
    setActiveTurnId(id);
    jumpingRef.current = true;
    scrollMessageIntoChat(container, node);
    window.setTimeout(() => {
      jumpingRef.current = false;
      scheduleTurnSync();
    }, 400);
  }, [scheduleTurnSync]);

  // New session / cleared thread → re-enable stick-to-bottom.
  useEffect(() => {
    const firstId = messages[0]?.id;
    if (firstId !== firstIdRef.current) {
      firstIdRef.current = firstId;
      userPausedRef.current = false;
      userLeftBottomRef.current = false;
      stickRef.current = true;
      setShowJump(false);
    }
    const frame = window.requestAnimationFrame(() => {
      measureTurnPositions();
      scheduleTurnSync();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, measureTurnPositions, scheduleTurnSync]);

  useEffect(
    () => () => {
      if (turnFrameRef.current != null) {
        window.cancelAnimationFrame(turnFrameRef.current);
      }
    },
    [],
  );

  // Codex search jump: wait for the message node (history may still load).
  // Agent FTS hits omit messageId — resolve the first text match after load.
  useEffect(() => {
    if (!searchFocus) return;
    if (lastFocusNonce.current === searchFocus.nonce) return;
    if (loading) return;

    const resolvedId =
      searchFocus.messageId.trim() ||
      findMessageIdForQuery(messages, searchFocus.query) ||
      "";
    if (!resolvedId) {
      // History still empty — re-run when `messages` / `loading` change.
      // Messages loaded but no text match — stop retrying this focus nonce.
      if (messages.length > 0) {
        lastFocusNonce.current = searchFocus.nonce;
      }
      return;
    }

    const container = chatRef.current;
    if (!container) return;

    const tryScroll = (): boolean => {
      // Avoid CSS.escape edge cases; ids are app-generated but keep quotes safe.
      const safeId = resolvedId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const node = container.querySelector<HTMLElement>(
        `[data-message-id="${safeId}"]`,
      );
      if (!node) return false;
      userPausedRef.current = true;
      userLeftBottomRef.current = true;
      stickRef.current = false;
      setShowJump(true);
      jumpingRef.current = true;
      scrollMessageIntoChat(container, node);
      lastFocusNonce.current = searchFocus.nonce;
      window.setTimeout(() => {
        jumpingRef.current = false;
      }, 400);
      onSearchFocusDone?.();
      return true;
    };

    if (tryScroll()) return;

    let attempts = 0;
    const id = window.setInterval(() => {
      attempts += 1;
      if (tryScroll() || attempts > 40) {
        window.clearInterval(id);
        if (attempts > 40) lastFocusNonce.current = searchFocus.nonce;
      }
    }, 50);
    return () => window.clearInterval(id);
  }, [searchFocus, messages, loading, onSearchFocusDone]);

  // Scroll only the chat pane — never use scrollIntoView (it walks ancestors
  // and can yank the sidebar / whole window when history loads).
  // Only auto-scroll while the user is pinned to the bottom.
  useEffect(() => {
    if (!stickRef.current) return;
    // Don't fight a pending search jump to an older message.
    if (searchFocus && lastFocusNonce.current !== searchFocus.nonce) return;
    const el = chatRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, loading, searchFocus]);

  // Content height can grow without a messages identity change (images, folds).
  useEffect(() => {
    const el = chatRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      measureTurnPositions();
      scheduleTurnSync();
      if (!stickRef.current) return;
      el.scrollTop = el.scrollHeight;
    });
    const inner = el.firstElementChild;
    if (inner) ro.observe(inner);
    return () => ro.disconnect();
  }, [messages.length, loading, measureTurnPositions, scheduleTurnSync]);

  const hasMessages = messages.length > 0;
  const showJumpBtn = showJump && hasMessages && !loading;

  const resolvedSearchMessageId =
    searchFocus == null
      ? ""
      : searchFocus.messageId.trim() ||
        findMessageIdForQuery(messages, searchFocus.query) ||
        "";

  if (loading && messages.length === 0) {
    return (
      <div className="chat-shell">
        <div
          className="chat"
          ref={chatRef}
          onScroll={onScroll}
          onWheel={onWheel}
        >
          <div className="chat-inner chat-status">
            <WorkingIndicator label={t("common.loading")} />
            {emptyHint ? <p className="chat-status-hint">{emptyHint}</p> : null}
          </div>
        </div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="chat-shell">
        <div
          className="chat"
          ref={chatRef}
          onScroll={onScroll}
          onWheel={onWheel}
        >
          <div className="empty-state">
            <h1>{t("main.whatBuild")}</h1>
            <p>
              {emptyHint ??
                t("main.controlPlaneHelp")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-shell">
      <div
        className="chat"
        ref={chatRef}
        onScroll={onScroll}
        onWheel={onWheel}
      >
        <div className="chat-inner">
          {messages.map((m) => {
            const focused =
              searchFocus != null &&
              resolvedSearchMessageId.length > 0 &&
              resolvedSearchMessageId === m.id;
            return (
              <MessageBubble
                key={m.id}
                message={m}
                onOpenFile={rootedOpenFile}
                workspaceRoot={workspaceRoot}
                highlightQuery={focused ? searchFocus.query : null}
                searchFocus={focused}
                messageDisplayMode={messageDisplayMode}
                onRewind={onRewindToMessage}
              />
            );
          })}
        </div>
      </div>
      <TurnRail
        turns={turns}
        activeId={activeTurnId}
        label={t("chat.turnNavigation")}
        onSelect={selectTurn}
      />
      {messageDisplayMode === "raw" && onExitMarkdownView ? (
        <button
          type="button"
          className="chat-exit-markdown"
          onClick={onExitMarkdownView}
        >
          {t("main.exitMarkdown")}
        </button>
      ) : null}
      {showJumpBtn ? (
        <button
          type="button"
          className="chat-jump-bottom"
          onClick={pinToBottom}
          title={t("main.scrollBottom")}
          aria-label={t("main.scrollBottomAria")}
        >
          <ArrowDownIcon />
        </button>
      ) : null}
    </div>
  );
}
