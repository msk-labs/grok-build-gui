/**
 * IPC for multi-instance built-in browser panes.
 * Each call carries a browser id (e.g. right-1, bottom-2) — same code, separate embedded views.
 */
import {
  ipcMain,
  session,
  webContents,
  type BrowserWindow,
  type WebContents,
} from "electron";
import {
  browserRegistry,
  isBrowserId,
  normalizeBrowserId,
  type BrowserState,
} from "./browserSession.js";

type OpenOpts = {
  id?: string;
  startUrl?: string;
  width?: number;
  height?: number;
};

type AttachWebviewOpts = {
  id?: string;
  webContentsId?: number;
  width?: number;
  height?: number;
};

const BROWSER_PARTITION_PREFIX = "persist:grok-browser-";

function browserIdFromPartition(partition: unknown): string | null {
  if (
    typeof partition !== "string" ||
    !partition.startsWith(BROWSER_PARTITION_PREFIX)
  ) {
    return null;
  }
  const id = partition.slice(BROWSER_PARTITION_PREFIX.length);
  return isBrowserId(id) ? id : null;
}

function isSafeWebviewUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function isTrustedRenderer(
  sender: WebContents,
  getMainWindow: () => BrowserWindow | null,
): boolean {
  const win = getMainWindow();
  return Boolean(win && !win.isDestroyed() && win.webContents === sender);
}

function parseOpenArg(
  arg?: string | OpenOpts,
): {
  id: string;
  startUrl?: string;
  viewport?: { width?: number; height?: number };
} {
  if (arg && typeof arg === "object") {
    return {
      id: normalizeBrowserId(arg.id),
      startUrl:
        typeof arg.startUrl === "string" ? arg.startUrl : undefined,
      viewport: {
        width: typeof arg.width === "number" ? arg.width : undefined,
        height: typeof arg.height === "number" ? arg.height : undefined,
      },
    };
  }
  // Legacy: browserOpen(startUrl?: string)
  return {
    id: normalizeBrowserId(null),
    startUrl: typeof arg === "string" ? arg : undefined,
  };
}

export function registerBrowserIpc(getMainWindow: () => BrowserWindow | null) {
  const bindWindow = () => {
    browserRegistry.setWindow(getMainWindow());
  };

  ipcMain.handle("browser:get-state", (_e, id?: string) => {
    bindWindow();
    return browserRegistry.getState(id);
  });

  ipcMain.handle(
    "browser:open",
    async (_e, arg?: string | OpenOpts): Promise<BrowserState> => {
      bindWindow();
      const { id, startUrl, viewport } = parseOpenArg(arg);
      return browserRegistry.open(id, startUrl, viewport);
    },
  );

  ipcMain.handle(
    "browser:close",
    async (_e, id?: string | null): Promise<BrowserState> => {
      bindWindow();
      // Explicit id → that slot only. No id → close all (slash /browser close).
      const state =
        id == null || id === ""
          ? await browserRegistry.closeAll()
          : await browserRegistry.close(id);
      return state;
    },
  );

  ipcMain.handle(
    "browser:navigate",
    async (
      _e,
      urlOrOpts: string | { id?: string; url: string },
    ): Promise<BrowserState> => {
      bindWindow();
      if (urlOrOpts && typeof urlOrOpts === "object") {
        return browserRegistry.navigate(
          urlOrOpts.id,
          typeof urlOrOpts.url === "string" ? urlOrOpts.url : "",
        );
      }
      return browserRegistry.navigate(
        null,
        typeof urlOrOpts === "string" ? urlOrOpts : "",
      );
    },
  );

  ipcMain.handle("browser:go-back", (_e, id?: string): BrowserState => {
    bindWindow();
    return browserRegistry.goBack(id);
  });

  ipcMain.handle("browser:go-forward", (_e, id?: string): BrowserState => {
    bindWindow();
    return browserRegistry.goForward(id);
  });

  ipcMain.handle("browser:reload", (_e, id?: string): BrowserState => {
    bindWindow();
    return browserRegistry.reload(id);
  });

  ipcMain.handle(
    "browser:attach-webview",
    (
      event,
      payload: AttachWebviewOpts,
    ): BrowserState => {
      bindWindow();
      const id = payload?.id;
      const webContentsId = Number(payload?.webContentsId);
      if (
        !isTrustedRenderer(event.sender, getMainWindow) ||
        !isBrowserId(id) ||
        !Number.isSafeInteger(webContentsId) ||
        webContentsId <= 0
      ) {
        throw new Error("Rejected invalid browser webview attachment");
      }

      const guest = webContents.fromId(webContentsId);
      const expectedSession = session.fromPartition(
        `${BROWSER_PARTITION_PREFIX}${id}`,
      );
      if (
        !guest ||
        guest.isDestroyed() ||
        guest.hostWebContents !== event.sender ||
        guest.session !== expectedSession
      ) {
        throw new Error("Rejected untrusted browser webview attachment");
      }

      return browserRegistry.attach(id, guest, {
        width: Number(payload.width),
        height: Number(payload.height),
      });
    },
  );

  ipcMain.on(
    "browser:set-viewport",
    (
      event,
      payload: { id?: string; width?: number; height?: number },
    ) => {
      if (
        !isTrustedRenderer(event.sender, getMainWindow) ||
        !isBrowserId(payload?.id)
      ) {
        return;
      }
      browserRegistry.setViewport(
        payload.id,
        Number(payload.width),
        Number(payload.height),
      );
    },
  );

  ipcMain.handle(
    "browser:focus",
    async (_e, id?: string | null): Promise<{ ok: boolean }> => {
      bindWindow();
      await browserRegistry.focus(id);
      return { ok: true };
    },
  );

}

/** Call when the BrowserWindow is created / recreated after Electron restart. */
export function attachBrowserWindow(win: BrowserWindow | null) {
  browserRegistry.setWindow(win);
  if (win) {
    win.webContents.on(
      "will-attach-webview",
      (event, webPreferences, params) => {
        const partition =
          typeof webPreferences.partition === "string"
            ? webPreferences.partition
            : params.partition;
        const id = browserIdFromPartition(partition);
        if (!id) {
          event.preventDefault();
          return;
        }

        const initialUrl = params.src || "about:blank";
        let allowedInitialUrl = false;
        try {
          const protocol = new URL(initialUrl).protocol;
          allowedInitialUrl =
            protocol === "about:" ||
            protocol === "http:" ||
            protocol === "https:";
        } catch {
          allowedInitialUrl = false;
        }
        if (!allowedInitialUrl) {
          event.preventDefault();
          return;
        }

        delete webPreferences.preload;
        webPreferences.nodeIntegration = false;
        webPreferences.contextIsolation = true;
        webPreferences.sandbox = true;
        webPreferences.webSecurity = true;
        webPreferences.allowRunningInsecureContent = false;
        webPreferences.navigateOnDragDrop = false;
        webPreferences.safeDialogs = true;

        const guestSession = session.fromPartition(partition);
        guestSession.setPermissionCheckHandler(() => false);
        guestSession.setPermissionRequestHandler(
          (_webContents, _permission, callback) => callback(false),
        );
      },
    );
    win.webContents.on("did-attach-webview", (_event, guest) => {
      // `allowpopups` is enabled only so window.open reaches this handler.
      // Every popup is denied; safe URLs are loaded into the same guest.
      guest.setWindowOpenHandler(({ url }) => {
        if (isSafeWebviewUrl(url)) void guest.loadURL(url);
        return { action: "deny" };
      });
    });
    win.webContents.on("did-finish-load", () => {
      browserRegistry.setWindow(win);
      browserRegistry.reemitAll();
    });
  }
}

export async function shutdownBrowser() {
  await browserRegistry.closeAll();
}
