import type { WebContents } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const registry = vi.hoisted(() => ({
  findAutomationTargetId: vi.fn(),
  requestRendererOpen: vi.fn(),
  navigate: vi.fn(),
  getWebContents: vi.fn(),
  getState: vi.fn(),
}));

vi.mock("./browserSession.js", () => ({
  browserRegistry: registry,
}));

import { BrowserAutomation } from "./browserAutomation";

type CommandHandler = (
  method: string,
  params: Record<string, unknown>,
) => Record<string, unknown> | Promise<Record<string, unknown>>;

function fakeWebContents(handler: CommandHandler = () => ({})): WebContents {
  const sendCommand = vi.fn(
    async (method: string, params: Record<string, unknown> = {}) =>
      handler(method, params),
  );
  return {
    debugger: {
      isAttached: vi.fn(() => false),
      attach: vi.fn(),
      sendCommand,
    },
    getURL: vi.fn(() => "https://fixture.test/form"),
    getTitle: vi.fn(() => "Fixture"),
    capturePage: vi.fn(async () => ({
      toPNG: () => Buffer.from("png"),
    })),
  } as unknown as WebContents;
}

function commandCalls(webContents: WebContents, prefix: string): string[] {
  const sendCommand = vi.mocked(webContents.debugger.sendCommand);
  return sendCommand.mock.calls
    .map(([method]) => method)
    .filter((method) => method.startsWith(prefix));
}

describe("BrowserAutomation", () => {
  const requestPermission = vi.fn(async () => true);
  let webContents: WebContents;

  beforeEach(() => {
    vi.clearAllMocks();
    webContents = fakeWebContents();
    registry.findAutomationTargetId.mockImplementation(
      (requestedId?: string | null) => requestedId || "right-1",
    );
    registry.getWebContents.mockReturnValue(webContents);
    registry.getState.mockImplementation((id: string) => ({
      id,
      open: true,
      url: "https://fixture.test/form",
      title: "Fixture",
      canGoBack: false,
      canGoForward: false,
      cdpEndpoint: null,
      error: null,
      viewport: { width: 800, height: 600 },
      anyOpen: true,
    }));
    registry.navigate.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(["file:///tmp/a", "javascript:alert(1)", "data:text/plain,no"])(
    "rejects unsafe automation URL %s before opening a target",
    async (url) => {
      const automation = new BrowserAutomation(requestPermission);

      await expect(automation.navigate({ url })).rejects.toThrow(
        "only allows HTTP(S)",
      );
      expect(registry.findAutomationTargetId).not.toHaveBeenCalled();
      expect(registry.navigate).not.toHaveBeenCalled();
    },
  );

  it("accepts HTTP(S) and host-like URLs while preserving the requested slot", async () => {
    const automation = new BrowserAutomation(requestPermission);

    await automation.open({
      browserId: "bottom-2",
      url: "https://fixture.test/start",
    });
    await automation.navigate({ browserId: "bottom-2", url: "fixture.test/next" });

    expect(registry.navigate).toHaveBeenNthCalledWith(
      1,
      "bottom-2",
      "https://fixture.test/start",
    );
    expect(registry.navigate).toHaveBeenNthCalledWith(
      2,
      "bottom-2",
      "fixture.test/next",
    );
  });

  it("reports an explicitly requested closed slot without opening another pane", async () => {
    registry.findAutomationTargetId.mockReturnValue(null);
    const automation = new BrowserAutomation(requestPermission);

    await expect(
      automation.snapshot({ browserId: "right-9" }),
    ).rejects.toThrow("Browser slot right-9 is not open.");
    expect(registry.requestRendererOpen).not.toHaveBeenCalled();
  });

  it("builds bounded accessibility refs and rejects stale or cross-slot refs", async () => {
    const nodes = [
      {
        role: { value: "button" },
        name: { value: "Continue" },
        backendDOMNodeId: 41,
      },
      {
        role: { value: "StaticText" },
        name: { value: "Welcome" },
      },
      {
        ignored: true,
        role: { value: "button" },
        name: { value: "Ignored" },
        backendDOMNodeId: 99,
      },
      ...Array.from({ length: 400 }, (_, index) => ({
        role: { value: "StaticText" },
        name: { value: `Line ${index}` },
      })),
    ];
    webContents = fakeWebContents((method) =>
      method === "Accessibility.getFullAXTree" ? { nodes } : {},
    );
    registry.getWebContents.mockReturnValue(webContents);
    const automation = new BrowserAutomation(requestPermission);

    const snapshot = await automation.snapshot({ browserId: "right-1" });

    expect(snapshot.text).toContain('[e1] button "Continue"');
    expect(snapshot.text).not.toContain("Ignored");
    expect(snapshot.text.split("\n").slice(4)).toHaveLength(300);

    await expect(
      automation.click({ browserId: "bottom-1", ref: "e1" }),
    ).rejects.toThrow("Unknown element ref e1");

    await automation.navigate({
      browserId: "right-1",
      url: "https://fixture.test/next",
    });
    await expect(
      automation.click({ browserId: "right-1", ref: "e1" }),
    ).rejects.toThrow("Call browser_snapshot again");
  });

  it("clicks the center of a non-sensitive element without prompting", async () => {
    webContents = fakeWebContents((method) => {
      if (method === "Accessibility.getFullAXTree") {
        return {
          nodes: [
            {
              role: { value: "button" },
              name: { value: "Next page" },
              backendDOMNodeId: 7,
            },
          ],
        };
      }
      if (method === "DOM.resolveNode") return { object: { objectId: "node-7" } };
      if (method === "Runtime.callFunctionOn") return { result: { value: false } };
      if (method === "DOM.getBoxModel") {
        return { model: { content: [10, 20, 30, 20, 30, 40, 10, 40] } };
      }
      return {};
    });
    registry.getWebContents.mockReturnValue(webContents);
    const automation = new BrowserAutomation(requestPermission);
    await automation.snapshot({ browserId: "right-1" });

    await automation.click({ browserId: "right-1", ref: "e1" });

    expect(requestPermission).not.toHaveBeenCalled();
    expect(webContents.debugger.sendCommand).toHaveBeenCalledWith(
      "Input.dispatchMouseEvent",
      expect.objectContaining({ type: "mousePressed", x: 20, y: 30 }),
    );
  });

  it("stops before input when a sensitive click is denied", async () => {
    requestPermission.mockResolvedValueOnce(false);
    webContents = fakeWebContents((method) => {
      if (method === "Accessibility.getFullAXTree") {
        return {
          nodes: [
            {
              role: { value: "button" },
              name: { value: "Delete account" },
              backendDOMNodeId: 8,
            },
          ],
        };
      }
      if (method === "DOM.resolveNode") return {};
      return {};
    });
    registry.getWebContents.mockReturnValue(webContents);
    const automation = new BrowserAutomation(requestPermission);
    await automation.snapshot({ browserId: "right-1" });

    await expect(
      automation.click({ browserId: "right-1", ref: "e1" }),
    ).rejects.toThrow("User denied the browser action.");

    expect(requestPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "browser",
        title: "Click Delete account",
      }),
    );
    expect(commandCalls(webContents, "Input.")).toEqual([]);
  });

  it("treats a submit control as sensitive even when its label is neutral", async () => {
    requestPermission.mockResolvedValueOnce(false);
    webContents = fakeWebContents((method) => {
      if (method === "Accessibility.getFullAXTree") {
        return {
          nodes: [
            {
              role: { value: "button" },
              name: { value: "Continue" },
              backendDOMNodeId: 9,
            },
          ],
        };
      }
      if (method === "DOM.resolveNode") return { object: { objectId: "submit" } };
      if (method === "Runtime.callFunctionOn") return { result: { value: true } };
      return {};
    });
    registry.getWebContents.mockReturnValue(webContents);
    const automation = new BrowserAutomation(requestPermission);
    await automation.snapshot({ browserId: "right-1" });

    await expect(
      automation.click({ browserId: "right-1", ref: "e1" }),
    ).rejects.toThrow("User denied");
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(commandCalls(webContents, "Input.")).toEqual([]);
  });

  it("redacts a password value and stops before editing when denied", async () => {
    requestPermission.mockResolvedValueOnce(false);
    webContents = fakeWebContents((method) => {
      if (method === "Accessibility.getFullAXTree") {
        return {
          nodes: [
            {
              role: { value: "textbox" },
              name: { value: "Password" },
              backendDOMNodeId: 10,
            },
          ],
        };
      }
      if (method === "DOM.describeNode") {
        return { node: { attributes: ["type", "password"] } };
      }
      return {};
    });
    registry.getWebContents.mockReturnValue(webContents);
    const automation = new BrowserAutomation(requestPermission);
    await automation.snapshot({ browserId: "right-1" });

    await expect(
      automation.fill({
        browserId: "right-1",
        ref: "e1",
        value: "super-secret",
      }),
    ).rejects.toThrow("denied filling the password");

    expect(requestPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        rawInput: { browserId: "right-1", ref: "e1", value: "<redacted>" },
      }),
    );
    expect(JSON.stringify(requestPermission.mock.calls)).not.toContain(
      "super-secret",
    );
    expect(webContents.debugger.sendCommand).not.toHaveBeenCalledWith(
      "DOM.focus",
      expect.anything(),
    );
    expect(commandCalls(webContents, "Input.")).toEqual([]);
  });

  it("replaces ordinary field text with trusted Chromium input", async () => {
    webContents = fakeWebContents((method) => {
      if (method === "Accessibility.getFullAXTree") {
        return {
          nodes: [
            {
              role: { value: "textbox" },
              name: { value: "Search" },
              backendDOMNodeId: 11,
            },
          ],
        };
      }
      if (method === "DOM.describeNode") return { node: { attributes: [] } };
      return {};
    });
    registry.getWebContents.mockReturnValue(webContents);
    const automation = new BrowserAutomation(requestPermission);
    await automation.snapshot({ browserId: "right-1" });

    await automation.fill({
      browserId: "right-1",
      ref: "e1",
      value: "hello",
    });

    expect(requestPermission).not.toHaveBeenCalled();
    expect(webContents.debugger.sendCommand).toHaveBeenCalledWith(
      "DOM.focus",
      { backendNodeId: 11 },
    );
    expect(webContents.debugger.sendCommand).toHaveBeenCalledWith(
      "Input.insertText",
      { text: "hello" },
    );
  });

  it("requires permission before Enter submits a focused form", async () => {
    requestPermission.mockResolvedValueOnce(false);
    webContents = fakeWebContents((method) =>
      method === "Runtime.evaluate"
        ? { result: { value: { inForm: true, name: "email" } } }
        : {},
    );
    registry.getWebContents.mockReturnValue(webContents);
    const automation = new BrowserAutomation(requestPermission);

    await expect(
      automation.pressKey({ browserId: "right-1", key: "Enter" }),
    ).rejects.toThrow("denied submitting");

    expect(requestPermission).toHaveBeenCalledWith({
      title: "Submit browser form from email",
      kind: "browser",
      rawInput: { browserId: "right-1", key: "Enter" },
    });
    expect(commandCalls(webContents, "Input.")).toEqual([]);
  });

  it("maps keys, scrolls at the viewport center, and returns native screenshots", async () => {
    webContents = fakeWebContents((method) => {
      if (method === "Runtime.evaluate") {
        return { result: { value: { inForm: false } } };
      }
      return {};
    });
    registry.getWebContents.mockReturnValue(webContents);
    const automation = new BrowserAutomation(requestPermission);

    await automation.pressKey({ browserId: "right-1", key: "ArrowDown" });
    await automation.scroll({ browserId: "right-1" });
    const screenshot = await automation.screenshot({ browserId: "right-1" });

    expect(webContents.debugger.sendCommand).toHaveBeenCalledWith(
      "Input.dispatchKeyEvent",
      expect.objectContaining({ type: "keyDown", key: "ArrowDown" }),
    );
    expect(webContents.debugger.sendCommand).toHaveBeenCalledWith(
      "Input.dispatchMouseEvent",
      expect.objectContaining({
        type: "mouseWheel",
        x: 400,
        y: 300,
        deltaX: 0,
        deltaY: 600,
      }),
    );
    expect(screenshot.image).toEqual({ data: "cG5n", mimeType: "image/png" });
    expect(webContents.capturePage).toHaveBeenCalledOnce();
    expect(
      commandCalls(webContents, "Page.captureScreenshot"),
    ).toEqual([]);
  });

  it("waits for both URL and page text and caps timeout input", async () => {
    webContents = fakeWebContents((method) =>
      method === "Runtime.evaluate"
        ? { result: { value: "Ready to continue" } }
        : {},
    );
    registry.getWebContents.mockReturnValue(webContents);
    const automation = new BrowserAutomation(requestPermission);

    await expect(
      automation.waitFor({
        browserId: "right-1",
        text: "READY",
        urlContains: "/form",
      }),
    ).resolves.toEqual({ text: "Condition matched in browser right-1." });

    vi.useFakeTimers();
    webContents = fakeWebContents((method) =>
      method === "Runtime.evaluate" ? { result: { value: "not yet" } } : {},
    );
    registry.getWebContents.mockReturnValue(webContents);
    const pending = automation.waitFor({
      browserId: "right-1",
      text: "missing",
      timeoutMs: 1,
    });
    const assertion = expect(pending).rejects.toThrow(
      "Timed out after 100ms",
    );
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
  });

  it("surfaces incomplete CDP responses with actionable errors", async () => {
    webContents = fakeWebContents((method) => {
      if (method === "Accessibility.getFullAXTree") {
        return {
          nodes: [
            {
              role: { value: "button" },
              name: { value: "Next" },
              backendDOMNodeId: 12,
            },
          ],
        };
      }
      if (method === "DOM.resolveNode") return {};
      return {};
    });
    registry.getWebContents.mockReturnValue(webContents);
    const automation = new BrowserAutomation(requestPermission);
    await automation.snapshot({ browserId: "right-1" });
    vi.mocked(webContents.capturePage).mockResolvedValueOnce({
      toPNG: () => Buffer.alloc(0),
    } as never);

    await expect(
      automation.click({ browserId: "right-1", ref: "e1" }),
    ).rejects.toThrow("Element e1 has no clickable box.");

    await expect(
      automation.screenshot({ browserId: "right-1" }),
    ).rejects.toThrow("Browser screenshot returned no data.");
  });
});
