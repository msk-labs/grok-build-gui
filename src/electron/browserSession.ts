/**
 * Built-in browser sessions.
 *
 * Chromium owns each guest's layout through a renderer <webview>. The main
 * process only attaches the guest WebContents to browser state/automation.
 */
import type { BrowserWindow, WebContents } from "electron";

export type BrowserId = string;

const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

export type BrowserState = {
  id: BrowserId;
  open: boolean;
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  cdpEndpoint: string | null;
  error: string | null;
  viewport: { width: number; height: number };
  /** True if any browser slot is open (for UI rehydrate / slash). */
  anyOpen: boolean;
};

const DEFAULT_VIEWPORT = { width: 1024, height: 768 };
const VIEWPORT_MIN = 320;
const VIEWPORT_MAX = 4096;

export function isBrowserId(id: unknown): id is BrowserId {
  return typeof id === "string" && ID_RE.test(id);
}

export function normalizeBrowserId(id?: string | null): BrowserId {
  if (isBrowserId(id)) return id;
  return "side";
}

function clampDim(n: number, fallback: number): number {
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(VIEWPORT_MIN, Math.min(VIEWPORT_MAX, Math.round(n)));
}

export function isBlankUrl(url: string | null | undefined): boolean {
  if (!url) return true;
  const value = url.trim().toLowerCase();
  return value === "" || value === "about:blank" || value === "about:blank/";
}

function normalizeUrl(rawUrl: string): string {
  let url = rawUrl.trim();
  if (!url || isBlankUrl(url)) return "about:blank";
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) url = `https://${url}`;
  return url;
}

function isAllowedNavigation(url: string): boolean {
  if (isBlankUrl(url)) return true;
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

class BrowserSlot {
  readonly id: BrowserId;
  private win: BrowserWindow | null = null;
  private readonly anyOpen: () => boolean;
  private contents: WebContents | null = null;
  private cleanupContents: (() => void) | null = null;
  private openFlag = false;
  private url = "about:blank";
  private title = "Browser";
  private lastError: string | null = null;
  private viewport = { ...DEFAULT_VIEWPORT };

  constructor(id: BrowserId, anyOpen: () => boolean) {
    this.id = id;
    this.anyOpen = anyOpen;
  }

  setWindow(win: BrowserWindow | null): void {
    this.win = win;
  }

  isOpen(): boolean {
    return this.openFlag;
  }

  getWebContents(): WebContents | null {
    if (!this.openFlag || !this.contents || this.contents.isDestroyed()) {
      return null;
    }
    return this.contents;
  }

  getState(): BrowserState {
    const contents = this.getWebContents();
    return {
      id: this.id,
      open: this.openFlag && contents !== null,
      url: this.url,
      title: this.title,
      canGoBack: contents?.navigationHistory.canGoBack() ?? false,
      canGoForward: contents?.navigationHistory.canGoForward() ?? false,
      cdpEndpoint: null,
      error: this.lastError,
      viewport: { ...this.viewport },
      anyOpen: this.anyOpen(),
    };
  }

  private sendIpc(channel: string, payload: unknown): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send(channel, payload);
    }
  }

  private emitState(): void {
    this.sendIpc("browser:state", this.getState());
  }

  attach(
    contents: WebContents,
    viewport?: { width?: number; height?: number },
  ): BrowserState {
    if (this.contents === contents && !contents.isDestroyed()) {
      this.setViewport(
        Number(viewport?.width),
        Number(viewport?.height),
        false,
      );
      this.openFlag = true;
      this.url = contents.getURL() || this.url;
      this.title = contents.getTitle() || this.title;
      this.emitState();
      return this.getState();
    }

    this.detach();
    this.contents = contents;
    this.openFlag = true;
    this.lastError = null;
    this.setViewport(
      Number(viewport?.width),
      Number(viewport?.height),
      false,
    );
    this.url = contents.getURL() || "about:blank";
    this.title = contents.getTitle() || "Browser";

    const onNavigate = (_event: unknown, url: string) => {
      this.url = url || "about:blank";
      this.lastError = null;
      this.emitState();
    };
    const onTitle = (_event: unknown, title: string) => {
      this.title = title || "Browser";
      this.emitState();
    };
    const onFail = (
      _event: unknown,
      errorCode: number,
      errorDescription: string,
      validatedURL: string,
      isMainFrame: boolean,
    ) => {
      if (!isMainFrame || errorCode === -3) return;
      this.lastError =
        errorDescription || `Failed to load ${validatedURL || this.url}`;
      this.emitState();
    };
    const onWillNavigate = (
      event: { preventDefault(): void },
      url: string,
    ) => {
      if (!isAllowedNavigation(url)) event.preventDefault();
    };
    const onDestroyed = () => {
      if (this.contents !== contents) return;
      this.cleanupContents = null;
      this.contents = null;
      this.openFlag = false;
      this.url = "about:blank";
      this.title = "Browser";
      this.lastError = null;
      this.emitState();
    };

    contents.setWindowOpenHandler(({ url }) => {
      if (isAllowedNavigation(url)) void this.loadUrl(url);
      return { action: "deny" };
    });
    contents.on("did-navigate", onNavigate);
    contents.on("did-navigate-in-page", onNavigate);
    contents.on("page-title-updated", onTitle);
    contents.on("did-fail-load", onFail);
    contents.on("will-navigate", onWillNavigate);
    contents.once("destroyed", onDestroyed);
    this.cleanupContents = () => {
      if (contents.isDestroyed()) return;
      contents.removeListener("did-navigate", onNavigate);
      contents.removeListener("did-navigate-in-page", onNavigate);
      contents.removeListener("page-title-updated", onTitle);
      contents.removeListener("did-fail-load", onFail);
      contents.removeListener("will-navigate", onWillNavigate);
      contents.removeListener("destroyed", onDestroyed);
    };

    this.emitState();
    return this.getState();
  }

  private detach(): void {
    this.cleanupContents?.();
    this.cleanupContents = null;
    this.contents = null;
  }

  private async loadUrl(rawUrl: string): Promise<void> {
    const contents = this.getWebContents();
    if (!contents) return;
    const url = normalizeUrl(rawUrl);
    if (!isAllowedNavigation(url)) {
      this.lastError = "Unsupported browser URL";
      this.emitState();
      return;
    }
    try {
      await contents.loadURL(url);
      this.url = contents.getURL() || url;
      this.title = contents.getTitle() || "Browser";
      this.lastError = null;
    } catch (error) {
      this.lastError =
        error instanceof Error ? error.message : String(error);
    }
  }

  async open(
    startUrl?: string,
    viewport?: { width?: number; height?: number },
  ): Promise<BrowserState> {
    this.setViewport(
      Number(viewport?.width),
      Number(viewport?.height),
      false,
    );
    const contents = this.getWebContents();
    if (!contents) return this.getState();
    this.openFlag = true;
    if (startUrl?.trim() && !isBlankUrl(startUrl)) {
      await this.loadUrl(startUrl);
    }
    contents.focus();
    this.emitState();
    return this.getState();
  }

  async close(): Promise<BrowserState> {
    const contents = this.contents;
    this.detach();
    this.openFlag = false;
    this.url = "about:blank";
    this.title = "Browser";
    this.lastError = null;
    if (contents && !contents.isDestroyed()) contents.close();
    this.emitState();
    return this.getState();
  }

  async navigate(rawUrl: string): Promise<BrowserState> {
    if (!this.getWebContents()) return this.getState();
    await this.loadUrl(rawUrl);
    this.getWebContents()?.focus();
    this.emitState();
    return this.getState();
  }

  goBack(): BrowserState {
    const contents = this.getWebContents();
    if (contents?.navigationHistory.canGoBack()) {
      contents.navigationHistory.goBack();
    }
    return this.getState();
  }

  goForward(): BrowserState {
    const contents = this.getWebContents();
    if (contents?.navigationHistory.canGoForward()) {
      contents.navigationHistory.goForward();
    }
    return this.getState();
  }

  reload(): BrowserState {
    this.getWebContents()?.reload();
    return this.getState();
  }

  setViewport(
    width: number,
    height: number,
    emit = false,
  ): BrowserState {
    this.viewport = {
      width: clampDim(width, this.viewport.width),
      height: clampDim(height, this.viewport.height),
    };
    if (emit) this.emitState();
    return this.getState();
  }

  focus(): void {
    this.getWebContents()?.focus();
  }
}

class BrowserRegistry {
  private win: BrowserWindow | null = null;
  private readonly slots = new Map<BrowserId, BrowserSlot>();

  private anyOpen = () => {
    for (const slot of this.slots.values()) {
      if (slot.getWebContents()) return true;
    }
    return false;
  };

  private slot(id: BrowserId): BrowserSlot {
    let slot = this.slots.get(id);
    if (!slot) {
      slot = new BrowserSlot(id, this.anyOpen);
      slot.setWindow(this.win);
      this.slots.set(id, slot);
    }
    return slot;
  }

  setWindow(win: BrowserWindow | null): void {
    this.win = win;
    for (const slot of this.slots.values()) slot.setWindow(win);
  }

  getState(id?: string | null): BrowserState {
    const browserId = normalizeBrowserId(id);
    if (!id && !this.slots.has(browserId)) {
      for (const slot of this.slots.values()) {
        if (slot.getWebContents()) return slot.getState();
      }
      return this.closedState(browserId);
    }
    return this.slots.get(browserId)?.getState() ?? this.closedState(browserId);
  }

  getWebContents(id: string | null | undefined): WebContents | null {
    if (!id) return null;
    return this.slots.get(normalizeBrowserId(id))?.getWebContents() ?? null;
  }

  attach(
    id: string | null | undefined,
    contents: WebContents,
    viewport?: { width?: number; height?: number },
  ): BrowserState {
    return this.slot(normalizeBrowserId(id)).attach(contents, viewport);
  }

  findAutomationTargetId(requestedId?: string | null): BrowserId | null {
    if (requestedId) {
      const id = normalizeBrowserId(requestedId);
      return this.slots.get(id)?.getWebContents() ? id : null;
    }
    for (const [id, slot] of this.slots) {
      if (id.startsWith("right-") && slot.getWebContents()) return id;
    }
    for (const [id, slot] of this.slots) {
      if (slot.getWebContents()) return id;
    }
    return null;
  }

  requestRendererOpen(startUrl?: string): void {
    if (!this.win || this.win.isDestroyed()) return;
    this.win.webContents.send("browser:request-open", {
      startUrl: startUrl?.trim() || undefined,
      nonce: Date.now(),
    });
  }

  async open(
    id: string | null | undefined,
    startUrl?: string,
    viewport?: { width?: number; height?: number },
  ): Promise<BrowserState> {
    const browserId = normalizeBrowserId(id);
    const slot = this.slots.get(browserId);
    if (!slot?.getWebContents()) {
      this.requestRendererOpen(startUrl);
      return slot?.getState() ?? this.closedState(browserId);
    }
    return slot.open(startUrl, viewport);
  }

  async close(id?: string | null): Promise<BrowserState> {
    const browserId = normalizeBrowserId(id);
    if (!this.slots.has(browserId) && !id) return this.closeAll();
    const state = await this.slot(browserId).close();
    this.slots.delete(browserId);
    this.sendDestroy(browserId);
    this.reemitAnyOpen();
    return { ...state, anyOpen: this.anyOpen() };
  }

  async closeAll(): Promise<BrowserState> {
    const ids = [...this.slots.keys()];
    for (const id of ids) {
      await this.slot(id).close();
      this.slots.delete(id);
      this.sendDestroy(id);
    }
    const empty = this.closedState("side");
    this.sendState(empty);
    return empty;
  }

  async navigate(
    id: string | null | undefined,
    url: string,
  ): Promise<BrowserState> {
    const browserId = normalizeBrowserId(id);
    const slot = this.slots.get(browserId);
    if (!slot?.getWebContents()) {
      this.requestRendererOpen(url);
      return slot?.getState() ?? this.closedState(browserId);
    }
    return slot.navigate(url);
  }

  goBack(id: string | null | undefined): BrowserState {
    return this.slot(normalizeBrowserId(id)).goBack();
  }

  goForward(id: string | null | undefined): BrowserState {
    return this.slot(normalizeBrowserId(id)).goForward();
  }

  reload(id: string | null | undefined): BrowserState {
    return this.slot(normalizeBrowserId(id)).reload();
  }

  setViewport(
    id: string | null | undefined,
    width: number,
    height: number,
  ): BrowserState {
    const browserId = normalizeBrowserId(id);
    return (
      this.slots.get(browserId)?.setViewport(width, height) ??
      this.closedState(browserId)
    );
  }

  focus(id?: string | null): void {
    this.slots.get(normalizeBrowserId(id))?.focus();
  }

  reemitAll(): void {
    if (this.slots.size === 0) {
      this.sendState(this.closedState("side"));
      return;
    }
    for (const slot of this.slots.values()) this.sendState(slot.getState());
  }

  private sendState(state: BrowserState): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send("browser:state", state);
    }
  }

  private sendDestroy(id: BrowserId): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send("browser:destroy", id);
    }
  }

  private reemitAnyOpen(): void {
    for (const slot of this.slots.values()) this.sendState(slot.getState());
    if (this.slots.size === 0) this.sendState(this.closedState("side"));
  }

  private closedState(id: BrowserId): BrowserState {
    return {
      id,
      open: false,
      url: "about:blank",
      title: "Browser",
      canGoBack: false,
      canGoForward: false,
      cdpEndpoint: null,
      error: null,
      viewport: { ...DEFAULT_VIEWPORT },
      anyOpen: this.anyOpen(),
    };
  }
}

export const browserRegistry = new BrowserRegistry();

/** @deprecated Prefer browserRegistry — kept for import compatibility. */
export const browserSession = {
  setWindow: (win: BrowserWindow | null) => browserRegistry.setWindow(win),
  getState: (id?: string | null) => browserRegistry.getState(id),
  open: (startUrl?: string, id?: string) => browserRegistry.open(id, startUrl),
  close: (id?: string | null) => browserRegistry.close(id),
  navigate: (url: string, id?: string) => browserRegistry.navigate(id, url),
  goBack: (id?: string) => browserRegistry.goBack(id),
  goForward: (id?: string) => browserRegistry.goForward(id),
  reload: (id?: string) => browserRegistry.reload(id),
  setViewport: (width: number, height: number, id?: string) =>
    browserRegistry.setViewport(id, width, height),
  focus: (id?: string) => browserRegistry.focus(id),
};
