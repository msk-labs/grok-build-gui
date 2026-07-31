import { describe, expect, it } from "vitest";
import type { AgentSessionSummary } from "../../electron/preload";
import type { LocalSession, SessionWorktree } from "../types/chat";
import {
  fromAgentSummary,
  mergeLoadedSession,
  mergeSessionList,
  preferLastSessionCwd,
  sessionProjectCwd,
} from "./sessionList";

const WORKTREE: SessionWorktree = {
  id: "feat-abc123",
  path: "/Users/me/.grok/worktrees/app/feat",
  label: "feat",
  sourcePath: "/Users/me/code/app",
};

function summary(
  sessionId: string,
  overrides: Partial<AgentSessionSummary> = {},
): AgentSessionSummary {
  return {
    sessionId,
    title: sessionId,
    summary: "",
    cwd: "/Users/me/code/app",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

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

describe("worktree sessions in the sidebar", () => {
  it("reports the source checkout as the project of a worktree chat", () => {
    const isolated = local("isolated", {
      cwd: WORKTREE.path,
      worktree: WORKTREE,
    });
    expect(sessionProjectCwd(isolated)).toBe("/Users/me/code/app");
  });

  it("carries the worktree from the agent session list", () => {
    const row = fromAgentSummary(
      summary("isolated", { cwd: WORKTREE.path, worktree: WORKTREE }),
    );
    expect(row.worktree).toEqual(WORKTREE);
  });

  it("keeps a locally known worktree until the agent list catches up", () => {
    const prev = [local("isolated", { cwd: WORKTREE.path, worktree: WORKTREE })];
    const merged = mergeSessionList(prev, [
      summary("isolated", { cwd: WORKTREE.path }),
    ]);
    expect(merged[0].worktree).toEqual(WORKTREE);
  });

  it("stamps the worktree onto the row created by session/new", () => {
    const merged = mergeLoadedSession([], {
      sessionId: "isolated",
      cwd: WORKTREE.path,
      isNew: true,
      worktree: WORKTREE,
    });
    expect(merged[0].worktree).toEqual(WORKTREE);
  });

  it("never seeds the next draft inside the previous chat's worktree", () => {
    expect(
      preferLastSessionCwd(
        [summary("isolated", { cwd: WORKTREE.path, worktree: WORKTREE })],
        "/fallback",
      ),
    ).toBe("/Users/me/code/app");
  });

  it("leaves plain chats without a worktree", () => {
    expect(fromAgentSummary(summary("plain")).worktree).toBeUndefined();
    expect(sessionProjectCwd(local("plain"))).toBe("/Users/me/code/app");
  });
});
