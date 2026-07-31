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
});
