import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  session,
  shell,
} from "electron";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  sessionManager,
  type ClientMcpStdio,
  type WorktreeCreateOptions,
} from "./acp/sessionManager.js";
import {
  installWindowsAppMenu,
  isAppMenuId,
  popupAppMenu,
} from "./appMenu.js";
import {
  attachBrowserWindow,
  registerBrowserIpc,
  shutdownBrowser,
} from "./browserIpc.js";
import { startBrowserBridge, stopBrowserBridge } from "./browserBridge.js";
import {
  computerUseManager,
  type ComputerUseStatus,
} from "./computerUse.js";
import { registerFilesIpc } from "./filesIpc.js";
import {
  checkForUpdates,
  downloadUpdate,
  getUpdateStatus,
  installUpdate,
  setUpdaterWindow,
} from "./updater.js";
import {
  attachTerminalWindow,
  registerTerminalIpc,
  shutdownTerminal,
} from "./terminalIpc.js";
import { fetchGrokUsage, getGrokAccount } from "./grokAccount.js";
import {
  cancelChatGptLogin,
  getChatGptStatus,
  getChatGptUsage,
  loginToChatGpt,
  logoutFromChatGpt,
  shutdownChatGptProvider,
} from "./providers/chatgptProvider.js";
import { ENDPOINT_PRESETS } from "./providers/endpointPresets.js";
import {
  discoverEndpointModels,
  listEndpoints,
  removeEndpoint,
  saveEndpoint,
} from "./providers/modelSync.js";
import {
  cancelGrokLogin,
  loginToGrok,
  logoutFromGrok,
} from "./grokAuth.js";
import { findGrok } from "./findGrok.js";
import {
  captureScreenshot,
  type ScreenshotMode,
} from "./screenshot.js";
import { listSlashCommands } from "./slashCommands.js";
import {
  createTaskWorkspaceDir,
  getTaskWorkspaceRoot,
} from "./taskWorkspace.js";
import {
  disablePlugin,
  enablePlugin,
  installPlugin,
  listPlugins,
  uninstallPlugin,
} from "./plugins.js";
import { openGrokTui } from "./openGrokTui.js";
import { LiveSttSession } from "./voiceLiveStt.js";
import { transcribePcm } from "./voiceStt.js";
import {
  createWindowState,
  resolveWindowPlacement,
  type WindowBounds,
} from "./windowState.js";
import {
  readWindowState,
  writeWindowState,
} from "./windowStatePersistence.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.DIST = path.join(__dirname, "../renderer");
process.env.VITE_PUBLIC = app.isPackaged
  ? process.env.DIST
  : path.join(__dirname, "../../resources");

app.on("child-process-gone", (_event, details) => {
  console.error(
    `[grok-gui] Electron child process exited: type=${details.type} reason=${details.reason} exit=${details.exitCode}`,
  );
});

let mainWindow: BrowserWindow | null = null;
let browserMcpServer: ClientMcpStdio | null = null;

type VoicePcm = ArrayBuffer | Uint8Array | number[];

function voicePcmToBuffer(raw: VoicePcm): Buffer {
  if (Buffer.isBuffer(raw)) return raw;
  if (raw instanceof ArrayBuffer) return Buffer.from(raw);
  if (raw instanceof Uint8Array) return Buffer.from(raw);
  return Buffer.from(raw);
}

/**
 * Walk up looking for `.git` — a directory in a normal checkout, a file
 * pointing at `…/.git/worktrees/<name>` inside a linked worktree.
 */
function findGitDir(cwd: string): string | null {
  if (!cwd) return null;
  let dir = path.resolve(cwd);
  for (;;) {
    const candidate = path.join(dir, ".git");
    if (existsSync(candidate)) {
      try {
        if (statSync(candidate).isDirectory()) return candidate;
        // Worktree: `gitdir: /abs/path/.git/worktrees/<name>`
        const pointer = readFileSync(candidate, "utf8").trim();
        const match = /^gitdir:\s*(.+)$/.exec(pointer);
        if (!match) return null;
        return path.resolve(dir, match[1]);
      } catch {
        return null;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Branch of the checkout containing `cwd`, or a short commit when detached
 * (grok's worktrees are created detached). Reading `.git/HEAD` avoids paying
 * for a `git` subprocess every time the workspace changes.
 */
function gitInfo(cwd: string): { isRepo: boolean; branch: string } {
  const gitDir = findGitDir(cwd);
  if (!gitDir) return { isRepo: false, branch: "" };
  try {
    const head = readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
    return {
      isRepo: true,
      branch: ref ? ref[1] : head.slice(0, 7),
    };
  } catch {
    return { isRepo: true, branch: "" };
  }
}

/**
 * Local branch names, most recently committed first. Shells out because
 * `refs/heads` alone misses packed refs; failures degrade to an empty list
 * and the picker just shows the current branch.
 */
async function listGitBranches(cwd: string): Promise<string[]> {
  if (!findGitDir(cwd)) return [];
  const { execFile } = await import("node:child_process");
  return new Promise((resolve) => {
    execFile(
      "git",
      [
        "-C",
        cwd,
        "for-each-ref",
        "--sort=-committerdate",
        "--format=%(refname:short)",
        "refs/heads",
      ],
      { timeout: 5_000 },
      (err, stdout) => {
        if (err) return resolve([]);
        resolve(
          stdout
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean),
        );
      },
    );
  });
}

function applyClientMcpServers(): void {
  const servers: ClientMcpStdio[] = [];
  if (browserMcpServer) servers.push(browserMcpServer);
  const computerUseMcp = computerUseManager.getMcpServer();
  if (computerUseMcp) servers.push(computerUseMcp);
  sessionManager.setClientMcpServers(servers);
}

function emitComputerUseStatus(status: ComputerUseStatus): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("computer-use:status", status);
  }
}

async function refreshComputerUse(): Promise<ComputerUseStatus> {
  const status = await computerUseManager.probe();
  applyClientMcpServers();
  emitComputerUseStatus(status);
  return status;
}

async function promptForComputerUsePermissions(
  status: ComputerUseStatus,
): Promise<void> {
  if (
    !status.enabled ||
    !status.ready ||
    !status.permissionsRequired ||
    !mainWindow ||
    mainWindow.isDestroyed()
  ) {
    return;
  }

  const result = await computerUseManager.checkPermissions();
  if (result.ok && result.allowed) return;

  const response = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    title: "Open Computer Use permissions required",
    message:
      "Allow Accessibility and Screen Recording so Open Computer Use can control your Mac.",
    detail:
      "Open System Settings → Privacy & Security, enable both permissions for Grok GUI, then restart the app.",
    buttons: ["Open System Settings", "Later"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (response.response === 0) {
    await shell.openExternal(
      "x-apple.systempreferences:com.apple.preference.security?Privacy",
    );
  }
}

/** Must match renderer `--win-titlebar-height` and titleBarOverlay.height. */
const WIN_TITLEBAR_HEIGHT = 36;
const DEFAULT_WINDOW_SIZE = { width: 1280, height: 840 };

function createWindow() {
  // Built as CJS by vite-plugin-electron (see vite.config.ts). ESM .mjs breaks require("electron").
  const preloadPath = path.join(__dirname, "preload.cjs");
  const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
  const isWin = process.platform === "win32";
  const isMac = process.platform === "darwin";
  const windowStatePath = path.join(
    app.getPath("userData"),
    "window-state.json",
  );
  const placement = resolveWindowPlacement(
    readWindowState(windowStatePath),
    screen.getAllDisplays(),
    screen.getPrimaryDisplay(),
    DEFAULT_WINDOW_SIZE,
  );

  mainWindow = new BrowserWindow({
    ...placement.bounds,
    minWidth: 900,
    minHeight: 600,
    title: "Grok GUI",
    // Keep the Windows renderer transparent so the DWM glass material remains
    // visible beneath the web chrome. Other platforms retain their fallback.
    backgroundColor: isWin ? "#00000000" : isMac ? "#f0f1f3" : "#ffffff",
    // macOS: hiddenInset + traffic lights (unchanged).
    // Windows: hidden + titleBarOverlay for custom title bar + native caption buttons.
    // Linux: default native frame.
    titleBarStyle: isMac ? "hiddenInset" : isWin ? "hidden" : "default",
    // y must match CSS --traffic-light-y so the sidebar toggle centers on the dots.
    // Only meaningful on macOS; harmless elsewhere.
    trafficLightPosition: { x: 16, y: 18 },
    ...(isWin
      ? {
          // Acrylic provides actual blurred translucency on Windows; Mica only
          // samples the wallpaper and can read as an opaque plate.
          backgroundMaterial: "acrylic",
          // Win11+: DWM owns the one true outer clip. Avoid `transparent: true`,
          // which can flatten the native rounded frame into a rectangle.
          roundedCorners: true,
          titleBarOverlay: {
            color: "#00000000",
            symbolColor: "#1f1f1f",
            height: WIN_TITLEBAR_HEIGHT,
          },
          autoHideMenuBar: true,
        }
      : isMac
        ? {}
        : { autoHideMenuBar: true }),
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
  });

  const stateWindow = mainWindow;
  let normalBounds: WindowBounds = { ...placement.bounds };
  let saveWindowStateTimer: ReturnType<typeof setTimeout> | null = null;
  const persistWindowState = () => {
    if (stateWindow.isDestroyed()) return;
    normalBounds = stateWindow.getNormalBounds();
    const display = screen.getDisplayMatching(normalBounds);
    writeWindowState(
      windowStatePath,
      createWindowState(
        normalBounds,
        display,
        stateWindow.isMaximized() && !stateWindow.isFullScreen(),
      ),
    );
  };
  const scheduleWindowStateSave = () => {
    if (saveWindowStateTimer) clearTimeout(saveWindowStateTimer);
    saveWindowStateTimer = setTimeout(() => {
      saveWindowStateTimer = null;
      persistWindowState();
    }, 250);
  };
  stateWindow.on("move", scheduleWindowStateSave);
  stateWindow.on("resize", scheduleWindowStateSave);
  stateWindow.on("maximize", scheduleWindowStateSave);
  stateWindow.on("unmaximize", scheduleWindowStateSave);
  stateWindow.on("enter-full-screen", scheduleWindowStateSave);
  stateWindow.on("leave-full-screen", scheduleWindowStateSave);
  stateWindow.on("close", () => {
    if (saveWindowStateTimer) {
      clearTimeout(saveWindowStateTimer);
      saveWindowStateTimer = null;
    }
    persistWindowState();
  });

  sessionManager.setWindow(mainWindow);
  attachBrowserWindow(mainWindow);
  attachTerminalWindow(mainWindow);
  setUpdaterWindow(mainWindow);

  // Tell renderer when maximize toggles so CSS can drop border-radius.
  if (isWin) {
    const keepAcrylicActive = () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.setBackgroundColor("#00000000");
      mainWindow.setBackgroundMaterial("acrylic");
    };
    const emitMaximized = () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send(
        "window:maximized-changed",
        mainWindow.isMaximized(),
      );
    };
    // Reapply after both focus transitions. Some Windows compositor paths
    // replace the inactive backdrop with a solid fallback unless refreshed.
    mainWindow.on("focus", keepAcrylicActive);
    mainWindow.on("blur", keepAcrylicActive);
    mainWindow.on("maximize", emitMaximized);
    mainWindow.on("unmaximize", emitMaximized);
    mainWindow.on("enter-full-screen", emitMaximized);
    mainWindow.on("leave-full-screen", emitMaximized);
    mainWindow.webContents.on("did-finish-load", () => {
      keepAcrylicActive();
      emitMaximized();
    });
  }

  // After renderer load (incl. Vite HMR full reload), re-push connection truth
  // so UI does not look "stuck disconnected" while the agent leader still runs.
  mainWindow.webContents.on("did-finish-load", () => {
    void sessionManager.reemitSnapshot();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const protocol = new URL(url).protocol;
      if (
        protocol === "http:" ||
        protocol === "https:" ||
        protocol === "mailto:"
      ) {
        void shell.openExternal(url);
      }
    } catch {
      // Ignore malformed and non-web URLs from rendered chat content.
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL) => {
      console.error(
        "[grok-gui] did-fail-load",
        errorCode,
        errorDescription,
        validatedURL,
      );
    },
  );

  mainWindow.webContents.on("console-message", (_e, level, message, line, sourceId) => {
    if (level >= 2) {
      console.error(`[renderer] ${message} (${sourceId}:${line})`);
    }
  });

  mainWindow.once("ready-to-show", () => {
    if (placement.isMaximized) mainWindow?.maximize();
    mainWindow?.show();
  });

  if (isDev) {
    console.log("[grok-gui] loading dev URL", process.env.VITE_DEV_SERVER_URL);
    console.log("[grok-gui] preload", preloadPath);
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL!);
  } else {
    const indexHtml = path.join(process.env.DIST!, "index.html");
    console.log("[grok-gui] loading file", indexHtml);
    void mainWindow.loadFile(indexHtml);
  }

  mainWindow.on("closed", () => {
    sessionManager.setWindow(null);
    attachBrowserWindow(null);
    attachTerminalWindow(null);
    mainWindow = null;
  });
}

function registerIpc() {
  ipcMain.handle("agent:probe", () => findGrok());

  ipcMain.handle("agent:get-state", () => sessionManager.getState());

  ipcMain.handle("agent:connect", async (_e, cwd: string) => {
    return sessionManager.connect(cwd);
  });

  ipcMain.handle("agent:disconnect", async () => {
    await sessionManager.disconnect();
    return sessionManager.getState();
  });

  ipcMain.handle(
    "agent:new-session",
    async (
      _e,
      cwd?: string,
      worktree?: WorktreeCreateOptions | null,
      clientRequestId?: string,
    ) => {
      return sessionManager.newSession(cwd, worktree, clientRequestId);
    },
  );

  ipcMain.handle("agent:worktree-list", async () => {
    try {
      return { ok: true, worktrees: await sessionManager.listWorktrees() };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("agent:worktree-remove", async (_e, pathOrId: string) => {
    try {
      return { ok: await sessionManager.removeWorktree(pathOrId) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Branch chip + worktree checkbox both need to know the workspace's repo. */
  ipcMain.handle("agent:git-info", async (_e, cwd: string) => {
    return gitInfo(cwd);
  });

  /** Local branches, for the new-chat branch picker. */
  ipcMain.handle("agent:git-branches", async (_e, cwd: string) => {
    return listGitBranches(cwd);
  });

  ipcMain.handle("agent:new-side-task-session", async (_e, cwd?: string) => {
    return sessionManager.newSideTaskSession(cwd);
  });

  ipcMain.handle(
    "agent:load-session",
    async (_e, sessionId: string, cwd: string) => {
      return sessionManager.loadSession(sessionId, cwd);
    },
  );

  ipcMain.handle(
    "agent:list-sessions",
    async (_e, cwd?: string | null) => {
      try {
        // undefined/null => recent sessions across all workspaces
        const sessions = await sessionManager.listSessions(
          cwd === undefined ? null : cwd,
        );
        return {
          ok: true,
          sessions,
          runningSessionIds: sessionManager.getRunningSessionIds(),
        };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
          runningSessionIds: sessionManager.getRunningSessionIds(),
        };
      }
    },
  );

  ipcMain.handle(
    "agent:search-sessions",
    async (
      _e,
      opts?: {
        query?: string;
        cwd?: string | null;
        limit?: number;
        offset?: number;
        includeContent?: boolean;
      },
    ) => {
      try {
        const query = typeof opts?.query === "string" ? opts.query : "";
        const result = await sessionManager.searchSessions({
          query,
          cwd: opts?.cwd,
          limit: opts?.limit,
          offset: opts?.offset,
          includeContent: opts?.includeContent,
        });
        return { ok: true as const, ...result };
      } catch (e) {
        return {
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
          results: [] as const,
          bootstrapping: false,
        };
      }
    },
  );

  ipcMain.handle("agent:delete-session", async (_e, sessionId: string) => {
    return sessionManager.deleteSession(sessionId);
  });

  ipcMain.handle(
    "agent:rename-session",
    async (_e, sessionId: string, title: string, cwd?: string) => {
      return sessionManager.renameSession(sessionId, title, cwd);
    },
  );

  ipcMain.handle(
    "agent:prompt",
    async (
      _e,
      text: string,
      images?: Array<{ data: string; mimeType: string }>,
      sessionId?: string,
      files?: Array<{
        name: string;
        mimeType: string;
        uri: string;
        text?: string;
        data?: string;
        size?: number;
      }>,
    ) => {
      return sessionManager.prompt(text, images, sessionId, files);
    },
  );

  /** Switch focused session without reloading history (cached transcript). */
  ipcMain.handle(
    "agent:focus-session",
    (_e, sessionId: string, cwd?: string) => {
      return sessionManager.focusSession(sessionId, cwd);
    },
  );

  /** Screen/window/region capture → edit → attachable PNG. */
  ipcMain.handle(
    "app:capture-screenshot",
    async (_event, requestedMode, requestedOptions) => {
      try {
        const mode: ScreenshotMode =
          requestedMode === "screen" || requestedMode === "window"
            ? requestedMode
            : "region";
        const keepParentVisible = Boolean(
          requestedOptions &&
            typeof requestedOptions === "object" &&
            (requestedOptions as { keepParentVisible?: unknown })
              .keepParentVisible,
        );
        const shot = await captureScreenshot(mainWindow, mode, {
          keepParentVisible,
        });
        if (!shot) return { ok: true, cancelled: true as const };
        return {
          ok: true as const,
          cancelled: false as const,
          image: {
            data: shot.data,
            mimeType: shot.mimeType,
            dataUrl: shot.dataUrl,
            width: shot.width,
            height: shot.height,
          },
        };
      } catch (e) {
        return {
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  );

  ipcMain.handle("app:capture-region", () =>
    captureScreenshot(mainWindow, "region")
      .then((shot) =>
        shot
          ? { ok: true as const, cancelled: false as const, image: shot }
          : { ok: true as const, cancelled: true as const },
      )
      .catch((error: unknown) => ({
        ok: false as const,
        error: error instanceof Error ? error.message : String(error),
      })),
  );

  ipcMain.handle("agent:cancel", (_e, sessionId?: string) =>
    sessionManager.cancel(sessionId),
  );

  /** Mid-turn steer (TUI "Send now" / interject) — does not cancel the turn. */
  ipcMain.handle(
    "agent:interject",
    async (_e, text: string, sessionId?: string) => {
      return sessionManager.interject(text, sessionId);
    },
  );

  ipcMain.handle("agent:get-models", () => sessionManager.getModels());

  ipcMain.handle("agent:get-context-usage", (_e, sessionId?: string | null) =>
    sessionManager.getContextUsage(sessionId),
  );

  ipcMain.handle(
    "agent:set-model",
    async (_e, modelId: string, reasoningEffort?: string | null) => {
      return sessionManager.setModel(modelId, reasoningEffort);
    },
  );

  ipcMain.handle("agent:get-permission-mode", () =>
    sessionManager.getPermissionMode(),
  );

  ipcMain.handle(
    "agent:set-permission-mode",
    async (
      _e,
      mode: "ask" | "auto" | "always-approve",
      sessionId?: string | null,
    ) => {
      return sessionManager.setPermissionMode(mode, sessionId);
    },
  );

  ipcMain.handle(
    "agent:permission-response",
    (_e, requestId: string, optionId: string | null) => {
      return sessionManager.respondPermission(requestId, optionId);
    },
  );

  ipcMain.handle("dialog:select-directory", async () => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle(
    "app:popup-image-attachment-menu",
    (
      event,
      opts?: { locale?: string },
    ): Promise<"copy" | "save" | "remove" | null> => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win || win.isDestroyed()) return Promise.resolve(null);
      const zh = opts?.locale?.toLowerCase().startsWith("zh") === true;
      return new Promise((resolve) => {
        let selected: "copy" | "save" | "remove" | null = null;
        const menu = Menu.buildFromTemplate([
          {
            label: zh ? "复制图片" : "Copy Image",
            click: () => {
              selected = "copy";
            },
          },
          {
            label: zh ? "另存为…" : "Save As…",
            click: () => {
              selected = "save";
            },
          },
          { type: "separator" },
          {
            label: zh ? "移除" : "Remove",
            click: () => {
              selected = "remove";
            },
          },
        ]);
        menu.popup({
          window: win,
          callback: () => resolve(selected),
        });
      });
    },
  );

  ipcMain.handle("app:copy-image", (_event, dataUrl: unknown) => {
    try {
      if (
        typeof dataUrl !== "string" ||
        dataUrl.length > 64 * 1024 * 1024 ||
        !/^data:image\/[a-z0-9.+-]+;base64,/i.test(dataUrl)
      ) {
        return { ok: false as const, error: "Invalid image data URL" };
      }
      const image = nativeImage.createFromDataURL(dataUrl);
      if (image.isEmpty()) {
        return { ok: false as const, error: "Image data could not be decoded" };
      }
      clipboard.writeImage(image);
      return { ok: true as const };
    } catch (error) {
      return {
        ok: false as const,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  /**
   * Save-as for chat image lightbox.
   * Prefer writing the displayed data URL (always available for user
   * attachments + loaded tool images); fall back to copying sourcePath.
   */
  ipcMain.handle(
    "dialog:save-image",
    async (
      _e,
      opts: {
        dataUrl?: string;
        sourcePath?: string;
        defaultName?: string;
      },
    ): Promise<
      | { ok: true; path: string }
      | { ok: false; canceled?: boolean; error?: string }
    > => {
      try {
        const { writeFile, copyFile, access } = await import("node:fs/promises");
        const { constants: fsConstants } = await import("node:fs");
        const pathMod = await import("node:path");

        const dataUrl =
          typeof opts?.dataUrl === "string" ? opts.dataUrl.trim() : "";
        const sourcePath =
          typeof opts?.sourcePath === "string" ? opts.sourcePath.trim() : "";

        // Infer extension from data URL or source path.
        let ext = ".png";
        const mimeMatch = /^data:(image\/[a-z0-9.+-]+);base64,/i.exec(dataUrl);
        if (mimeMatch?.[1]) {
          const mime = mimeMatch[1].toLowerCase();
          if (mime.includes("jpeg") || mime.includes("jpg")) ext = ".jpg";
          else if (mime.includes("webp")) ext = ".webp";
          else if (mime.includes("gif")) ext = ".gif";
          else if (mime.includes("png")) ext = ".png";
        } else if (sourcePath) {
          const fromPath = pathMod.extname(sourcePath).toLowerCase();
          if (fromPath) ext = fromPath;
        }

        let defaultName =
          (typeof opts?.defaultName === "string" && opts.defaultName.trim()) ||
          `image${ext}`;
        if (!pathMod.extname(defaultName)) {
          defaultName = `${defaultName}${ext}`;
        }

        const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
        const suggested = pathMod.join(app.getPath("downloads"), defaultName);
        const result = await dialog.showSaveDialog(win ?? undefined!, {
          title: "Save Image",
          defaultPath: suggested,
          filters: [
            { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] },
            { name: "All Files", extensions: ["*"] },
          ],
        });
        if (result.canceled || !result.filePath) {
          return { ok: false, canceled: true };
        }

        let dest = result.filePath;
        if (!pathMod.extname(dest)) {
          dest = `${dest}${ext}`;
        }

        // 1) Write base64 payload from the displayed image (most reliable).
        if (dataUrl.startsWith("data:")) {
          // Accept optional params: data:image/png;base64,xxxx
          const comma = dataUrl.indexOf(",");
          if (comma < 0) {
            return { ok: false, error: "Invalid image data URL" };
          }
          const header = dataUrl.slice(0, comma);
          const payload = dataUrl.slice(comma + 1);
          if (!/;base64/i.test(header) || !payload) {
            return { ok: false, error: "Image data is not base64" };
          }
          await writeFile(dest, Buffer.from(payload, "base64"));
          return { ok: true, path: dest };
        }

        // 2) Copy from disk when no data URL (path must exist and be readable).
        if (sourcePath) {
          const resolved = pathMod.resolve(sourcePath);
          await access(resolved, fsConstants.R_OK);
          await copyFile(resolved, dest);
          return { ok: true, path: dest };
        }

        return { ok: false, error: "No image data to save" };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  );

  // Windows custom title-bar menus only (macOS keeps the system menu bar).
  if (process.platform === "win32") {
    installWindowsAppMenu();
    ipcMain.handle(
      "window:popup-app-menu",
      (
        event,
        payload: { menuId?: unknown; x?: unknown; y?: unknown },
      ) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win || win.isDestroyed()) return { ok: false as const };
        if (!isAppMenuId(payload?.menuId)) return { ok: false as const };
        const x = typeof payload.x === "number" ? payload.x : 0;
        const y = typeof payload.y === "number" ? payload.y : 0;
        popupAppMenu(win, payload.menuId, x, y);
        return { ok: true as const };
      },
    );
    ipcMain.handle("window:is-maximized", (event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      return Boolean(win && !win.isDestroyed() && win.isMaximized());
    });
  }

  ipcMain.handle("app:get-default-cwd", () => {
    // Prefer the process cwd (e.g. repo root when launched via npm run dev).
    // Fall back to home so packaged launches still have a workspace.
    const cwd = process.cwd();
    if (cwd && cwd !== "/" && !cwd.includes("Electron.app")) {
      return cwd;
    }
    return app.getPath("home");
  });

  ipcMain.handle("app:get-task-workspace-root", () => getTaskWorkspaceRoot());

  ipcMain.handle("app:create-task-workspace", () => createTaskWorkspaceDir());

  ipcMain.handle("computer-use:get-status", () => refreshComputerUse());

  ipcMain.handle(
    "computer-use:set-enabled",
    async (_e, enabled: boolean) => {
      const status = await computerUseManager.setEnabled(enabled === true);
      applyClientMcpServers();
      emitComputerUseStatus(status);
      if (status.enabled) void promptForComputerUsePermissions(status);
      return status;
    },
  );

  ipcMain.handle("computer-use:check-permissions", () =>
    computerUseManager.checkPermissions(),
  );

  ipcMain.handle("grok:get-account", () => getGrokAccount());

  ipcMain.handle("grok:login", () => loginToGrok());

  ipcMain.handle("grok:cancel-login", () => ({
    ok: cancelGrokLogin(),
  }));

  ipcMain.handle("grok:logout", async () => {
    await sessionManager.disconnect();
    return logoutFromGrok();
  });

  ipcMain.handle("grok:get-usage", async () => fetchGrokUsage());

  /**
   * The agent reads its model catalog at startup, so a provider sign-in or
   * sign-out only takes effect after reconnecting. Skipped when no workspace
   * is connected yet — the next connect picks the change up anyway.
   */
  async function reconnectAgentForModelChange(): Promise<void> {
    const cwd = sessionManager.getActiveCwd();
    if (!cwd) return;
    await sessionManager.connect(cwd);
  }

  ipcMain.handle("provider:chatgpt:get-status", () => getChatGptStatus());

  ipcMain.handle("provider:chatgpt:login", async () => {
    const result = await loginToChatGpt();
    // New models only reach the picker after the agent restarts.
    if (result.ok) await reconnectAgentForModelChange();
    return result;
  });

  ipcMain.handle("provider:chatgpt:cancel-login", () => ({
    ok: cancelChatGptLogin(),
  }));

  ipcMain.handle("provider:chatgpt:logout", async () => {
    const result = await logoutFromChatGpt();
    if (result.ok) await reconnectAgentForModelChange();
    return result;
  });

  ipcMain.handle("provider:chatgpt:get-usage", () => getChatGptUsage());

  ipcMain.handle("provider:endpoints:list", () => listEndpoints());

  ipcMain.handle("provider:endpoints:presets", () => ENDPOINT_PRESETS);

  ipcMain.handle(
    "provider:endpoints:discover",
    async (_e, options: Parameters<typeof discoverEndpointModels>[0]) =>
      discoverEndpointModels(options),
  );

  ipcMain.handle(
    "provider:endpoints:save",
    async (_e, input: Parameters<typeof saveEndpoint>[0]) => {
      const result = await saveEndpoint(input);
      if (result.ok) await reconnectAgentForModelChange();
      return result;
    },
  );

  ipcMain.handle("provider:endpoints:remove", async (_e, id: string) => {
    await removeEndpoint(id);
    await reconnectAgentForModelChange();
    return { ok: true };
  });

  /**
   * Open the system terminal and run the bundled interactive Grok Build TUI
   * (same pinned artifact as ACP). Optional cwd defaults to active workspace.
   */
  ipcMain.handle("grok:open-tui", async (_e, cwd?: string | null) => {
    const dir =
      typeof cwd === "string" && cwd.length > 0
        ? cwd
        : sessionManager.getActiveCwd() || null;
    return openGrokTui(dir);
  });

  /** User-invocable skills for composer `/` autocomplete (`grok inspect --json`). */
  ipcMain.handle("grok:list-slash-commands", async (_e, cwd?: string | null) => {
    return listSlashCommands(cwd, sessionManager.getAvailableSlashCommands());
  });

  // Plugin management (wraps `grok plugin *` CLI — agent owns install state).
  ipcMain.handle("grok:list-plugins", async () => listPlugins());
  ipcMain.handle("grok:install-plugin", async (_e, source: string) =>
    installPlugin(source),
  );
  ipcMain.handle("grok:uninstall-plugin", async (_e, name: string) =>
    uninstallPlugin(name),
  );
  ipcMain.handle("grok:enable-plugin", async (_e, name: string) =>
    enablePlugin(name),
  );
  ipcMain.handle("grok:disable-plugin", async (_e, name: string) =>
    disablePlugin(name),
  );

  /** Speech-to-text: renderer sends PCM16 mono; main calls xAI STT. */
  ipcMain.handle(
    "voice:transcribe",
    async (
      _e,
      payload: {
        pcm: VoicePcm;
        sampleRate?: number;
        language?: string;
        localeHint?: string;
      },
    ) => {
      try {
        const raw = payload?.pcm;
        if (raw == null) {
          return { ok: false as const, error: "Missing audio data." };
        }
        const pcm = voicePcmToBuffer(raw);
        return await transcribePcm({
          pcm,
          sampleRate: payload.sampleRate,
          language: payload.language,
          localeHint: payload.localeHint,
        });
      } catch (e) {
        return {
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  );

  /**
   * Live dictation (console-style): stream PCM while speaking, get partials.
   * One session at a time per window.
   */
  const liveVoice = new Map<number, LiveSttSession>();
  let liveVoiceSeq = 0;

  ipcMain.handle(
    "voice:live-start",
    async (
      e,
      opts?: {
        sampleRate?: number;
        language?: string;
        localeHint?: string;
      },
    ): Promise<
      { ok: true; id: number } | { ok: false; error: string }
    > => {
      // Drop any previous live session for this webContents.
      for (const [id, s] of liveVoice) {
        s.abort();
        liveVoice.delete(id);
      }
      const id = ++liveVoiceSeq;
      const wc = e.sender;
      const started = await LiveSttSession.start(
        {
          sampleRate: opts?.sampleRate ?? 16_000,
          language: opts?.language,
          localeHint: opts?.localeHint,
        },
        {
          onPartial: (partial) => {
            if (!wc.isDestroyed()) {
              wc.send("voice:partial", { id, ...partial });
            }
          },
          onError: (message) => {
            if (!wc.isDestroyed()) {
              wc.send("voice:error", { id, error: message });
            }
          },
        },
      );
      if (!started.ok) return started;
      liveVoice.set(id, started.session);
      return { ok: true, id };
    },
  );

  ipcMain.handle(
    "voice:live-audio",
    (
      _e,
      payload: { id: number; pcm: VoicePcm },
    ): { ok: boolean } => {
      const session = liveVoice.get(payload?.id);
      if (!session) return { ok: false };
      const raw = payload.pcm;
      if (raw == null) return { ok: false };
      const pcm = voicePcmToBuffer(raw);
      session.pushAudio(pcm);
      return { ok: true };
    },
  );

  ipcMain.handle(
    "voice:live-stop",
    async (
      _e,
      payload: { id: number },
    ): Promise<
      { ok: true; text: string } | { ok: false; error: string }
    > => {
      const session = liveVoice.get(payload?.id);
      if (!session) {
        return { ok: false, error: "No live voice session." };
      }
      liveVoice.delete(payload.id);
      const text = (await session.stop())?.trim() ?? "";
      return { ok: true, text };
    },
  );

  ipcMain.handle("voice:live-cancel", (_e, payload: { id: number }) => {
    const session = liveVoice.get(payload?.id);
    if (session) {
      session.abort();
      liveVoice.delete(payload.id);
    }
    return { ok: true };
  });

  registerBrowserIpc(() => mainWindow);
  registerTerminalIpc(() => mainWindow);
  registerFilesIpc();

  ipcMain.handle("update:get-status", () => getUpdateStatus());
  ipcMain.handle("update:check", () => checkForUpdates());
  ipcMain.handle("update:download", () => downloadUpdate());
  ipcMain.handle("update:install", () => installUpdate());
}

function allowMediaPermissions() {
  const allow = (permission: string) =>
    permission === "media" ||
    permission === "mediaKeySystem" ||
    permission === "display-capture";
  session.defaultSession.setPermissionRequestHandler(
    (_wc, permission, callback) => {
      callback(allow(permission));
    },
  );
  session.defaultSession.setPermissionCheckHandler((_wc, permission) =>
    allow(permission),
  );
}

app.whenReady().then(async () => {
  allowMediaPermissions();
  try {
    browserMcpServer = await startBrowserBridge(
      path.join(__dirname, "browserMcpServer.js"),
      (input) => sessionManager.requestLocalToolPermission(input),
    );
  } catch (error) {
    console.error(
      "[grok-gui] browser MCP bridge failed:",
      error instanceof Error ? error.message : error,
    );
    browserMcpServer = null;
  }
  await refreshComputerUse();
  registerIpc();
  createWindow();

  // Startup check, deferred so it never competes with first paint or the
  // agent connect. Silent: being offline at launch is not an error banner.
  setTimeout(() => void checkForUpdates({ silent: true }), 4000);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

let windowWorkCleanup: Promise<void> | null = null;

function cleanupWindowWork(): Promise<void> {
  if (windowWorkCleanup) return windowWorkCleanup;
  windowWorkCleanup = (async () => {
    cancelGrokLogin();
    await stopBrowserBridge();
    await shutdownBrowser();
    shutdownTerminal();
    await sessionManager.cleanupSideTaskSessions();
    await sessionManager.disconnect();
  })().finally(() => {
    windowWorkCleanup = null;
  });
  return windowWorkCleanup;
}

async function cleanupAppWork(): Promise<void> {
  await cleanupWindowWork();
  await shutdownChatGptProvider();
}

let allowQuit = false;
let quitCleanup: Promise<void> | null = null;

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    return;
  }
  // macOS keeps the app alive after its last window closes, but the renderer
  // tabs are gone, so their sessions must be cleaned here too. Keep the
  // provider relay alive for app activation: its ephemeral port is part of
  // the managed model config and remains valid for this main-process lifetime.
  void cleanupWindowWork();
});

app.on("before-quit", (event) => {
  if (allowQuit) return;
  event.preventDefault();
  if (quitCleanup) return;
  quitCleanup = cleanupAppWork().finally(() => {
    allowQuit = true;
    app.quit();
  });
});
