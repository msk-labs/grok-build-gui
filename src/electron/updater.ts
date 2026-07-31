/**
 * App auto-update (electron-updater / Squirrel.Mac).
 *
 * Flow the UI drives: check → available → user clicks download → progress →
 * downloaded → install (relaunch). Download is never automatic: the sidebar
 * button is the user's consent, and a background download would burn their
 * bandwidth unasked.
 *
 * Unsupported setups must degrade quietly, not throw: an unpackaged dev run
 * has no `app-update.yml`, and a build made without publish config has no feed.
 */
import { app, type BrowserWindow } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import electronUpdater from "electron-updater";

const { autoUpdater } = electronUpdater;

export type UpdateStatus =
  /** No feed configured, or running unpackaged — the UI hides update controls. */
  | { state: "unsupported"; version: string; reason: string }
  | { state: "idle"; version: string }
  | { state: "checking"; version: string }
  | { state: "none"; version: string; checkedAt: number }
  | { state: "available"; version: string; nextVersion: string; notes?: string }
  | {
      state: "downloading";
      version: string;
      nextVersion: string;
      percent: number;
      transferred: number;
      total: number;
      bytesPerSecond: number;
    }
  | { state: "downloaded"; version: string; nextVersion: string }
  | { state: "error"; version: string; message: string };

/** Long enough for the progress ring to land on 100% before the relaunch. */
const INSTALL_DELAY_MS = 800;

let win: BrowserWindow | null = null;
let status: UpdateStatus = { state: "idle", version: app.getVersion() };
let wired = false;
/** Set once `quitAndInstall` is called so a late event cannot re-render state. */
let installing = false;

function send(next: UpdateStatus) {
  if (installing) return;
  status = next;
  if (win && !win.isDestroyed()) {
    win.webContents.send("update:status", next);
  }
}

function version(): string {
  return app.getVersion();
}

/**
 * Testing hook: a `dev-app-update.yml` beside the app makes an unpackaged run
 * check a real feed, so the check → download → progress path can be exercised
 * without cutting a release. Installing still needs a packaged build — dev has
 * no bundle for Squirrel to swap.
 */
function devFeedPath(): string {
  return path.join(app.getAppPath(), "dev-app-update.yml");
}

/**
 * Why updating cannot work here, or null when it can. electron-builder writes
 * `app-update.yml` into the bundle only when the build had publish config.
 */
function unsupportedReason(): string | null {
  if (!app.isPackaged) {
    return existsSync(devFeedPath()) ? null : "dev";
  }
  const feed = path.join(process.resourcesPath, "app-update.yml");
  if (!existsSync(feed)) return "no-feed";
  return null;
}

function wire() {
  if (wired) return;
  wired = true;

  // The button is the consent to download; install happens right after.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  // Only reached with a dev-app-update.yml present (see unsupportedReason).
  if (!app.isPackaged) autoUpdater.forceDevUpdateConfig = true;

  autoUpdater.on("checking-for-update", () => {
    send({ state: "checking", version: version() });
  });

  autoUpdater.on("update-available", (info) => {
    send({
      state: "available",
      version: version(),
      nextVersion: info.version,
      notes: typeof info.releaseNotes === "string" ? info.releaseNotes : undefined,
    });
  });

  autoUpdater.on("update-not-available", () => {
    send({ state: "none", version: version(), checkedAt: Date.now() });
  });

  autoUpdater.on("download-progress", (progress) => {
    const next =
      status.state === "downloading" || status.state === "available"
        ? status.nextVersion
        : "";
    send({
      state: "downloading",
      version: version(),
      nextVersion: next,
      // Squirrel reports 0–100; clamp so a stray value cannot break the ring.
      percent: Math.max(0, Math.min(100, progress.percent)),
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    send({
      state: "downloaded",
      version: version(),
      nextVersion: info.version,
    });
    // Install without a second prompt — clicking download was the consent.
    // Delayed so the ring visibly reaches 100% before the window goes away,
    // and so the "downloaded" state is on screen if the relaunch fails.
    setTimeout(() => installUpdate(), INSTALL_DELAY_MS);
  });

  autoUpdater.on("error", (err) => {
    send({
      state: "error",
      version: version(),
      message: err instanceof Error ? err.message : String(err),
    });
  });
}

export function setUpdaterWindow(next: BrowserWindow | null) {
  win = next;
}

export function getUpdateStatus(): UpdateStatus {
  return status;
}

/**
 * @param silent startup check — a failure here must not raise an error banner
 *   the user never asked for; only an explicit check reports failures.
 */
export async function checkForUpdates(
  opts?: { silent?: boolean },
): Promise<UpdateStatus> {
  const reason = unsupportedReason();
  if (reason) {
    send({ state: "unsupported", version: version(), reason });
    return status;
  }
  wire();
  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (opts?.silent) {
      // Offline at launch is the common case — stay quiet and let the user
      // check by hand later.
      send({ state: "idle", version: version() });
    } else {
      send({ state: "error", version: version(), message });
    }
  }
  return status;
}

export async function downloadUpdate(): Promise<UpdateStatus> {
  if (unsupportedReason()) return status;
  wire();
  try {
    await autoUpdater.downloadUpdate();
  } catch (e) {
    send({
      state: "error",
      version: version(),
      message: e instanceof Error ? e.message : String(e),
    });
  }
  return status;
}

/** Relaunch into the new version. Never returns on success. */
export function installUpdate(): { ok: boolean; error?: string } {
  if (status.state !== "downloaded") {
    return { ok: false, error: "No downloaded update" };
  }
  try {
    installing = true;
    // `isSilent: true` — the user already watched the download finish.
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
    return { ok: true };
  } catch (e) {
    installing = false;
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
