import { useEffect, useMemo, useRef, useState } from "react";
import type { LocalSession } from "../../types/chat";
import {
  agentHitsToChatSearchHits,
  mergeChatSearchHits,
  searchChats,
  type ChatSearchHit,
} from "../../lib/chatSearch";
import { createImeCompositionLatch, isImeKeyEvent } from "../../lib/imeKeys";
import { SearchIcon, XIcon } from "./icons";
import { useTranslation } from "react-i18next";
import type { TranslationKey } from "../../locales/en";
import { isPlaceholderSessionTitle } from "../../lib/sessionTitle";

type Props = {
  open: boolean;
  sessions: LocalSession[];
  excludedSessionIds?: string[];
  onClose: () => void;
  onSelectHit: (hit: ChatSearchHit) => void;
};

const DEBOUNCE_MS = 280;
const BOOTSTRAP_RETRY_MS = 2500;
const BOOTSTRAP_DEADLINE_MS = 30_000;

function roleLabel(role?: string): TranslationKey {
  if (role === "user") return "search.roleYou";
  if (role === "assistant") return "search.roleAssistant";
  if (role === "system") return "search.roleSystem";
  return "search.roleChat";
}

function kindLabel(hit: ChatSearchHit): TranslationKey {
  if (hit.kind === "title") return "search.kindTitle";
  if (hit.kind === "content") return "search.kindContent";
  return roleLabel(hit.role);
}

export function SessionSearchModal({
  open,
  sessions,
  excludedSessionIds = [],
  onClose,
  onSelectHit,
}: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const [agentHits, setAgentHits] = useState<ChatSearchHit[]>([]);
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentBootstrapping, setAgentBootstrapping] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  /** Monotonic id so stale async replies are ignored. */
  const searchSeq = useRef(0);
  /** IME latch so Enter confirming candidates does not select a hit. */
  const imeLatch = useRef(createImeCompositionLatch(100));

  const localHits = useMemo(
    () => (open ? searchChats(sessions, query) : []),
    [open, sessions, query],
  );
  const excludedIds = useMemo(
    () => new Set(excludedSessionIds),
    [excludedSessionIds],
  );

  const hits = useMemo(
    () => mergeChatSearchHits(localHits, agentHits),
    [localHits, agentHits],
  );

  // Reset when opened.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIdx(0);
    setAgentHits([]);
    setAgentLoading(false);
    setAgentBootstrapping(false);
    setAgentError(null);
    searchSeq.current += 1;
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query, hits.length]);

  // Debounced agent FTS (TUI deep search). Retries while index bootstraps.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setAgentHits([]);
      setAgentLoading(false);
      setAgentBootstrapping(false);
      setAgentError(null);
      searchSeq.current += 1;
      return;
    }
    if (!window.grok?.searchSessions) {
      setAgentHits([]);
      setAgentLoading(false);
      setAgentBootstrapping(false);
      setAgentError(null);
      return;
    }

    const seq = ++searchSeq.current;
    setAgentLoading(true);
    setAgentError(null);

    let cancelled = false;
    let retryTimer: number | undefined;
    const startedAt = Date.now();

    const run = async () => {
      try {
        const res = await window.grok!.searchSessions!({
          query: q,
          limit: 40,
          includeContent: true,
        });
        if (cancelled || seq !== searchSeq.current) return;

        if (!res.ok) {
          setAgentHits([]);
          setAgentBootstrapping(false);
          setAgentError(res.error || t("search.failed"));
          setAgentLoading(false);
          return;
        }

        setAgentHits(
          agentHitsToChatSearchHits(res.results, q).filter(
            (hit) => !excludedIds.has(hit.sessionId),
          ),
        );
        setAgentBootstrapping(Boolean(res.bootstrapping));
        setAgentError(null);

        if (
          res.bootstrapping &&
          Date.now() - startedAt < BOOTSTRAP_DEADLINE_MS
        ) {
          setAgentLoading(true);
          retryTimer = window.setTimeout(() => {
            void run();
          }, BOOTSTRAP_RETRY_MS);
          return;
        }
        setAgentLoading(false);
      } catch (e) {
        if (cancelled || seq !== searchSeq.current) return;
        setAgentHits([]);
        setAgentBootstrapping(false);
        setAgentError(e instanceof Error ? e.message : String(e));
        setAgentLoading(false);
      }
    };

    const debounce = window.setTimeout(() => {
      void run();
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(debounce);
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [open, query, excludedIds, t]);

  // Keep keyboard selection in view.
  useEffect(() => {
    if (!open) return;
    const root = listRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>(
      `[data-search-idx="${activeIdx}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx, open, hits.length]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      // While IME is composing / confirming a candidate, only Esc may act.
      if (imeLatch.current.shouldIgnoreKey(e) || isImeKeyEvent(e)) {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, Math.max(hits.length - 1, 0)));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" && hits[activeIdx]) {
        e.preventDefault();
        onSelectHit(hits[activeIdx]!);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, hits, activeIdx, onClose, onSelectHit]);

  if (!open) return null;

  const q = query.trim();
  const showStatus =
    agentLoading || agentBootstrapping || (agentError && q.length > 0);

  return (
    <div
      className="modal-backdrop search-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t("search.title")}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="search-modal">
        <div className="search-modal-header">
          <div className="search-modal-field">
            <SearchIcon />
            <input
              ref={inputRef}
              type="search"
              className="search-modal-input"
              placeholder={t("search.placeholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onCompositionStart={() => imeLatch.current.onCompositionStart()}
              onCompositionEnd={() => imeLatch.current.onCompositionEnd()}
              autoComplete="off"
              spellCheck={false}
              aria-label={t("search.title")}
            />
            {q ? (
              <button
                type="button"
                className="search-modal-clear"
                onClick={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
                title={t("common.clear")}
                aria-label={t("search.clear")}
              >
                <XIcon />
              </button>
            ) : null}
          </div>
          <button
            type="button"
            className="btn btn-ghost search-modal-close"
            onClick={onClose}
          >
            Esc
          </button>
        </div>

        <div className="search-modal-body" ref={listRef}>
          {!q ? (
            <div className="search-modal-empty">
              <p>{t("search.help")}</p>
              <p className="search-modal-hint">
                {t("search.detail")}
              </p>
            </div>
          ) : hits.length === 0 && !agentLoading ? (
            <div className="search-modal-empty">
              <p>{t("search.noResults", { query: q })}</p>
              {agentError ? (
                <p className="search-modal-hint">{agentError}</p>
              ) : null}
            </div>
          ) : hits.length === 0 && agentLoading ? (
            <div className="search-modal-empty">
              <p>
                {agentBootstrapping
                  ? t("search.buildingIndex")
                  : t("search.searching")}
              </p>
            </div>
          ) : (
            <>
              {showStatus ? (
                <p className="search-modal-status" role="status">
                  {agentError
                    ? t("search.agentError", { error: agentError })
                    : agentBootstrapping
                      ? t("search.indexing")
                      : agentLoading
                        ? t("search.searching")
                        : null}
                </p>
              ) : null}
              <ul className="search-modal-list" role="listbox">
                {hits.map((hit, idx) => {
                  const sessionTitle = isPlaceholderSessionTitle(
                    hit.sessionTitle,
                  )
                    ? t("nav.untitledSession")
                    : hit.sessionTitle;
                  const snippet = isPlaceholderSessionTitle(hit.snippet)
                    ? t("nav.untitledSession")
                    : hit.snippet;
                  return (
                    <li key={hit.id}>
                    <button
                      type="button"
                      className={
                        idx === activeIdx
                          ? "search-modal-item search-modal-item-active"
                          : "search-modal-item"
                      }
                      data-search-idx={idx}
                      role="option"
                      aria-selected={idx === activeIdx}
                      onMouseEnter={() => setActiveIdx(idx)}
                      onClick={() => onSelectHit(hit)}
                    >
                      <div className="search-modal-item-top">
                        <span className="search-modal-item-title">
                          {sessionTitle}
                        </span>
                        <span className="search-modal-item-meta">
                          {t(kindLabel(hit))}
                          {hit.projectName ? ` · ${hit.projectName}` : ""}
                        </span>
                      </div>
                      <div className="search-modal-item-snippet">
                        {snippet}
                      </div>
                    </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
