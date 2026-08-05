import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatAssistantTranscript } from "../../lib/assistantTranscript";
import type { MessageDisplayMode } from "../../lib/guiSettings";
import type { ChatMessage } from "../../types/chat";
import { AssistantTimeline } from "./AssistantTimeline";
import type { OpenFileViewRequest } from "./FileChangeBar";
import { CollapsibleUserText } from "./CollapsibleUserText";
import { copyText } from "./copyText";
import { HighlightText } from "./HighlightText";
import { ImageLightbox, type LightboxImage } from "./ImageLightbox";
import { WorkingIndicator } from "./WorkingIndicator";

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatMessageTime(ts: number, locale: string): string {
  const date = new Date(ts);
  const timeOpts: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
  };
  if (isSameLocalDay(date, new Date())) {
    return date.toLocaleTimeString(locale, timeOpts);
  }
  return date.toLocaleString(locale, {
    month: "short",
    day: "numeric",
    ...timeOpts,
  });
}

function CopyIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function RewindIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

export function UserMessage({
  message: m,
  highlightQuery,
  searchFocus,
  messageDisplayMode = "rendered",
  onRewind,
}: {
  message: Extract<ChatMessage, { role: "user" }>;
  highlightQuery?: string | null;
  searchFocus?: boolean;
  messageDisplayMode?: MessageDisplayMode;
  /** Copy this message's text back into the composer for editing. */
  onRewind?: (messageId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language;
  const [lightbox, setLightbox] = useState<LightboxImage | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canCopy = Boolean(m.text?.trim());
  const raw = messageDisplayMode === "raw";

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  const onCopy = useCallback(async () => {
    if (!m.text?.trim()) return;
    try {
      await copyText(m.text);
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }, [m.text]);

  return (
    <article
      className={
        searchFocus ? "message user message-search-focus" : "message user"
      }
      data-message-id={m.id}
    >
      <div className="message-stack">
        {m.images && m.images.length > 0 ? (
          <div className="message-images">
            {m.images.map((img) => (
              <button
                key={img.id}
                type="button"
                className="message-image-link"
                title={t("tools.openImage")}
                aria-label={t("tools.openImage")}
                onClick={() =>
                  setLightbox({
                    src: img.dataUrl,
                    filename: img.name,
                    alt: img.name || t("tools.attachedImage"),
                  })
                }
              >
                <img
                  src={img.dataUrl}
                  alt={img.name || t("tools.attachedImage")}
                  className="message-image"
                  draggable={false}
                />
              </button>
            ))}
          </div>
        ) : null}
        {m.text ? (
          <div className="message-body">
            {raw ? (
              <pre className="message-markdown-raw">
                <HighlightText text={m.text} query={highlightQuery} />
              </pre>
            ) : (
              <CollapsibleUserText text={m.text} query={highlightQuery} />
            )}
          </div>
        ) : null}
        <div className="user-message-meta">
          <time
            className="user-message-time"
            dateTime={new Date(m.createdAt).toISOString()}
          >
            {formatMessageTime(m.createdAt, language)}
          </time>
          {canCopy ? (
            <button
              type="button"
              className="user-message-copy"
              onClick={() => void onCopy()}
              title={copied ? t("chat.copied") : t("chat.copy")}
              aria-label={copied ? t("chat.copied") : t("chat.copy")}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </button>
          ) : null}
          {onRewind && canCopy ? (
            <button
              type="button"
              className="user-message-rewind"
              onClick={() => onRewind(m.id)}
              title={t("chat.rewindToHere")}
              aria-label={t("chat.rewindToHere")}
            >
              <RewindIcon />
            </button>
          ) : null}
        </div>
      </div>
      {lightbox ? (
        <ImageLightbox image={lightbox} onClose={() => setLightbox(null)} />
      ) : null}
    </article>
  );
}

export function SystemMessage({
  message: m,
  highlightQuery,
  searchFocus,
}: {
  message: Extract<ChatMessage, { role: "system" }>;
  highlightQuery?: string | null;
  searchFocus?: boolean;
}) {
  return (
    <article
      className={
        searchFocus
          ? "message system message-search-focus"
          : "message system"
      }
      data-message-id={m.id}
    >
      <div className="message-stack">
        <div className="message-body">
          <HighlightText text={m.text} query={highlightQuery} />
        </div>
      </div>
    </article>
  );
}

export function AssistantMessage({
  message: m,
  onOpenFile,
  workspaceRoot,
  highlightQuery,
  searchFocus,
  messageDisplayMode = "rendered",
}: {
  message: Extract<ChatMessage, { role: "assistant" }>;
  onOpenFile?: (req: OpenFileViewRequest) => void;
  workspaceRoot?: string;
  highlightQuery?: string | null;
  searchFocus?: boolean;
  messageDisplayMode?: MessageDisplayMode;
}) {
  const blocks = m.blocks ?? [];
  const transcript = useMemo(
    () => formatAssistantTranscript(blocks),
    [blocks],
  );

  return (
    <article
      className={
        searchFocus
          ? "message assistant message-search-focus"
          : "message assistant"
      }
      data-message-id={m.id}
    >
      <div className="message-stack">
        {messageDisplayMode === "raw" ? (
          <div className="message-body message-final">
            {transcript ? (
              <pre
                className={`message-markdown-raw${m.streaming ? " is-streaming" : ""}`}
              >
                <HighlightText text={transcript} query={highlightQuery} />
              </pre>
            ) : m.streaming ? (
              <WorkingIndicator />
            ) : null}
          </div>
        ) : (
          <AssistantTimeline
            blocks={blocks}
            streaming={m.streaming}
            createdAt={m.createdAt}
            finishedAt={m.finishedAt}
            artifacts={m.artifacts}
            onOpenFile={onOpenFile}
            workspaceRoot={workspaceRoot}
            highlightQuery={highlightQuery}
          />
        )}
      </div>
    </article>
  );
}

export function MessageBubble({
  message: m,
  onOpenFile,
  workspaceRoot,
  highlightQuery,
  searchFocus,
  messageDisplayMode = "rendered",
  onRewind,
}: {
  message: ChatMessage;
  onOpenFile?: (req: OpenFileViewRequest) => void;
  workspaceRoot?: string;
  highlightQuery?: string | null;
  searchFocus?: boolean;
  messageDisplayMode?: MessageDisplayMode;
  onRewind?: (messageId: string) => void;
}) {
  if (m.role === "user") {
    return (
      <UserMessage
        message={m}
        highlightQuery={highlightQuery}
        searchFocus={searchFocus}
        messageDisplayMode={messageDisplayMode}
        onRewind={onRewind}
      />
    );
  }
  if (m.role === "system") {
    return (
      <SystemMessage
        message={m}
        highlightQuery={highlightQuery}
        searchFocus={searchFocus}
      />
    );
  }
  return (
    <AssistantMessage
      message={m}
      onOpenFile={onOpenFile}
      workspaceRoot={workspaceRoot}
      highlightQuery={highlightQuery}
      searchFocus={searchFocus}
      messageDisplayMode={messageDisplayMode}
    />
  );
}
