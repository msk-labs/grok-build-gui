// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../lib/i18n";
import { useGrokApp } from "./useGrokApp";

type Listener = (payload: unknown) => void;

/** IPC callbacks the hook registered, so tests can drive main-process events. */
const listeners = new Map<string, Listener>();

const READY = { status: "ready" as const, sessions: [] };

/** Shape of an agent session row as `agent:sessions` delivers it. */
function summary(id: string) {
  return {
    sessionId: id,
    title: id,
    cwd: "/w",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastActiveAt: "2026-01-01T00:00:00.000Z",
  };
}

/**
 * Minimal main-process stub. `on*` records its callback and returns an
 * unsubscribe; every other method resolves to a benign value. `loadSession`
 * deliberately never emits history events — tests drive those by hand so the
 * "load still in flight" window can be held open.
 */
function installGrokStub() {
  listeners.clear();
  const target: Record<string, unknown> = {
    getDefaultCwd: async () => "/w",
    getTaskWorkspaceRoot: async () => "/w/tasks",
    getState: async () => READY,
    listSessions: async () => ({ ok: true, sessions: [], runningSessionIds: [] }),
    loadSession: async () => READY,
    focusSession: async () => ({ ok: true }),
    connect: async () => READY,
  };
  (window as unknown as { grok: unknown }).grok = new Proxy(target, {
    get(t, prop: string) {
      if (prop in t) return t[prop];
      if (prop.startsWith("on")) {
        return (cb: Listener) => {
          listeners.set(prop, cb);
          return () => listeners.delete(prop);
        };
      }
      return async () => ({ ok: true });
    },
    has: () => true,
  });
  return target;
}

function emit(event: string, payload: unknown) {
  listeners.get(event)?.(payload);
}

/** Land a session in the sidebar with a finished transcript. */
async function seedReadySession(id: string) {
  await act(async () => {
    emit("onSessions", {
      sessions: [summary(id)],
      runningSessionIds: [],
    });
  });
  await act(async () => {
    emit("onHistoryStart", { sessionId: id, cwd: "/w" });
    emit("onHistoryEnd", {
      sessionId: id,
      cwd: "/w",
      messages: [{ id: `m-${id}`, role: "user", text: "hi", createdAt: 1 }],
    });
  });
}

describe("useGrokApp session switching", () => {
  beforeEach(() => {
    installGrokStub();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("settles the spinner when a click lands before React re-rendered", async () => {
    const { result } = renderHook(() => useGrokApp());
    await waitFor(() => expect(result.current.state.status).toBe("ready"));

    await seedReadySession("ready-session");
    // A second row that has never been loaded — selecting it starts a load.
    await act(async () => {
      emit("onSessions", {
        sessions: [summary("ready-session"), summary("slow-session")],
        runningSessionIds: [],
      });
    });
    expect(result.current.loadingHistory).toBe(false);

    // Both clicks share one render closure, so the second sees the stale
    // `activeId` — exactly what rapid sidebar clicking produces.
    await act(async () => {
      void result.current.handleSelect("slow-session");
      void result.current.handleSelect("ready-session");
    });

    await waitFor(() =>
      expect(result.current.loadingHistory).toBe(false),
    );
    expect(result.current.activeId).toBe("ready-session");
  });

  it("ignores history events from a load the user clicked past", async () => {
    const { result } = renderHook(() => useGrokApp());
    await waitFor(() => expect(result.current.state.status).toBe("ready"));

    await seedReadySession("ready-session");
    await act(async () => {
      emit("onSessions", {
        sessions: [summary("ready-session"), summary("slow-session")],
        runningSessionIds: [],
      });
    });

    await act(async () => {
      void result.current.handleSelect("slow-session");
    });
    await act(async () => {
      void result.current.handleSelect("ready-session");
    });

    // The superseded load finally reports in — it must not steal focus back.
    await act(async () => {
      emit("onHistoryStart", { sessionId: "slow-session", cwd: "/w" });
      emit("onHistoryEnd", {
        sessionId: "slow-session",
        cwd: "/w",
        messages: [{ id: "m2", role: "user", text: "late", createdAt: 2 }],
      });
    });

    expect(result.current.activeId).toBe("ready-session");
    expect(result.current.loadingHistory).toBe(false);
  });

  it("deletes the real session and skips prompt when its provisional row was deleted", async () => {
    let resolveNewSession!: (
      value: typeof READY & { sessionId: string; cwd: string },
    ) => void;
    const newSession = vi.fn(
      () =>
        new Promise<typeof READY & { sessionId: string; cwd: string }>(
          (resolve) => {
            resolveNewSession = resolve;
          },
        ),
    );
    const deleteSession = vi.fn(async () => ({ ok: true }));
    const prompt = vi.fn(async () => ({ ok: true }));
    Object.assign(window.grok!, { newSession, deleteSession, prompt });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const { result } = renderHook(() => useGrokApp());
    await waitFor(() => expect(result.current.state.status).toBe("ready"));

    act(() => result.current.setInput("create then delete"));
    let submit!: Promise<void>;
    act(() => {
      submit = result.current.handleSubmit();
    });
    await waitFor(() =>
      expect(result.current.activeId).toMatch(/^local:/),
    );
    const provisionalId = result.current.activeId!;
    expect(newSession).toHaveBeenCalledWith("/w", null, provisionalId);

    await act(async () => {
      await result.current.handleDelete(provisionalId);
    });
    expect(result.current.sessions).toHaveLength(0);

    await act(async () => {
      emit("onSessionLoaded", {
        sessionId: "real-session",
        cwd: "/w",
        isNew: true,
        clientRequestId: provisionalId,
      });
    });
    expect(result.current.sessions).toHaveLength(0);

    await act(async () => {
      resolveNewSession({ ...READY, sessionId: "real-session", cwd: "/w" });
      await submit;
    });

    expect(deleteSession).toHaveBeenCalledWith("real-session");
    expect(prompt).not.toHaveBeenCalled();
    expect(result.current.sessions).toHaveLength(0);
  });

  it("ignores late history and list events after deleting a loading session", async () => {
    const deleteSession = vi.fn(async () => ({ ok: true }));
    Object.assign(window.grok!, { deleteSession });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const { result } = renderHook(() => useGrokApp());
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    await act(async () => {
      emit("onSessions", {
        sessions: [summary("loading-session")],
        runningSessionIds: [],
      });
      await result.current.handleSelect("loading-session");
    });
    expect(result.current.loadingHistory).toBe(true);

    await act(async () => {
      await result.current.handleDelete("loading-session");
    });
    expect(result.current.sessions).toHaveLength(0);

    await act(async () => {
      emit("onHistoryEnd", {
        sessionId: "loading-session",
        cwd: "/w",
        messages: [{ id: "late", role: "user", text: "late", createdAt: 1 }],
      });
      emit("onSessionLoaded", {
        sessionId: "loading-session",
        cwd: "/w",
        isNew: false,
      });
      emit("onSessions", {
        sessions: [summary("loading-session")],
        runningSessionIds: [],
      });
    });

    expect(result.current.sessions).toHaveLength(0);
    expect(result.current.activeId).toBeNull();
    expect(result.current.loadingHistory).toBe(false);
  });

  it("keeps unsent composer text and images per session when switching", async () => {
    const { result } = renderHook(() => useGrokApp());
    await waitFor(() => expect(result.current.state.status).toBe("ready"));

    await seedReadySession("session-a");
    await seedReadySession("session-b");

    await act(async () => {
      await result.current.handleSelect("session-a");
    });
    expect(result.current.activeId).toBe("session-a");

    await act(async () => {
      result.current.setInput("draft for A");
    });
    expect(result.current.input).toBe("draft for A");

    await act(async () => {
      await result.current.handleSelect("session-b");
    });
    expect(result.current.activeId).toBe("session-b");
    expect(result.current.input).toBe("");

    await act(async () => {
      result.current.setInput("draft for B");
    });
    expect(result.current.input).toBe("draft for B");

    await act(async () => {
      await result.current.handleSelect("session-a");
    });
    expect(result.current.activeId).toBe("session-a");
    expect(result.current.input).toBe("draft for A");

    await act(async () => {
      await result.current.handleSelect("session-b");
    });
    expect(result.current.input).toBe("draft for B");
  });

  it("does not leak a session draft into a new chat", async () => {
    const { result } = renderHook(() => useGrokApp());
    await waitFor(() => expect(result.current.state.status).toBe("ready"));

    await seedReadySession("session-a");
    await act(async () => {
      await result.current.handleSelect("session-a");
    });
    await act(async () => {
      result.current.setInput("stay on A");
    });

    await act(async () => {
      await result.current.handleNew();
    });
    expect(result.current.activeId).toBeNull();
    expect(result.current.input).toBe("");

    await act(async () => {
      await result.current.handleSelect("session-a");
    });
    expect(result.current.input).toBe("stay on A");
  });

  it("restores unsent new-chat draft after visiting another session", async () => {
    const { result } = renderHook(() => useGrokApp());
    await waitFor(() => expect(result.current.state.status).toBe("ready"));

    await seedReadySession("session-a");

    await act(async () => {
      await result.current.handleNew();
    });
    expect(result.current.activeId).toBeNull();

    await act(async () => {
      result.current.setInput("draft on new chat");
    });
    expect(result.current.input).toBe("draft on new chat");

    await act(async () => {
      await result.current.handleSelect("session-a");
    });
    expect(result.current.activeId).toBe("session-a");
    expect(result.current.input).toBe("");

    await act(async () => {
      await result.current.handleNew();
    });
    expect(result.current.activeId).toBeNull();
    expect(result.current.input).toBe("draft on new chat");
  });

  it("keeps a cleared new-chat folder after switching sessions", async () => {
    const { result } = renderHook(() => useGrokApp());
    await waitFor(() => expect(result.current.state.status).toBe("ready"));

    await seedReadySession("session-a");
    await act(async () => {
      await result.current.handleNew();
    });
    // First new chat inherits the last session workspace.
    expect(result.current.activeId).toBeNull();
    expect(result.current.taskMode).toBe(false);
    expect(result.current.workspaceCwd).toBe("/w");

    await act(async () => {
      result.current.clearWorkspace();
    });
    expect(result.current.taskMode).toBe(true);
    expect(result.current.projectCwd).toBe("");

    await act(async () => {
      await result.current.handleSelect("session-a");
    });
    expect(result.current.activeId).toBe("session-a");
    // Session row shows its own cwd while focused.
    expect(result.current.workspaceCwd).toBe("/w");

    await act(async () => {
      await result.current.handleNew();
    });
    expect(result.current.activeId).toBeNull();
    expect(result.current.taskMode).toBe(true);
    expect(result.current.projectCwd).toBe("");
    // Must not fall back to defaultCwd / last session folder.
    expect(result.current.workspaceCwd).toBe("");
  });
});
