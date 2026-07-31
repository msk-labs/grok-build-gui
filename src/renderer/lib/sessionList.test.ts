import { describe, expect, it } from "vitest";
import type { AgentSessionSummary } from "../../electron/preload";
import type { LocalSession } from "../types/chat";
import {
  adoptProvisionalSession,
  fromAgentSummary,
  isProvisionalSessionId,
  makeProvisionalSessionId,
  mergeLoadedSession,
  mergeSessionList,
} from "./sessionList";

function summary(
  sessionId: string,
  overrides: Partial<AgentSessionSummary> = {},
): AgentSessionSummary {
  return {
    sessionId,
    title: sessionId,
    summary: "",
    cwd: "/workspace",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("session list activity ordering", () => {
  it("prefers last conversation activity over incidental record updates", () => {
    const openedRecently = summary("opened-recently", {
      lastActiveAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-10T00:00:00.000Z",
    });
    const chattedRecently = summary("chatted-recently", {
      lastActiveAt: "2026-01-03T00:00:00.000Z",
      updatedAt: "2026-01-03T00:00:00.000Z",
    });

    expect(
      mergeSessionList([], [openedRecently, chattedRecently]).map((s) => s.id),
    ).toEqual(["chatted-recently", "opened-recently"]);
  });

  it("falls back to updatedAt when lastActiveAt is unavailable", () => {
    const session = fromAgentSummary(
      summary("legacy", {
        updatedAt: "2026-01-04T00:00:00.000Z",
      }),
    );

    expect(session.updatedAt).toBe(
      Date.parse("2026-01-04T00:00:00.000Z"),
    );
  });

  it("preserves the first prompt when a new-session event arrives late", () => {
    const optimistic: LocalSession = {
      id: "new-session",
      title: "你好",
      cwd: "/workspace",
      createdAt: 1,
      messages: [
        {
          id: "user-1",
          role: "user",
          text: "你好",
          createdAt: 2,
        },
        {
          id: "assistant-1",
          role: "assistant",
          blocks: [],
          streaming: true,
          createdAt: 3,
        },
      ],
      historyReady: true,
      running: true,
    };

    const [merged] = mergeLoadedSession([optimistic], {
      sessionId: optimistic.id,
      cwd: optimistic.cwd,
      isNew: true,
    });

    expect(merged?.messages).toEqual(optimistic.messages);
    expect(merged?.running).toBe(true);
  });

  it("keeps optimistic first-prompt title over agent placeholder on merge", () => {
    const local: LocalSession = {
      id: "s1",
      title: "帮我写个脚本",
      cwd: "/workspace",
      createdAt: 1,
      updatedAt: 10,
      messages: [
        {
          id: "user-1",
          role: "user",
          text: "帮我写个脚本",
          createdAt: 2,
        },
      ],
      historyReady: true,
      running: true,
    };

    const [merged] = mergeSessionList(
      [local],
      [
        summary("s1", {
          title: "Untitled session",
          lastActiveAt: "2026-01-01T00:00:00.000Z",
        }),
      ],
      ["s1"],
    );

    expect(merged?.title).toBe("帮我写个脚本");
    expect(merged?.running).toBe(true);
    expect(merged?.messages).toHaveLength(1);
  });

  it("retains local-only brand-new sessions missing from agent list", () => {
    const localOnly: LocalSession = {
      id: "brand-new",
      title: "第一条消息",
      cwd: "/workspace",
      createdAt: 100,
      // Newer than agent `older` so sort puts the optimistic row first.
      updatedAt: Date.parse("2026-06-01T00:00:00.000Z"),
      messages: [
        {
          id: "user-1",
          role: "user",
          text: "第一条消息",
          createdAt: 200,
        },
      ],
      historyReady: true,
      running: true,
    };
    const older = summary("older", {
      title: "旧会话",
      lastActiveAt: "2026-01-01T00:00:00.000Z",
    });

    const merged = mergeSessionList([localOnly], [older], ["brand-new"]);

    expect(merged.map((s) => s.id)).toEqual(["brand-new", "older"]);
    expect(merged[0]?.title).toBe("第一条消息");
    expect(merged[0]?.running).toBe(true);
  });

  it("promotes provisional first-send row when session-loaded arrives", () => {
    const provisionalId = makeProvisionalSessionId("pending-1");
    expect(isProvisionalSessionId(provisionalId)).toBe(true);

    const provisional: LocalSession = {
      id: provisionalId,
      title: "立刻出现在列表",
      cwd: "/tasks-root",
      createdAt: 1,
      updatedAt: 2,
      messages: [
        {
          id: "user-1",
          role: "user",
          text: "立刻出现在列表",
          createdAt: 2,
        },
        {
          id: "assistant-1",
          role: "assistant",
          blocks: [],
          streaming: true,
          createdAt: 3,
        },
      ],
      historyReady: true,
      running: true,
    };

    const [merged] = mergeLoadedSession([provisional], {
      sessionId: "real-session",
      cwd: "/tasks-root/2026-01-01",
      isNew: true,
    });

    expect(merged?.id).toBe("real-session");
    expect(merged?.title).toBe("立刻出现在列表");
    expect(merged?.messages).toHaveLength(2);
    expect(merged?.cwd).toBe("/tasks-root/2026-01-01");
    expect(merged?.running).toBe(true);
  });

  it("adopts provisional into an empty real row without losing transcript", () => {
    const provisionalId = makeProvisionalSessionId("pending-2");
    const provisional: LocalSession = {
      id: provisionalId,
      title: "hello",
      cwd: "/w",
      createdAt: 1,
      updatedAt: 5,
      messages: [
        {
          id: "user-1",
          role: "user",
          text: "hello",
          createdAt: 2,
        },
      ],
      historyReady: true,
      running: true,
    };
    const emptyReal: LocalSession = {
      id: "real-2",
      title: "",
      cwd: "/w",
      createdAt: 3,
      updatedAt: 4,
      messages: [],
      historyReady: true,
    };

    const [merged] = adoptProvisionalSession(
      [provisional, emptyReal],
      provisionalId,
      "real-2",
      "/w",
    );

    expect(merged?.id).toBe("real-2");
    expect(merged?.title).toBe("hello");
    expect(merged?.messages).toHaveLength(1);
    expect(merged?.running).toBe(true);
  });
});
