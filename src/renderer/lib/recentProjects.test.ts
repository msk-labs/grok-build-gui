// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  forgetRecentProject,
  loadRecentProjects,
  mergeRecentProjects,
  rememberRecentProject,
} from "./recentProjects";

describe("rememberRecentProject", () => {
  beforeEach(() => localStorage.clear());

  it("keeps the newest use first and never duplicates a folder", () => {
    rememberRecentProject("/work/alpha", 1);
    rememberRecentProject("/work/beta", 2);
    rememberRecentProject("/work/alpha", 3);

    expect(loadRecentProjects().map((p) => p.cwd)).toEqual([
      "/work/alpha",
      "/work/beta",
    ]);
  });

  it("treats a trailing slash as the same folder", () => {
    rememberRecentProject("/work/alpha", 1);
    rememberRecentProject("/work/alpha/", 2);

    expect(loadRecentProjects()).toHaveLength(1);
  });

  it("ignores ephemeral task workspaces", () => {
    rememberRecentProject("/Users/me/Documents/GrokBuildGUI/20260727-1", 1);
    expect(loadRecentProjects()).toEqual([]);
  });

  it("forgets a folder that is gone", () => {
    rememberRecentProject("/work/alpha", 1);
    rememberRecentProject("/work/beta", 2);
    forgetRecentProject("/work/alpha");

    expect(loadRecentProjects().map((p) => p.cwd)).toEqual(["/work/beta"]);
  });

  it("survives a corrupt blob", () => {
    localStorage.setItem("grok-gui.recentProjects", "{not json");
    expect(loadRecentProjects()).toEqual([]);
  });
});

describe("mergeRecentProjects", () => {
  it("merges picked folders with folders that already have chats", () => {
    const merged = mergeRecentProjects(
      [{ cwd: "/work/picked", at: 50 }],
      [
        { cwd: "/work/chatted", updatedAt: 100 },
        { cwd: "/work/older", updatedAt: 10 },
      ],
    );

    expect(merged.map((p) => p.cwd)).toEqual([
      "/work/chatted",
      "/work/picked",
      "/work/older",
    ]);
  });

  it("keeps the newest timestamp when both sources know a folder", () => {
    const merged = mergeRecentProjects(
      [{ cwd: "/work/alpha", at: 5 }],
      [{ cwd: "/work/alpha", updatedAt: 900 }, { cwd: "/work/beta", updatedAt: 100 }],
    );

    expect(merged.map((p) => p.cwd)).toEqual(["/work/alpha", "/work/beta"]);
  });

  it("drops the current workspace, task folders and anything past the limit", () => {
    const merged = mergeRecentProjects(
      [
        { cwd: "/work/current", at: 100 },
        { cwd: "/Users/me/Documents/GrokBuildGUI/20260727-1", at: 99 },
        { cwd: "/work/a", at: 3 },
        { cwd: "/work/b", at: 2 },
        { cwd: "/work/c", at: 1 },
      ],
      [],
      { exclude: "/work/current/", limit: 2 },
    );

    expect(merged.map((p) => p.cwd)).toEqual(["/work/a", "/work/b"]);
  });
});
