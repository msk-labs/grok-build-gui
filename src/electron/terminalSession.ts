/**
 * Built-in terminals: independent PTYs (node-pty) owned by the main process.
 * Renderer attaches via IPC + xterm; scrollback is buffered for re-attach.
 *
 * Slot ids are free-form strings (e.g. "side", "bottom-1"). Each id is its own shell.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import type { BrowserWindow } from "electron";
import type { IPty } from "node-pty";
import * as pty from "node-pty";
import { ensureSpawnHelperExecutable } from "./ptySpawnHelper.js";
import {
  resolveTerminalShell,
  type TerminalShellPreference,
} from "./terminalShell.js";

/** Any non-empty safe id; legacy fixed slots still use "side" / "bottom-*". */
export type TerminalId = string;

const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

export type TerminalState = {
  id: TerminalId;
  alive: boolean;
  shell: string;
  cwd: string;
  cols: number;
  rows: number;
  error: string | null;
};

const MAX_BUFFER_CHARS = 200_000;

function resolveCwd(preferred?: string | null): string {
  if (preferred && preferred.length > 0 && existsSync(preferred)) {
    return preferred;
  }
  const home = homedir();
  return existsSync(home) ? home : process.cwd();
}

/**
 * node-pty reports every launch failure as a bare "posix_spawnp failed." —
 * useless on its own. Point at the one cause we cannot always repair.
 */
function describeSpawnError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (!msg.includes("posix_spawnp")) return msg;
  return `${msg} node-pty's spawn-helper is missing or not executable — run "npm run fix:node-pty" (or reinstall the app).`;
}

export function isTerminalId(id: unknown): id is TerminalId {
  return typeof id === "string" && ID_RE.test(id);
}

export function normalizeTerminalId(id?: string | null): TerminalId {
  if (isTerminalId(id)) return id;
  // Legacy callers without id → side panel terminal.
  return "side";
}

class PtySlot {
  readonly id: TerminalId;
  private win: BrowserWindow | null = null;
  private proc: IPty | null = null;
  private shell = resolveTerminalShell("system").executable;
  private cwd = resolveCwd();
  private cols = 80;
  private rows = 24;
  private error: string | null = null;
  private buffer = "";

  constructor(id: TerminalId) {
    this.id = id;
  }

  setWindow(win: BrowserWindow | null) {
    this.win = win;
  }

  getState(): TerminalState {
    return {
      id: this.id,
      alive: this.proc != null,
      shell: this.shell,
      cwd: this.cwd,
      cols: this.cols,
      rows: this.rows,
      error: this.error,
    };
  }

  create(opts?: {
    cols?: number;
    rows?: number;
    cwd?: string | null;
    shellPreference?: TerminalShellPreference;
  }): TerminalState & { scrollback: string } {
    const cols = Math.max(2, Math.floor(opts?.cols ?? this.cols));
    const rows = Math.max(1, Math.floor(opts?.rows ?? this.rows));
    this.cols = cols;
    this.rows = rows;

    if (this.proc) {
      try {
        this.proc.resize(cols, rows);
      } catch {
        /* ignore resize on dead handle */
      }
      return { ...this.getState(), scrollback: this.buffer };
    }

    const cwd = resolveCwd(opts?.cwd);
    this.cwd = cwd;
    const launch = resolveTerminalShell(opts?.shellPreference);
    this.shell = launch.executable;
    this.error = null;
    this.buffer = "";

    try {
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) {
        if (typeof v === "string") env[k] = v;
      }
      env.TERM = "xterm-256color";
      env.COLORTERM = "truecolor";
      delete env.ELECTRON_RUN_AS_NODE;

      // node-pty's spawn-helper loses its +x bit in some npm installs; without
      // this the very first spawn dies with "posix_spawnp failed.".
      ensureSpawnHelperExecutable();

      // Identity-check on restart: old onExit must not clear a newer shell.
      const child = pty.spawn(this.shell, launch.args, {
        name: "xterm-256color",
        cols,
        rows,
        cwd,
        env,
      });
      this.proc = child;

      child.onData((data) => {
        if (this.proc !== child) return;
        this.appendBuffer(data);
        this.send("terminal:data", { id: this.id, data });
      });

      child.onExit(({ exitCode, signal }) => {
        if (this.proc !== child) return;
        this.proc = null;
        const line =
          signal != null
            ? `\r\n[Process exited via signal ${signal}]\r\n`
            : `\r\n[Process exited with code ${exitCode}]\r\n`;
        this.appendBuffer(line);
        this.send("terminal:data", { id: this.id, data: line });
        this.send("terminal:exit", {
          id: this.id,
          exitCode: exitCode ?? null,
          signal: signal ?? null,
        });
        this.send("terminal:state", this.getState());
      });

      this.send("terminal:state", this.getState());
      return { ...this.getState(), scrollback: this.buffer };
    } catch (e) {
      this.proc = null;
      this.error = describeSpawnError(e);
      this.send("terminal:state", this.getState());
      return { ...this.getState(), scrollback: "" };
    }
  }

  write(data: string): { ok: boolean; error?: string } {
    if (!this.proc) return { ok: false, error: "Terminal is not running" };
    if (typeof data !== "string" || data.length === 0) return { ok: true };
    try {
      this.proc.write(data);
      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  resize(cols: number, rows: number): { ok: boolean } {
    const c = Math.max(2, Math.floor(cols));
    const r = Math.max(1, Math.floor(rows));
    this.cols = c;
    this.rows = r;
    if (!this.proc) return { ok: false };
    try {
      this.proc.resize(c, r);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  restart(opts?: {
    cols?: number;
    rows?: number;
    cwd?: string | null;
    shellPreference?: TerminalShellPreference;
  }): TerminalState & { scrollback: string } {
    this.killInternal();
    return this.create(opts);
  }

  kill(): TerminalState {
    this.killInternal();
    this.send("terminal:state", this.getState());
    return this.getState();
  }

  private killInternal() {
    const child = this.proc;
    this.proc = null;
    this.buffer = "";
    this.error = null;
    if (!child) return;
    try {
      child.kill();
    } catch {
      /* already dead */
    }
  }

  private appendBuffer(chunk: string) {
    this.buffer += chunk;
    if (this.buffer.length > MAX_BUFFER_CHARS) {
      this.buffer = this.buffer.slice(this.buffer.length - MAX_BUFFER_CHARS);
    }
  }

  private send(channel: string, payload: unknown) {
    if (!this.win || this.win.isDestroyed()) return;
    this.win.webContents.send(channel, payload);
  }
}

/** Registry of independent terminal slots. */
class TerminalRegistry {
  private win: BrowserWindow | null = null;
  private slots = new Map<TerminalId, PtySlot>();

  private slot(id: TerminalId): PtySlot {
    let s = this.slots.get(id);
    if (!s) {
      s = new PtySlot(id);
      s.setWindow(this.win);
      this.slots.set(id, s);
    }
    return s;
  }

  setWindow(win: BrowserWindow | null) {
    this.win = win;
    for (const s of this.slots.values()) s.setWindow(win);
  }

  getState(id: TerminalId): TerminalState {
    return this.slot(id).getState();
  }

  getAllStates(): TerminalState[] {
    return [...this.slots.values()].map((s) => s.getState());
  }

  create(
    id: TerminalId,
    opts?: {
      cols?: number;
      rows?: number;
      cwd?: string | null;
      shellPreference?: TerminalShellPreference;
    },
  ) {
    return this.slot(id).create(opts);
  }

  write(id: TerminalId, data: string) {
    return this.slot(id).write(data);
  }

  resize(id: TerminalId, cols: number, rows: number) {
    return this.slot(id).resize(cols, rows);
  }

  restart(
    id: TerminalId,
    opts?: {
      cols?: number;
      rows?: number;
      cwd?: string | null;
      shellPreference?: TerminalShellPreference;
    },
  ) {
    return this.slot(id).restart(opts);
  }

  kill(id: TerminalId) {
    const state = this.slot(id).kill();
    // Drop idle slots so killAll / getAllStates stay lean for dynamic tabs.
    this.slots.delete(id);
    return state;
  }

  killAll() {
    for (const id of [...this.slots.keys()]) {
      this.slot(id).kill();
    }
    this.slots.clear();
  }
}

export const terminalRegistry = new TerminalRegistry();

/** @deprecated Use terminalRegistry — kept name for fewer import churn sites. */
export const terminalSession = terminalRegistry;
