import { BrowserWindow, type Display } from "electron";

/**
 * Build a frameless, always-on-top overlay that covers an entire display
 * including the Windows taskbar / Start area.
 *
 * Secondary-monitor DPI is the common failure mode: Electron may create the
 * window with primary-monitor scaling, leaving a smaller "picture-in-picture"
 * rect. Re-applying bounds after attach/show corrects that.
 */
export function createScreenshotOverlayWindow(display: Display): BrowserWindow {
  const bounds = { ...display.bounds };
  const win = new BrowserWindow({
    ...bounds,
    frame: false,
    show: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    thickFrame: false,
    transparent: false,
    backgroundColor: "#111111",
    focusable: true,
    enableLargerThanScreen: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      zoomFactor: 1,
    },
  });

  // Highest z-order so the overlay covers the taskbar / Start area.
  // relativeLevel keeps us above other topmost chrome on Windows.
  win.setAlwaysOnTop(true, "screen-saver", 1);
  try {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch {
    // macOS-only options on some Electron builds; ignore elsewhere.
  }

  const applyBounds = () => {
    if (win.isDestroyed()) return;
    win.setBounds(bounds);
  };
  win.on("ready-to-show", applyBounds);
  win.webContents.on("did-finish-load", applyBounds);

  return win;
}

/** Show an overlay, re-asserting bounds and topmost level after Windows reclamps. */
export function showScreenshotOverlayWindow(
  win: BrowserWindow,
  display: Display,
  options?: { focus?: boolean },
): void {
  if (win.isDestroyed()) return;
  const bounds = { ...display.bounds };
  win.setBounds(bounds);
  win.setAlwaysOnTop(true, "screen-saver", 1);
  if (options?.focus) {
    win.show();
    win.focus();
    win.moveTop();
  } else {
    win.showInactive();
  }
  // Windows may clamp to workArea on the first show; force full display bounds.
  win.setBounds(bounds);
  // DWM sometimes reclamps asynchronously after show — re-assert next tick.
  setImmediate(() => {
    if (win.isDestroyed()) return;
    win.setBounds(bounds);
    win.setAlwaysOnTop(true, "screen-saver", 1);
    if (options?.focus) win.moveTop();
  });
}
