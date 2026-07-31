// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BrowserId,
  BrowserState,
  GrokApi,
} from "../../../electron/preload";
import { BrowserPane } from "./BrowserPane";
import { destroyBrowserWebview } from "./browserWebview";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function browserState(
  overrides: Partial<BrowserState> = {},
): BrowserState {
  return {
    id: "right-1",
    open: true,
    url: "https://fixture.test/",
    title: "Fixture",
    canGoBack: false,
    canGoForward: false,
    cdpEndpoint: null,
    error: null,
    viewport: { width: 800, height: 600 },
    anyOpen: true,
    ...overrides,
  };
}

class ResizeObserverMock {
  static callbacks: ResizeObserverCallback[] = [];
  constructor(callback: ResizeObserverCallback) {
    ResizeObserverMock.callbacks.push(callback);
  }
  observe() {}
  disconnect = vi.fn();
}

describe("BrowserPane retained webview", () => {
  let rafCallbacks: Array<{ id: number; callback: FrameRequestCallback }>;
  let stateListener: ((state: BrowserState) => void) | null;
  let currentState: BrowserState;

  const browserAttachWebview = vi.fn(async () => currentState);
  const browserSetViewport = vi.fn();
  const browserNavigate = vi.fn(async () => currentState);
  const browserFocus = vi.fn(async () => ({ ok: true }));
  const browserGoBack = vi.fn(async () => currentState);
  const browserGoForward = vi.fn(async () => currentState);
  const browserReload = vi.fn(async () => currentState);
  const getBrowserState = vi.fn(async () => currentState);

  async function flushRaf() {
    await act(async () => {
      const callbacks = rafCallbacks.splice(0);
      callbacks.forEach(({ callback }) => callback(performance.now()));
      await Promise.resolve();
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    currentState = browserState();
    stateListener = null;
    rafCallbacks = [];
    ResizeObserverMock.callbacks = [];
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        const id = rafCallbacks.length + 1;
        rafCallbacks.push({ id, callback });
        return id;
      }),
    );
    vi.stubGlobal(
      "cancelAnimationFrame",
      vi.fn((id: number) => {
        const index = rafCallbacks.findIndex((item) => item.id === id);
        if (index >= 0) rafCallbacks.splice(index, 1);
      }),
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      right: 810,
      bottom: 620,
      width: 800,
      height: 600,
      toJSON: () => ({}),
    });
    Object.defineProperty(HTMLElement.prototype, "getWebContentsId", {
      configurable: true,
      value: vi.fn(() => 42),
    });

    const api: Partial<GrokApi> = {
      browserAttachWebview,
      browserSetViewport,
      browserNavigate,
      browserFocus,
      browserGoBack,
      browserGoForward,
      browserReload,
      getBrowserState,
      onBrowserState: vi.fn((listener) => {
        stateListener = listener;
        return () => {
          stateListener = null;
        };
      }),
      onBrowserDestroyRequest: vi.fn(() => () => undefined),
    };
    Object.defineProperty(window, "grok", {
      configurable: true,
      value: api,
    });
  });

  afterEach(() => {
    destroyBrowserWebview("right-1");
    destroyBrowserWebview("bottom-1");
    cleanup();
    Reflect.deleteProperty(HTMLElement.prototype, "getWebContentsId");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(window, "grok");
  });

  it("creates an isolated webview in the pane and attaches its guest", async () => {
    const { container } = render(
      <BrowserPane
        browserId="right-1"
        open
        startUrl=" https://fixture.test/start "
      />,
    );
    await act(async () => undefined);
    await flushRaf();

    const webview = container.querySelector("webview")!;
    expect(webview.getAttribute("partition")).toBe(
      "persist:grok-browser-right-1",
    );
    expect(webview.getAttribute("src")).toBe("https://fixture.test/start");
    expect(webview.getAttribute("webpreferences")).toContain(
      "nodeIntegration=no",
    );

    fireEvent(webview, new Event("dom-ready"));
    await act(async () => undefined);
    expect(browserAttachWebview).toHaveBeenCalledWith({
      id: "right-1",
      webContentsId: 42,
      width: 800,
      height: 600,
    });
    expect(browserSetViewport).toHaveBeenCalledWith({
      id: "right-1",
      width: 800,
      height: 600,
    });
  });

  it("retains the guest offscreen while its panel is collapsed or unmounted", async () => {
    const { container, rerender, unmount } = render(
      <BrowserPane browserId="right-1" open />,
    );
    await act(async () => undefined);
    const host = container.querySelector(".browser-pane-webview-host")!;

    rerender(<BrowserPane browserId="right-1" open={false} />);
    expect(host.parentElement?.className).toBe(
      "browser-webview-retained-root",
    );
    expect((host as HTMLElement).dataset.retained).toBe("true");

    unmount();
    expect(document.body.contains(host)).toBe(true);
  });

  it("strictly ignores state events for another browser slot", async () => {
    render(<BrowserPane browserId="right-1" open />);
    await act(async () => undefined);
    const address = screen.getByLabelText("browser.url") as HTMLInputElement;

    act(() => {
      stateListener?.(
        browserState({
          id: "bottom-1" as BrowserId,
          url: "https://other.test/",
        }),
      );
    });
    expect(address.value).toBe("https://fixture.test/");

    act(() => {
      stateListener?.(
        browserState({ id: "right-1", url: "https://updated.test/" }),
      );
    });
    expect(address.value).toBe("https://updated.test/");
  });

  it("keeps a focused address draft and submits it to the matching slot", async () => {
    vi.useFakeTimers();
    render(<BrowserPane browserId="right-1" open />);
    await act(async () => undefined);
    const address = screen.getByLabelText("browser.url") as HTMLInputElement;

    fireEvent.focus(address);
    fireEvent.change(address, { target: { value: " destination.test " } });
    act(() => {
      stateListener?.(
        browserState({ url: "https://background-navigation.test/" }),
      );
    });
    expect(address.value).toBe(" destination.test ");

    currentState = browserState({ url: "https://destination.test/" });
    fireEvent.submit(address.closest("form")!);
    await act(async () => undefined);

    expect(browserNavigate).toHaveBeenCalledWith({
      id: "right-1",
      url: "destination.test",
    });
    expect(browserFocus).toHaveBeenCalledWith("right-1");
    vi.useRealTimers();
  });

  it("does not navigate while Enter confirms IME composition", async () => {
    render(<BrowserPane browserId="right-1" open />);
    await act(async () => undefined);
    const address = screen.getByLabelText("browser.url");
    browserNavigate.mockClear();

    fireEvent.change(address, { target: { value: "例子.测试" } });
    fireEvent.compositionStart(address);
    fireEvent.submit(address.closest("form")!);
    expect(browserNavigate).not.toHaveBeenCalled();
  });

  it("routes history and reload controls", async () => {
    currentState = browserState({ canGoBack: true, canGoForward: true });
    render(<BrowserPane browserId="right-1" open />);
    await act(async () => undefined);

    fireEvent.click(screen.getByLabelText("browser.back"));
    fireEvent.click(screen.getByLabelText("browser.forward"));
    fireEvent.click(screen.getByLabelText("browser.reload"));
    await act(async () => undefined);

    expect(browserGoBack).toHaveBeenCalledWith("right-1");
    expect(browserGoForward).toHaveBeenCalledWith("right-1");
    expect(browserReload).toHaveBeenCalledWith("right-1");
  });

  it("retries a failed page through the existing guest", async () => {
    currentState = browserState({
      open: false,
      url: "about:blank",
      error: "fixture failed",
    });
    render(
      <BrowserPane
        browserId="right-1"
        open
        startUrl="https://fixture.test/retry"
      />,
    );
    await act(async () => undefined);

    currentState = browserState({ error: null });
    fireEvent.click(screen.getByText("common.retry"));
    await act(async () => undefined);

    expect(browserNavigate).toHaveBeenCalledWith({
      id: "right-1",
      url: "https://fixture.test/retry",
    });
  });

  it("coalesces ResizeObserver viewport reports to one animation frame", async () => {
    render(<BrowserPane browserId="right-1" open />);
    await act(async () => undefined);
    await flushRaf();
    browserSetViewport.mockClear();

    act(() => {
      for (const callback of ResizeObserverMock.callbacks) {
        callback([], {} as ResizeObserver);
        callback([], {} as ResizeObserver);
      }
    });
    expect(cancelAnimationFrame).toHaveBeenCalled();
    await flushRaf();

    expect(browserSetViewport).toHaveBeenCalledTimes(1);
  });

  it("navigates an existing guest when a new start URL is supplied", async () => {
    const { rerender } = render(
      <BrowserPane browserId="right-1" open />,
    );
    await act(async () => undefined);
    browserNavigate.mockClear();

    rerender(
      <BrowserPane
        browserId="right-1"
        open
        startUrl="https://new-start.test/"
      />,
    );
    await act(async () => undefined);

    expect(browserNavigate).toHaveBeenCalledWith({
      id: "right-1",
      url: "https://new-start.test/",
    });
  });
});
