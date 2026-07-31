import { describe, expect, it } from "vitest";
import type { LocalSession } from "../../types/chat";
import {
  getGroupSessionVisibility,
  groupSessions,
  PROJECT_SESSION_PREVIEW_LIMIT,
} from "./groupSessions";

function local(id: string, overrides: Partial<LocalSession> = {}): LocalSession {
  return {
    id,
    title: id,
    cwd: "/Users/me/code/app",
    createdAt: 1,
    messages: [],
    historyReady: true,
    ...overrides,
  };
}

function session(id: string, updatedAt = 0): LocalSession {
  return {
    id,
    title: id,
    cwd: "/proj",
    messages: [],
    updatedAt,
    createdAt: updatedAt,
    historyReady: true,
  };
}

describe("groupSessions", () => {
  it("keeps worktree chats in their source project group", () => {
    const isolated = local("isolated", {
      cwd: "/Users/me/.grok/worktrees/app/feat",
      worktree: {
        id: "feat-abc123",
        path: "/Users/me/.grok/worktrees/app/feat",
        label: "feat",
        sourcePath: "/Users/me/code/app",
      },
    });

    const groups = groupSessions([local("plain"), isolated]);

    expect(groups).toHaveLength(1);
    expect(groups[0].cwd).toBe("/Users/me/code/app");
    expect(groups[0].name).toBe("app");
    expect(groups[0].sessions.map((s) => s.id).sort()).toEqual([
      "isolated",
      "plain",
    ]);
  });

  it("still groups plain chats by their own cwd", () => {
    const groups = groupSessions([
      local("a"),
      local("b", { cwd: "/Users/me/code/other" }),
    ]);
    expect(groups.map((g) => g.cwd).sort()).toEqual([
      "/Users/me/code/app",
      "/Users/me/code/other",
    ]);
  });
});

describe("getGroupSessionVisibility", () => {
  const rows = Array.from({ length: 8 }, (_, i) =>
    session(`s${i}`, 100 - i),
  );

  it("shows all sessions when at or under the limit", () => {
    const short = rows.slice(0, PROJECT_SESSION_PREVIEW_LIMIT);
    const result = getGroupSessionVisibility(short, { expanded: false });
    expect(result.visible).toEqual(short);
    expect(result.canToggle).toBe(false);
    expect(result.hiddenCount).toBe(0);
  });

  it("previews the newest sessions when collapsed", () => {
    const result = getGroupSessionVisibility(rows, { expanded: false });
    expect(result.visible.map((s) => s.id)).toEqual([
      "s0",
      "s1",
      "s2",
      "s3",
      "s4",
    ]);
    expect(result.canToggle).toBe(true);
    expect(result.hiddenCount).toBe(3);
  });

  it("shows every session when expanded", () => {
    const result = getGroupSessionVisibility(rows, { expanded: true });
    expect(result.visible).toEqual(rows);
    expect(result.canToggle).toBe(true);
    expect(result.hiddenCount).toBe(0);
  });

  it("keeps the active session visible when it is outside the preview", () => {
    const result = getGroupSessionVisibility(rows, {
      expanded: false,
      activeId: "s7",
    });
    expect(result.visible.map((s) => s.id)).toEqual([
      "s0",
      "s1",
      "s2",
      "s3",
      "s4",
      "s7",
    ]);
    expect(result.hiddenCount).toBe(2);
  });

  it("does not duplicate the active session when it is already in the preview", () => {
    const result = getGroupSessionVisibility(rows, {
      expanded: false,
      activeId: "s1",
    });
    expect(result.visible.map((s) => s.id)).toEqual([
      "s0",
      "s1",
      "s2",
      "s3",
      "s4",
    ]);
    expect(result.hiddenCount).toBe(3);
  });
});
