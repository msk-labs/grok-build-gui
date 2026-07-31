/**
 * IPC for built-in terminals (node-pty in main, xterm in renderer).
 * Each call carries a terminal id ("side", "bottom-1", …).
 */
import { ipcMain, type BrowserWindow } from "electron";
import { sessionManager } from "./acp/sessionManager.js";
import {
  normalizeTerminalId,
  terminalRegistry,
  type TerminalId,
} from "./terminalSession.js";
import {
  listTerminalShellOptions,
  normalizeTerminalShellPreference,
  type TerminalShellPreference,
} from "./terminalShell.js";

type SizeOpts = {
  id?: string;
  cols?: number;
  rows?: number;
  cwd?: string | null;
  shellPreference?: TerminalShellPreference;
};

function resolveCwd(opts?: { cwd?: string | null }) {
  if (typeof opts?.cwd === "string" && opts.cwd.length > 0) return opts.cwd;
  return sessionManager.getActiveCwd() || null;
}

export function registerTerminalIpc(getMainWindow: () => BrowserWindow | null) {
  const bindWindow = () => {
    terminalRegistry.setWindow(getMainWindow());
  };

  ipcMain.handle("terminal:list-shells", () => listTerminalShellOptions());

  ipcMain.handle("terminal:get-state", (_e, id?: string) => {
    bindWindow();
    return terminalRegistry.getState(normalizeTerminalId(id));
  });

  ipcMain.handle("terminal:create", (_e, opts?: SizeOpts) => {
    bindWindow();
    const id = normalizeTerminalId(opts?.id);
    return terminalRegistry.create(id, {
      cols: opts?.cols,
      rows: opts?.rows,
      cwd: resolveCwd(opts),
      shellPreference: normalizeTerminalShellPreference(opts?.shellPreference),
    });
  });

  ipcMain.handle("terminal:restart", (_e, opts?: SizeOpts) => {
    bindWindow();
    const id = normalizeTerminalId(opts?.id);
    return terminalRegistry.restart(id, {
      cols: opts?.cols,
      rows: opts?.rows,
      cwd: resolveCwd(opts),
      shellPreference: normalizeTerminalShellPreference(opts?.shellPreference),
    });
  });

  ipcMain.handle(
    "terminal:write",
    (_e, payload: string | { id?: string; data?: string }) => {
      bindWindow();
      // Back-compat: plain string → side terminal.
      if (typeof payload === "string") {
        return terminalRegistry.write("side", payload);
      }
      const id = normalizeTerminalId(payload?.id);
      return terminalRegistry.write(
        id,
        typeof payload?.data === "string" ? payload.data : "",
      );
    },
  );

  ipcMain.handle(
    "terminal:resize",
    (_e, payload: { id?: string; cols?: number; rows?: number }) => {
      bindWindow();
      const id = normalizeTerminalId(payload?.id);
      const cols = Number(payload?.cols) || 80;
      const rows = Number(payload?.rows) || 24;
      return terminalRegistry.resize(id, cols, rows);
    },
  );

  ipcMain.handle("terminal:kill", (_e, id?: string) => {
    bindWindow();
    return terminalRegistry.kill(normalizeTerminalId(id));
  });
}

export function attachTerminalWindow(win: BrowserWindow | null) {
  terminalRegistry.setWindow(win);
  if (win) {
    win.webContents.on("did-finish-load", () => {
      terminalRegistry.setWindow(win);
      for (const state of terminalRegistry.getAllStates()) {
        win.webContents.send("terminal:state", state);
      }
    });
  }
}

export function shutdownTerminal() {
  terminalRegistry.killAll();
}

export type { TerminalId };
