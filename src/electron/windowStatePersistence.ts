import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  parseWindowState,
  type PersistedWindowState,
} from "./windowState.js";

export function readWindowState(target: string): PersistedWindowState | null {
  try {
    return parseWindowState(JSON.parse(readFileSync(target, "utf8")));
  } catch {
    return null;
  }
}

export function writeWindowState(
  target: string,
  state: PersistedWindowState,
): void {
  try {
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(state, null, 2), "utf8");
  } catch {
    // Window state is a best-effort convenience and must never block shutdown.
  }
}
