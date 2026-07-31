import { EventEmitter } from "node:events";
import type { BrowserWindow, WebContents } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  browserRegistry,
  isBlankUrl,
  isBrowserId,
  normalizeBrowserId,
} from "./browserSession";

class MockWebContents extends EventEmitter {
  url = "about:blank";
  title = "Browser";
  destroyed = false;
  nextLoadError: Error | null = null;
  windowOpenHandler:
    | ((details: { url: string }) => { action: "allow" | "deny" })
    | null = null;
  focus = vi.fn();
  reload = vi.fn();
  close = vi.fn(() => {
    this.destroyed = true;
    this.emit("destroyed");
  });
  navigationHistory = {
    canGoBack: vi.fn(() => false),
    canGoForward: vi.fn(() => false),
    goBack: vi.fn(),
    goForward: vi.fn(),
  };

  setWindowOpenHandler(
    handler: (details: { url: string }) => { action: "allow" | "deny" },
  ) {
    this.windowOpenHandler = handler;
  }

  loadURL = vi.fn(async (url: string) => {
    if (this.nextLoadError) {
      const error = this.nextLoadError;
      this.nextLoadError = null;
      throw error;
    }
    this.url = url;
    this.emit("did-navigate", {}, url);
  });

  getURL() {
    return this.url;
  }

  getTitle() {
    return this.title;
  }

  isDestroyed() {
    return this.destroyed;
  }
}

function contents(): MockWebContents & WebContents {
  return new MockWebContents() as MockWebContents & WebContents;
}

function fakeWindow() {
  return {
    isDestroyed: vi.fn(() => false),
    webContents: { send: vi.fn() },
  } as unknown as BrowserWindow;
}

describe("browserSession helpers", () => {
  it("validates browser ids and falls back for invalid legacy callers", () => {
    expect(isBrowserId("right-1")).toBe(true);
    expect(isBrowserId("A_b-2")).toBe(true);
    expect(isBrowserId("")).toBe(false);
    expect(isBrowserId("../right-1")).toBe(false);
    expect(isBrowserId("x".repeat(65))).toBe(false);
    expect(normalizeBrowserId("bottom-2")).toBe("bottom-2");
    expect(normalizeBrowserId("bad/id")).toBe("side");
    expect(normalizeBrowserId()).toBe("side");
  });

  it.each([undefined, "", "about:blank", "ABOUT:BLANK/"])(
    "recognizes blank browser URLs: %s",
    (url) => expect(isBlankUrl(url)).toBe(true),
  );
});

describe("browserRegistry retained webview guests", () => {
  beforeEach(async () => {
    await browserRegistry.closeAll();
    browserRegistry.setWindow(null);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await browserRegistry.closeAll();
    browserRegistry.setWindow(null);
  });

  it("attaches isolated guests by slot and exposes exact automation targets", () => {
    const right = contents();
    right.url = "https://fixture.test/right";
    const bottom = contents();
    bottom.url = "https://fixture.test/bottom";

    const rightState = browserRegistry.attach("right-1", right, {
      width: 800,
      height: 600,
    });
    const bottomState = browserRegistry.attach("bottom-2", bottom);

    expect(rightState).toMatchObject({
      id: "right-1",
      open: true,
      url: "https://fixture.test/right",
      viewport: { width: 800, height: 600 },
    });
    expect(bottomState).toMatchObject({ id: "bottom-2", open: true });
    expect(browserRegistry.getWebContents("right-1")).toBe(right);
    expect(browserRegistry.findAutomationTargetId()).toBe("right-1");
    expect(browserRegistry.findAutomationTargetId("bottom-2")).toBe(
      "bottom-2",
    );
  });

  it("normalizes typed hosts, keeps safe popups in one guest, and blocks schemes", async () => {
    const guest = contents();
    browserRegistry.attach("right-1", guest);

    await browserRegistry.navigate("right-1", "fixture.test/start");
    expect(guest.loadURL).toHaveBeenLastCalledWith(
      "https://fixture.test/start",
    );

    expect(
      guest.windowOpenHandler?.({ url: "https://fixture.test/popup" }),
    ).toEqual({ action: "deny" });
    await vi.waitFor(() =>
      expect(guest.url).toBe("https://fixture.test/popup"),
    );

    const unsafeEvent = { preventDefault: vi.fn() };
    guest.emit("will-navigate", unsafeEvent, "mailto:test@example.com");
    expect(unsafeEvent.preventDefault).toHaveBeenCalledOnce();
  });

  it("clamps viewport metadata without changing renderer-owned bounds", () => {
    const guest = contents();
    browserRegistry.attach("right-1", guest);

    const state = browserRegistry.setViewport("right-1", 100, 9_000);

    expect(state.viewport).toEqual({ width: 320, height: 4096 });
  });

  it("delegates history, reload, and focus to an attached guest", () => {
    const guest = contents();
    guest.navigationHistory.canGoBack.mockReturnValue(true);
    guest.navigationHistory.canGoForward.mockReturnValue(true);
    browserRegistry.attach("right-1", guest);

    browserRegistry.goBack("right-1");
    browserRegistry.goForward("right-1");
    browserRegistry.reload("right-1");
    browserRegistry.focus("right-1");

    expect(guest.navigationHistory.goBack).toHaveBeenCalledOnce();
    expect(guest.navigationHistory.goForward).toHaveBeenCalledOnce();
    expect(guest.reload).toHaveBeenCalledOnce();
    expect(guest.focus).toHaveBeenCalledOnce();
  });

  it("closes one guest without disturbing another and destroys retained hosts", async () => {
    const win = fakeWindow();
    const right = contents();
    const bottom = contents();
    browserRegistry.setWindow(win);
    browserRegistry.attach("right-1", right);
    browserRegistry.attach("bottom-1", bottom);

    const state = await browserRegistry.close("right-1");

    expect(state).toMatchObject({ id: "right-1", open: false, anyOpen: true });
    expect(right.close).toHaveBeenCalledOnce();
    expect(bottom.close).not.toHaveBeenCalled();
    expect(win.webContents.send).toHaveBeenCalledWith(
      "browser:destroy",
      "right-1",
    );

    await browserRegistry.closeAll();
    expect(bottom.close).toHaveBeenCalledOnce();
    expect(browserRegistry.findAutomationTargetId()).toBeNull();
  });

  it("captures load failures and recovers on the next navigation", async () => {
    const guest = contents();
    guest.nextLoadError = new Error("fixture load failed");
    browserRegistry.attach("right-1", guest);

    const failed = await browserRegistry.navigate(
      "right-1",
      "https://fixture.test/fail",
    );
    expect(failed.error).toBe("fixture load failed");

    const recovered = await browserRegistry.navigate(
      "right-1",
      "https://fixture.test/recovered",
    );
    expect(recovered).toMatchObject({
      url: "https://fixture.test/recovered",
      error: null,
    });
  });

  it("requests renderer creation when a guest does not exist", async () => {
    const win = fakeWindow();
    browserRegistry.setWindow(win);

    const state = await browserRegistry.open(
      "right-1",
      "https://fixture.test",
    );

    expect(state).toMatchObject({ id: "right-1", open: false });
    expect(win.webContents.send).toHaveBeenCalledWith(
      "browser:request-open",
      expect.objectContaining({ startUrl: "https://fixture.test" }),
    );
  });

  it("routes guest state events through the bound renderer window", () => {
    const win = fakeWindow();
    const guest = contents();
    browserRegistry.setWindow(win);
    browserRegistry.attach("right-1", guest);
    guest.title = "Updated";
    guest.emit("page-title-updated", {}, "Updated");

    expect(win.webContents.send).toHaveBeenCalledWith(
      "browser:state",
      expect.objectContaining({ id: "right-1", title: "Updated" }),
    );
  });
});
