import type { Dispatch, SetStateAction } from "react";
import type { TFunction } from "i18next";
import type {
  ConnectionState,
  ContextUsage,
  ModelState,
  PermissionMode,
  PermissionRequest,
} from "../../electron/preload";
import {
  applySessionUpdate,
  buildMessagesFromNotifications,
  finalizeHistory,
  markAssistantDone,
  uid,
} from "../lib/sessionUpdate";
import {
  isProvisionalSessionId,
  mergeLoadedSession,
  mergeSessionList,
  preferLastSessionCwd,
} from "../lib/sessionList";
import { localizeUiError } from "../lib/uiError";
import type { ChatMessage, LocalSession } from "../types/chat";

export type AgentSubscriptionApi = {
  getActiveId: () => string | null;
  setActiveId: (id: string | null) => void;
  setState: (st: ConnectionState) => void;
  setModels: Dispatch<SetStateAction<ModelState>>;
  /** Context-window gauge for one session; other sessions keep their values. */
  setContextUsage: (usage: ContextUsage) => void;
  setPermissionMode: (mode: PermissionMode) => void;
  setPermission: Dispatch<SetStateAction<PermissionRequest | null>>;
  setSessions: Dispatch<SetStateAction<LocalSession[]>>;
  setLoadingHistory: (v: boolean) => void;
  /**
   * False for a history load the user has already clicked past. Such events
   * still refresh that session's cached messages, but must not move focus or
   * touch the spinner belonging to the load the user is waiting for.
   */
  isSelectionCurrent: (sessionId: string) => boolean;
  setDefaultCwd: (cwd: string) => void;
  setCwd: (cwd: string) => void;
  syncComposerFromState: (st: ConnectionState) => void;
};

/**
 * Wire all main-process IPC events + auto-connect on mount.
 * Returns a cleanup function (cancel auto-connect + unsubscribe).
 */
export function attachAgentSubscriptions(
  api: AgentSubscriptionApi,
  t: TFunction<"translation">,
): () => void {
  if (!window.grok) {
    console.error(
      "[grok-gui] window.grok is missing — preload failed. UI will run in degraded mode.",
    );
    api.setState({
      status: "error",
      message: t("main.preloadMissing"),
    });
    return () => {};
  }

  const offs = [
    window.grok.onState((st) => {
      api.setState(st);
      api.syncComposerFromState(st);
    }),
    window.grok.onModels(api.setModels),
    window.grok.onContextUsage(api.setContextUsage),
    window.grok.onSessions(({ sessions: list, error, runningSessionIds }) => {
      // Don't wipe a good list if a later empty/error event races in.
      if (error && (!list || list.length === 0)) {
        console.warn("[grok-gui] session list error:", error);
        // Still reconcile spinners from main if provided.
        if (runningSessionIds) {
          const live = new Set(runningSessionIds);
          api.setSessions((prev) =>
            prev.map((s) => ({
              ...s,
              running: live.has(s.id),
            })),
          );
        }
        return;
      }
      api.setSessions((prev) =>
        mergeSessionList(prev, list ?? [], runningSessionIds ?? []),
      );
    }),
    window.grok.onHistoryStart(({ sessionId }) => {
      // Superseded load: keep filling its transcript, but leave focus alone.
      if (api.isSelectionCurrent(sessionId)) {
        api.setLoadingHistory(true);
        api.setActiveId(sessionId);
      }
      api.setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? { ...s, messages: [], historyReady: false, unreadDone: false }
            : s,
        ),
      );
    }),
    window.grok.onHistoryProgress(({ sessionId, messages: prebuilt }) => {
      if (!Array.isArray(prebuilt) || prebuilt.length === 0) return;
      api.setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? {
                ...s,
                messages: prebuilt as ChatMessage[],
                unreadDone: false,
              }
            : s,
        ),
      );
    }),
    window.grok.onHistoryEnd(
      ({ sessionId, error, retired, messages: prebuilt, notifications }) => {
        // A superseded load finishing must not clear the spinner of the load
        // the user is actually waiting for.
        if (api.isSelectionCurrent(sessionId)) api.setLoadingHistory(false);
        // Retired by a reconnect: no transcript to paint, and the row must
        // stay unloaded so the next click refetches it.
        if (retired) return;
        api.setSessions((prev) =>
          prev.map((s) => {
            if (s.id !== sessionId) return s;
            if (error) {
              return {
                ...s,
                historyReady: true,
                messages: [
                  {
                    id: uid("sys"),
                    role: "system",
                    text: localizeUiError(error, t),
                    createdAt: Date.now(),
                  },
                ],
              };
            }
            // Prefer main-process fold (small IPC + no renderer O(n²)).
            let messages: ChatMessage[];
            if (Array.isArray(prebuilt) && prebuilt.length > 0) {
              messages = prebuilt as ChatMessage[];
            } else if (notifications && notifications.length > 0) {
              messages = buildMessagesFromNotifications(notifications);
            } else {
              messages = finalizeHistory(s.messages);
            }
            if (messages.length === 0) {
              messages = [
                {
                  id: uid("sys"),
                  role: "system",
                  text: t("main.emptyHistory"),
                  createdAt: Date.now(),
                },
              ];
            }
            return { ...s, historyReady: true, messages, unreadDone: false };
          }),
        );
      },
    ),
    window.grok.onSessionLoaded(
      ({ sessionId, cwd: sessionCwd, isNew, isSideTask, worktree }) => {
        // A side task is registered in the shared session store, but it must not
        // steal focus from (or visually clear) the main chat.
        // First-send provisional rows (local:…) are upgraded to the real id —
        // only refocus when the user is still on that draft / this session.
        if (!isSideTask) {
          const current = api.getActiveId();
          if (
            !current ||
            current === sessionId ||
            isProvisionalSessionId(current)
          ) {
            api.setActiveId(sessionId);
            api.setCwd(sessionCwd);
          }
        }
        api.setSessions((prev) =>
          mergeLoadedSession(prev, {
            sessionId,
            cwd: sessionCwd,
            isNew,
            isSideTask,
            worktree,
          }),
        );
      },
    ),
    window.grok.onSessionUpdate((notification) => {
      const n = notification as { sessionId?: string };
      // Route by notification sessionId so background turns keep updating.
      const id = n.sessionId ?? api.getActiveId();
      if (!id) return;
      api.setSessions((prev) =>
        prev.map((s) =>
          s.id === id
            ? { ...s, messages: applySessionUpdate(s.messages, notification) }
            : s,
        ),
      );
    }),
    window.grok.onPermission(api.setPermission),
    window.grok.onPermissionTimeout(({ requestId }) => {
      api.setPermission((p) => (p?.requestId === requestId ? null : p));
    }),
    window.grok.onTurn((ev) => {
      const id = ev.sessionId;
      if (!id) return;
      if (ev.status === "started") {
        api.setSessions((prev) =>
          prev.map((s) =>
            s.id === id ? { ...s, running: true, unreadDone: false } : s,
          ),
        );
        return;
      }

      const focused = api.getActiveId() === id;
      api.setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== id) return s;
          let messages = markAssistantDone(s.messages);
          if (ev.status === "error") {
            messages = [
              ...messages,
              {
                id: uid("sys"),
                role: "system" as const,
                text: localizeUiError(ev.error, t),
                createdAt: Date.now(),
              },
            ];
          }
          return {
            ...s,
            running: false,
            // Blue dot only when work finished off-screen.
            unreadDone: !focused,
            messages,
          };
        }),
      );
    }),
  ];

  // Auto-connect so CLI sessions show up without an extra click.
  // Prefer sessions returned directly from connect() (not only events).
  let cancelled = false;

  void (async () => {
    try {
      const d = await window.grok!.getDefaultCwd();
      if (cancelled) return;
      api.setDefaultCwd(d);
      api.setCwd(d);

      const st = await window.grok!.getState();
      if (cancelled) return;

      if (st.status === "ready") {
        api.setState(st);
        const listed = await window.grok!.listSessions();
        if (cancelled) return;
        if (listed.ok && listed.sessions && listed.sessions.length > 0) {
          api.setSessions(
            mergeSessionList(
              [],
              listed.sessions,
              listed.runningSessionIds ?? [],
            ),
          );
          api.setCwd(preferLastSessionCwd(listed.sessions, d));
        }
        return;
      }

      const result = await window.grok!.connect(d);
      if (cancelled) return;
      api.setState(result);

      if (result.status === "ready") {
        if (result.sessions && result.sessions.length > 0) {
          // Fresh connect: no inherited sticky running flags.
          api.setSessions(mergeSessionList([], result.sessions, []));
          api.setCwd(preferLastSessionCwd(result.sessions, d));
        } else {
          const listed = await window.grok!.listSessions();
          if (cancelled) return;
          if (listed.ok && listed.sessions) {
            api.setSessions(
              mergeSessionList(
                [],
                listed.sessions,
                listed.runningSessionIds ?? [],
              ),
            );
            api.setCwd(preferLastSessionCwd(listed.sessions, d));
          }
        }
      } else if (result.status === "error") {
        console.error("[grok-gui] auto-connect failed:", result.message);
      }
    } catch (e) {
      if (!cancelled) {
        console.error("[grok-gui] auto-connect threw:", e);
      }
    }
  })();

  return () => {
    cancelled = true;
    offs.forEach((off) => off());
  };
}
