import type { BrowserWindow } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

const electronMock = vi.hoisted(() => ({
  handlers: new Map<
    string,
    (...args: unknown[]) => unknown | Promise<unknown>
  >(),
  listeners: new Map<string, (...args: unknown[]) => unknown>(),
  guests: new Map<number, unknown>(),
  sessions: new Map<string, unknown>(),
}));

const registry = vi.hoisted(() => ({
  setWindow: vi.fn(),
  getState: vi.fn(),
  attach: vi.fn(),
  open: vi.fn(),
  close: vi.fn(),
  closeAll: vi.fn(),
  navigate: vi.fn(),
  goBack: vi.fn(),
  goForward: vi.fn(),
  reload: vi.fn(),
  setViewport: vi.fn(),
  focus: vi.fn(),
  reemitAll: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn(
      (
        channel: string,
        handler: (...args: unknown[]) => unknown | Promise<unknown>,
      ) => electronMock.handlers.set(channel, handler),
    ),
    on: vi.fn(
      (channel: string, listener: (...args: unknown[]) => unknown) =>
        electronMock.listeners.set(channel, listener),
    ),
  },
  webContents: {
    fromId: (id: number) => electronMock.guests.get(id) ?? null,
  },
  session: {
    fromPartition: (partition: string) => {
      let value = electronMock.sessions.get(partition);
      if (!value) {
        value = {
          setPermissionCheckHandler: vi.fn(),
          setPermissionRequestHandler: vi.fn(),
        };
        electronMock.sessions.set(partition, value);
      }
      return value;
    },
  },
}));

vi.mock("./browserSession.js", () => ({
  browserRegistry: registry,
  isBrowserId: (id: unknown) =>
    typeof id === "string" &&
    /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id),
  normalizeBrowserId: (id?: string | null) =>
    typeof id === "string" &&
    /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id)
      ? id
      : "side",
}));

import {
  attachBrowserWindow,
  registerBrowserIpc,
  shutdownBrowser,
} from "./browserIpc";

const browserState = {
  id: "right-1",
  open: true,
  url: "https://fixture.test",
  title: "Fixture",
  canGoBack: false,
  canGoForward: false,
  cdpEndpoint: null,
  error: null,
  viewport: { width: 800, height: 600 },
  anyOpen: true,
};

function fakeWindow() {
  const webEvents = new Map<string, (...args: any[]) => void>();
  const hostContents = {
    on: vi.fn((event: string, listener: (...args: any[]) => void) => {
      webEvents.set(event, listener);
    }),
  };
  return {
    webEvents,
    hostContents,
    window: {
      isDestroyed: vi.fn(() => false),
      webContents: hostContents,
    } as unknown as BrowserWindow,
  };
}

async function invoke(
  channel: string,
  event: unknown,
  ...args: unknown[]
) {
  const handler = electronMock.handlers.get(channel);
  if (!handler) throw new Error(`Missing IPC handler ${channel}`);
  return handler(event, ...args);
}

describe("browser IPC", () => {
  let fake: ReturnType<typeof fakeWindow>;

  beforeEach(() => {
    electronMock.handlers.clear();
    electronMock.listeners.clear();
    electronMock.guests.clear();
    electronMock.sessions.clear();
    vi.clearAllMocks();
    fake = fakeWindow();
    registry.getState.mockReturnValue(browserState);
    registry.attach.mockReturnValue(browserState);
    registry.open.mockResolvedValue(browserState);
    registry.close.mockResolvedValue(browserState);
    registry.closeAll.mockResolvedValue(browserState);
    registry.navigate.mockResolvedValue(browserState);
    registry.goBack.mockReturnValue(browserState);
    registry.goForward.mockReturnValue(browserState);
    registry.reload.mockReturnValue(browserState);
    registerBrowserIpc(() => fake.window);
  });

  it("registers request handlers and the one-way viewport channel", () => {
    expect([...electronMock.handlers.keys()]).toEqual(
      expect.arrayContaining([
        "browser:attach-webview",
        "browser:close",
        "browser:focus",
        "browser:get-state",
        "browser:go-back",
        "browser:go-forward",
        "browser:navigate",
        "browser:open",
        "browser:reload",
      ]),
    );
    expect(electronMock.listeners.has("browser:set-viewport")).toBe(true);
  });

  it("supports legacy and object browser-open arguments", async () => {
    await invoke("browser:open", {}, "https://fixture.test/legacy");
    await invoke("browser:open", {}, {
      id: "bottom-2",
      startUrl: "https://fixture.test/object",
      width: 900,
      height: 700,
    });

    expect(registry.open).toHaveBeenNthCalledWith(
      1,
      "side",
      "https://fixture.test/legacy",
      undefined,
    );
    expect(registry.open).toHaveBeenNthCalledWith(
      2,
      "bottom-2",
      "https://fixture.test/object",
      { width: 900, height: 700 },
    );
  });

  it("attaches only a guest owned by the main renderer and expected partition", async () => {
    const guestSession = (
      await import("electron")
    ).session.fromPartition("persist:grok-browser-right-1");
    const guest = {
      isDestroyed: () => false,
      hostWebContents: fake.hostContents,
      session: guestSession,
    };
    electronMock.guests.set(42, guest);

    const state = await invoke(
      "browser:attach-webview",
      { sender: fake.hostContents },
      {
        id: "right-1",
        webContentsId: 42,
        width: 800,
        height: 600,
      },
    );

    expect(state).toBe(browserState);
    expect(registry.attach).toHaveBeenCalledWith("right-1", guest, {
      width: 800,
      height: 600,
    });

    await expect(
      invoke(
        "browser:attach-webview",
        { sender: {} },
        { id: "right-1", webContentsId: 42 },
      ),
    ).rejects.toThrow("invalid browser webview attachment");
  });

  it("reports viewport changes through a trusted one-way channel", () => {
    electronMock.listeners.get("browser:set-viewport")?.(
      { sender: fake.hostContents },
      { id: "right-1", width: 901.4, height: 700.2 },
    );
    electronMock.listeners.get("browser:set-viewport")?.(
      { sender: {} },
      { id: "right-1", width: 1, height: 1 },
    );

    expect(registry.setViewport).toHaveBeenCalledOnce();
    expect(registry.setViewport).toHaveBeenCalledWith(
      "right-1",
      901.4,
      700.2,
    );
  });

  it("routes close, navigation, history, and focus by slot", async () => {
    await invoke("browser:close", {}, "right-1");
    await invoke("browser:navigate", {}, {
      id: "bottom-1",
      url: "https://fixture.test/object",
    });
    await invoke("browser:go-back", {}, "right-1");
    await invoke("browser:go-forward", {}, "bottom-1");
    await invoke("browser:reload", {}, "right-2");
    await invoke("browser:focus", {}, "bottom-2");

    expect(registry.close).toHaveBeenCalledWith("right-1");
    expect(registry.navigate).toHaveBeenCalledWith(
      "bottom-1",
      "https://fixture.test/object",
    );
    expect(registry.goBack).toHaveBeenCalledWith("right-1");
    expect(registry.goForward).toHaveBeenCalledWith("bottom-1");
    expect(registry.reload).toHaveBeenCalledWith("right-2");
    expect(registry.focus).toHaveBeenCalledWith("bottom-2");
  });
});

describe("browser window security and lifecycle", () => {
  beforeEach(() => {
    electronMock.sessions.clear();
    vi.clearAllMocks();
  });

  it("hardens expected webviews and rejects unknown partitions", () => {
    const fake = fakeWindow();
    attachBrowserWindow(fake.window);
    const willAttach = fake.webEvents.get("will-attach-webview")!;
    const preferences: Record<string, unknown> = {
      preload: "malicious.js",
      nodeIntegration: true,
      partition: "persist:grok-browser-right-1",
    };
    const allowedEvent = { preventDefault: vi.fn() };

    willAttach(allowedEvent, preferences, {
      partition: "persist:grok-browser-right-1",
      src: "https://fixture.test",
    });

    expect(allowedEvent.preventDefault).not.toHaveBeenCalled();
    expect(preferences).toMatchObject({
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      navigateOnDragDrop: false,
    });
    expect(preferences).not.toHaveProperty("preload");

    const deniedEvent = { preventDefault: vi.fn() };
    willAttach(deniedEvent, { partition: "persist:other" }, {
      src: "https://fixture.test",
    });
    expect(deniedEvent.preventDefault).toHaveBeenCalledOnce();
  });

  it("re-emits state after the host renderer reloads", () => {
    const fake = fakeWindow();
    attachBrowserWindow(fake.window);
    fake.webEvents.get("did-finish-load")?.();

    expect(registry.setWindow).toHaveBeenCalledWith(fake.window);
    expect(registry.reemitAll).toHaveBeenCalledOnce();
  });

  it("closes every browser during shutdown", async () => {
    registry.closeAll.mockResolvedValue(browserState);
    await shutdownBrowser();
    expect(registry.closeAll).toHaveBeenCalledOnce();
  });
});
