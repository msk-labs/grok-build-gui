import type { WebviewTag } from "electron";
import type { BrowserId } from "../../../electron/preload";

const hosts = new Map<BrowserId, BrowserWebviewHost>();
let retainedRoot: HTMLDivElement | null = null;
let destroySubscriptionInstalled = false;

function normalizeInitialUrl(url: string | null | undefined): string {
  const trimmed = url?.trim();
  if (!trimmed) return "about:blank";
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function getRetainedRoot(): HTMLDivElement {
  if (retainedRoot?.isConnected) return retainedRoot;
  retainedRoot = document.createElement("div");
  retainedRoot.className = "browser-webview-retained-root";
  retainedRoot.setAttribute("aria-hidden", "true");
  document.body.append(retainedRoot);
  return retainedRoot;
}

function installDestroySubscription(): void {
  if (destroySubscriptionInstalled) return;
  const subscribe = window.grok?.onBrowserDestroyRequest;
  if (!subscribe) return;
  destroySubscriptionInstalled = true;
  subscribe((id) => destroyBrowserWebview(id));
}

class BrowserWebviewHost {
  readonly id: BrowserId;
  readonly container = document.createElement("div");
  readonly webview = document.createElement("webview") as WebviewTag;
  private resizeObserver: ResizeObserver | null = null;
  private viewportRaf: number | null = null;
  private attachedWebContentsId: number | null = null;
  private destroyed = false;

  constructor(id: BrowserId, initialUrl?: string) {
    this.id = id;
    this.container.className = "browser-pane-webview-host";
    this.container.dataset.browserId = id;

    this.webview.className = "browser-pane-webview";
    this.webview.setAttribute("partition", `persist:grok-browser-${id}`);
    this.webview.setAttribute("allowpopups", "");
    this.webview.setAttribute(
      "webpreferences",
      "contextIsolation=yes,nodeIntegration=no,sandbox=yes,navigateOnDragDrop=no",
    );
    this.webview.setAttribute("src", normalizeInitialUrl(initialUrl));
    this.webview.addEventListener("dom-ready", this.handleDomReady);
    this.container.append(this.webview);
    getRetainedRoot().append(this.container);
  }

  mount(target: HTMLElement): void {
    if (this.destroyed) return;
    target.prepend(this.container);
    this.container.dataset.retained = "false";
    this.observe(target);
    this.scheduleViewport();
  }

  retain(): void {
    if (this.destroyed) return;
    this.stopObserving();
    this.container.dataset.retained = "true";
    getRetainedRoot().append(this.container);
  }

  focus(): void {
    if (this.destroyed) return;
    this.webview.focus();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopObserving();
    this.webview.removeEventListener("dom-ready", this.handleDomReady);
    this.container.remove();
  }

  private readonly handleDomReady = () => {
    if (this.destroyed || !window.grok?.browserAttachWebview) return;
    const getId = this.webview.getWebContentsId;
    if (typeof getId !== "function") return;
    const webContentsId = getId.call(this.webview);
    if (!Number.isSafeInteger(webContentsId) || webContentsId <= 0) return;
    if (this.attachedWebContentsId === webContentsId) return;
    this.attachedWebContentsId = webContentsId;
    const rect = this.container.getBoundingClientRect();
    void window.grok.browserAttachWebview({
      id: this.id,
      webContentsId,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    });
  };

  private observe(target: HTMLElement): void {
    this.stopObserving();
    if (typeof ResizeObserver === "undefined") return;
    this.resizeObserver = new ResizeObserver(() => this.scheduleViewport());
    this.resizeObserver.observe(target);
  }

  private scheduleViewport(): void {
    if (this.viewportRaf != null) cancelAnimationFrame(this.viewportRaf);
    this.viewportRaf = requestAnimationFrame(() => {
      this.viewportRaf = null;
      if (this.destroyed || !window.grok?.browserSetViewport) return;
      const rect = this.container.getBoundingClientRect();
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      if (width < 32 || height < 32) return;
      window.grok.browserSetViewport({ id: this.id, width, height });
    });
  }

  private stopObserving(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.viewportRaf != null) {
      cancelAnimationFrame(this.viewportRaf);
      this.viewportRaf = null;
    }
  }
}

export function getBrowserWebview(
  id: BrowserId,
  initialUrl?: string,
): BrowserWebviewHost {
  installDestroySubscription();
  let host = hosts.get(id);
  if (!host) {
    host = new BrowserWebviewHost(id, initialUrl);
    hosts.set(id, host);
  }
  return host;
}

export function destroyBrowserWebview(id: BrowserId): void {
  const host = hosts.get(id);
  if (!host) return;
  hosts.delete(id);
  host.destroy();
}
