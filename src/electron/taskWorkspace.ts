/**
 * Isolated per-session workspaces for "task" chats (no project folder).
 * Root: ~/Documents/GrokBuildGUI/<timestamp>/
 */
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

export function getTaskWorkspaceRoot(): string {
  return path.join(app.getPath("documents"), "GrokBuildGUI");
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

/** Create Documents/GrokBuildGUI/<yyyy-mm-dd_hh-mm-ss_ms>/ and return it. */
export function createTaskWorkspaceDir(): string {
  const root = getTaskWorkspaceRoot();
  fs.mkdirSync(root, { recursive: true });
  const now = new Date();
  const stamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_` +
    `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}_` +
    `${pad(now.getMilliseconds(), 3)}`;
  let dir = path.join(root, stamp);
  // Extremely unlikely same-ms collision; keep unique.
  let n = 1;
  while (fs.existsSync(dir)) {
    dir = path.join(root, `${stamp}_${n++}`);
  }
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
