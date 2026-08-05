import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isArtifactPath, scanWorkspaceArtifacts } from "./workspaceArtifacts";

const dirs: string[] = [];

async function scratch(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "artifacts-test-"));
  dirs.push(dir);
  return dir;
}

/** Write a file and pin its mtime so the scan window is deterministic. */
async function put(root: string, rel: string, mtimeMs: number): Promise<void> {
  const full = path.join(root, rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, "x");
  const seconds = mtimeMs / 1000;
  await utimes(full, seconds, seconds);
}

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

const TURN_START = 1_700_000_000_000;
const DURING = TURN_START + 5_000;
const BEFORE = TURN_START - 60_000;

describe("isArtifactPath", () => {
  it("accepts documents, tables, and images", () => {
    expect(isArtifactPath("a/b.xlsx")).toBe(true);
    expect(isArtifactPath("chart.PNG")).toBe(true);
    expect(isArtifactPath("notes.md")).toBe(true);
  });

  it("rejects source and build output", () => {
    expect(isArtifactPath("index.ts")).toBe(false);
    expect(isArtifactPath("bundle.js.map")).toBe(false);
    expect(isArtifactPath("Makefile")).toBe(false);
  });
});

describe("scanWorkspaceArtifacts", () => {
  it("reports only previewable files touched during the turn", async () => {
    const root = await scratch();
    await put(root, "report.xlsx", DURING);
    await put(root, "docs/summary.docx", DURING);
    await put(root, "script.py", DURING); // Not previewable.
    await put(root, "old.xlsx", BEFORE); // Predates the turn.

    expect(
      (await scanWorkspaceArtifacts(root, { since: TURN_START })).sort(),
    ).toEqual(["docs/summary.docx", "report.xlsx"]);
  });

  it("orders newest first", async () => {
    const root = await scratch();
    await put(root, "first.csv", DURING);
    await put(root, "second.csv", DURING + 1_000);
    await put(root, "third.csv", DURING + 2_000);

    expect(await scanWorkspaceArtifacts(root, { since: TURN_START })).toEqual([
      "third.csv",
      "second.csv",
      "first.csv",
    ]);
  });

  it("skips the directories the file tree also hides", async () => {
    const root = await scratch();
    await put(root, "node_modules/pkg/data.xlsx", DURING);
    await put(root, "out/build.pdf", DURING);
    await put(root, ".git/notes.md", DURING);
    await put(root, "keep.xlsx", DURING);

    expect(await scanWorkspaceArtifacts(root, { since: TURN_START })).toEqual([
      "keep.xlsx",
    ]);
  });

  it("returns partial results instead of running past its time budget", async () => {
    const root = await scratch();
    await put(root, "a.xlsx", DURING);

    // A clock that jumps past the deadline on its second read.
    let calls = 0;
    const now = () => (calls++ === 0 ? 0 : 10_000);

    expect(await scanWorkspaceArtifacts(root, { since: TURN_START, now }))
      .toEqual([]);
  });

  it("survives an unreadable workspace", async () => {
    expect(
      await scanWorkspaceArtifacts("/definitely/not/here", {
        since: TURN_START,
      }),
    ).toEqual([]);
  });
});
