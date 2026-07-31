import type { WebContents } from "electron";
import { browserRegistry, type BrowserId } from "./browserSession.js";

export type BrowserToolResult = {
  text: string;
  image?: { data: string; mimeType: "image/png" };
};

export type BrowserPermissionRequest = (input: {
  title: string;
  kind: string;
  rawInput: unknown;
}) => Promise<boolean>;

type AxValue = { value?: unknown };
type AxNode = {
  ignored?: boolean;
  role?: AxValue;
  name?: AxValue;
  value?: AxValue;
  backendDOMNodeId?: number;
};

type ElementRef = {
  backendNodeId: number;
  role: string;
  name: string;
};

const ACTIONABLE_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "link",
  "listbox",
  "menuitem",
  "option",
  "radio",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
  "treeitem",
]);

const SENSITIVE_ACTION_RE =
  /\b(submit|purchase|buy|pay|send|delete|remove|confirm|place order|checkout|log in|login|sign in|publish|post)\b|提交|购买|付款|支付|发送|删除|移除|确认|登录|发布|下单/i;

function asText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertSafeUrl(url: string): void {
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) return;
  const protocol = new URL(url).protocol.toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error("Browser MCP navigation only allows HTTP(S) URLs.");
  }
}

export class BrowserAutomation {
  private refs = new Map<BrowserId, Map<string, ElementRef>>();
  private requestPermission: BrowserPermissionRequest;

  constructor(requestPermission: BrowserPermissionRequest) {
    this.requestPermission = requestPermission;
  }

  private async target(
    requestedId?: string | null,
    startUrl?: string,
  ): Promise<{ id: BrowserId; webContents: WebContents }> {
    let id = browserRegistry.findAutomationTargetId(requestedId);
    if (!id && requestedId) {
      throw new Error(`Browser slot ${requestedId} is not open.`);
    }
    if (!id) {
      browserRegistry.requestRendererOpen();
      const deadline = Date.now() + 8_000;
      while (!id && Date.now() < deadline) {
        await delay(50);
        id = browserRegistry.findAutomationTargetId();
      }
    }
    if (!id) {
      throw new Error("The GUI browser pane did not become ready.");
    }
    if (startUrl) await browserRegistry.navigate(id, startUrl);
    const webContents = browserRegistry.getWebContents(id);
    if (!webContents) throw new Error(`Browser slot ${id} was closed.`);
    return { id, webContents };
  }

  private async command(
    webContents: WebContents,
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    if (!webContents.debugger.isAttached()) {
      webContents.debugger.attach("1.3");
    }
    return (await webContents.debugger.sendCommand(method, params)) as Record<
      string,
      unknown
    >;
  }

  async open(args: Record<string, unknown>): Promise<BrowserToolResult> {
    const url = asText(args.url) || undefined;
    if (url) assertSafeUrl(url);
    const target = await this.target(asText(args.browserId) || null, url);
    const state = browserRegistry.getState(target.id);
    return {
      text: `Browser ${target.id} is open at ${state.url}.`,
    };
  }

  async snapshot(args: Record<string, unknown>): Promise<BrowserToolResult> {
    const { id, webContents } = await this.target(asText(args.browserId) || null);
    await this.command(webContents, "Accessibility.enable");
    const result = await this.command(webContents, "Accessibility.getFullAXTree");
    const nodes = Array.isArray(result.nodes) ? (result.nodes as AxNode[]) : [];
    const refs = new Map<string, ElementRef>();
    const lines: string[] = [];
    let refSeq = 0;

    for (const node of nodes) {
      if (node.ignored) continue;
      const role = asText(node.role?.value).toLowerCase();
      const name = asText(node.name?.value);
      const value = asText(node.value?.value);
      if (!role || (!name && !value)) continue;
      const actionable =
        ACTIONABLE_ROLES.has(role) && Number.isFinite(node.backendDOMNodeId);
      let prefix = "";
      if (actionable) {
        const ref = `e${++refSeq}`;
        refs.set(ref, {
          backendNodeId: Number(node.backendDOMNodeId),
          role,
          name,
        });
        prefix = `[${ref}] `;
      }
      const detail = value && value !== name ? ` value=${JSON.stringify(value)}` : "";
      lines.push(`${prefix}${role} ${JSON.stringify(name || value)}${detail}`);
      if (lines.length >= 300) break;
    }

    this.refs.set(id, refs);
    const header = `Browser ${id}\nURL: ${webContents.getURL()}\nTitle: ${webContents.getTitle()}`;
    return {
      text: `${header}\n\n${lines.join("\n") || "No accessible page content found."}`,
    };
  }

  private element(id: BrowserId, ref: string): ElementRef {
    const element = this.refs.get(id)?.get(ref);
    if (!element) {
      throw new Error(`Unknown element ref ${ref}. Call browser_snapshot again.`);
    }
    return element;
  }

  private async allowSensitive(
    element: ElementRef,
    action: string,
    rawInput: unknown,
    force = false,
  ): Promise<void> {
    if (!force && !SENSITIVE_ACTION_RE.test(element.name)) return;
    const allowed = await this.requestPermission({
      title: `${action} ${element.name || element.role}`,
      kind: "browser",
      rawInput,
    });
    if (!allowed) throw new Error("User denied the browser action.");
  }

  async navigate(args: Record<string, unknown>): Promise<BrowserToolResult> {
    const url = asText(args.url);
    if (!url) throw new Error("url is required.");
    assertSafeUrl(url);
    const { id } = await this.target(asText(args.browserId) || null, url);
    this.refs.delete(id);
    return { text: `Navigated browser ${id} to ${browserRegistry.getState(id).url}.` };
  }

  async click(args: Record<string, unknown>): Promise<BrowserToolResult> {
    const ref = asText(args.ref);
    if (!ref) throw new Error("ref is required.");
    const { id, webContents } = await this.target(asText(args.browserId) || null);
    const element = this.element(id, ref);
    const submitLike = await this.isSubmitControl(webContents, element);
    await this.allowSensitive(
      element,
      "Click",
      { browserId: id, ref, ...args },
      submitLike,
    );
    await this.command(webContents, "DOM.scrollIntoViewIfNeeded", {
      backendNodeId: element.backendNodeId,
    });
    const box = await this.command(webContents, "DOM.getBoxModel", {
      backendNodeId: element.backendNodeId,
    });
    const model = box.model as { content?: number[] } | undefined;
    const quad = model?.content;
    if (!quad || quad.length < 8) throw new Error(`Element ${ref} has no clickable box.`);
    const x = (quad[0]! + quad[2]! + quad[4]! + quad[6]!) / 4;
    const y = (quad[1]! + quad[3]! + quad[5]! + quad[7]!) / 4;
    await this.command(webContents, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y,
    });
    await this.command(webContents, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
    await this.command(webContents, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
    return { text: `Clicked ${ref} (${element.role} ${JSON.stringify(element.name)}).` };
  }

  private async isPassword(
    webContents: WebContents,
    element: ElementRef,
  ): Promise<boolean> {
    const result = await this.command(webContents, "DOM.describeNode", {
      backendNodeId: element.backendNodeId,
      depth: 0,
    });
    const attrs = (result.node as { attributes?: string[] } | undefined)?.attributes ?? [];
    for (let i = 0; i < attrs.length; i += 2) {
      if (attrs[i]?.toLowerCase() === "type" && attrs[i + 1]?.toLowerCase() === "password") {
        return true;
      }
    }
    return false;
  }

  private async isSubmitControl(
    webContents: WebContents,
    element: ElementRef,
  ): Promise<boolean> {
    const resolved = await this.command(webContents, "DOM.resolveNode", {
      backendNodeId: element.backendNodeId,
    });
    const objectId = (resolved.object as { objectId?: unknown } | undefined)
      ?.objectId;
    if (typeof objectId !== "string") return false;
    const checked = await this.command(webContents, "Runtime.callFunctionOn", {
      objectId,
      functionDeclaration:
        "function(){return !!(this.matches?.('input[type=submit],input[type=image],button[type=submit]')||(this.tagName==='BUTTON'&&this.form&&!this.hasAttribute('type')))}",
      returnByValue: true,
    });
    return Boolean(
      (checked.result as { value?: unknown } | undefined)?.value,
    );
  }

  async fill(args: Record<string, unknown>): Promise<BrowserToolResult> {
    const ref = asText(args.ref);
    if (!ref || typeof args.value !== "string") {
      throw new Error("ref and string value are required.");
    }
    const { id, webContents } = await this.target(asText(args.browserId) || null);
    const element = this.element(id, ref);
    if (await this.isPassword(webContents, element)) {
      const allowed = await this.requestPermission({
        title: `Fill password field ${element.name || ref}`,
        kind: "browser",
        rawInput: { browserId: id, ref, value: "<redacted>" },
      });
      if (!allowed) throw new Error("User denied filling the password field.");
    }
    await this.command(webContents, "DOM.focus", {
      backendNodeId: element.backendNodeId,
    });
    const modifiers = process.platform === "darwin" ? 4 : 2;
    await this.command(webContents, "Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "a",
      code: "KeyA",
      modifiers,
    });
    await this.command(webContents, "Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "a",
      code: "KeyA",
      modifiers,
    });
    await this.command(webContents, "Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Backspace",
      code: "Backspace",
    });
    await this.command(webContents, "Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Backspace",
      code: "Backspace",
    });
    await this.command(webContents, "Input.insertText", { text: args.value });
    return { text: `Filled ${ref} (${element.role} ${JSON.stringify(element.name)}).` };
  }

  async pressKey(args: Record<string, unknown>): Promise<BrowserToolResult> {
    const key = asText(args.key);
    if (!key) throw new Error("key is required.");
    const { id, webContents } = await this.target(asText(args.browserId) || null);
    const aliases: Record<string, { key: string; code: string }> = {
      enter: { key: "Enter", code: "Enter" },
      tab: { key: "Tab", code: "Tab" },
      escape: { key: "Escape", code: "Escape" },
      backspace: { key: "Backspace", code: "Backspace" },
      arrowdown: { key: "ArrowDown", code: "ArrowDown" },
      arrowup: { key: "ArrowUp", code: "ArrowUp" },
      arrowleft: { key: "ArrowLeft", code: "ArrowLeft" },
      arrowright: { key: "ArrowRight", code: "ArrowRight" },
    };
    const mapped = aliases[key.toLowerCase()] ?? {
      key,
      code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
    };
    if (mapped.key === "Enter") {
      const focused = await this.command(webContents, "Runtime.evaluate", {
        expression:
          "(()=>{const e=document.activeElement;return {inForm:!!e?.closest?.('form'),name:e?.getAttribute?.('aria-label')||e?.getAttribute?.('name')||e?.tagName||''}})()",
        returnByValue: true,
      });
      const value = (focused.result as { value?: unknown } | undefined)?.value as
        | { inForm?: unknown; name?: unknown }
        | undefined;
      if (value?.inForm) {
        const allowed = await this.requestPermission({
          title: `Submit browser form from ${asText(value.name) || "focused field"}`,
          kind: "browser",
          rawInput: { browserId: id, key: mapped.key },
        });
        if (!allowed) throw new Error("User denied submitting the browser form.");
      }
    }
    await this.command(webContents, "Input.dispatchKeyEvent", {
      type: "keyDown",
      ...mapped,
      ...(key.length === 1 ? { text: key } : {}),
    });
    await this.command(webContents, "Input.dispatchKeyEvent", {
      type: "keyUp",
      ...mapped,
    });
    return { text: `Pressed ${mapped.key} in browser ${id}.` };
  }

  async scroll(args: Record<string, unknown>): Promise<BrowserToolResult> {
    const { id, webContents } = await this.target(asText(args.browserId) || null);
    const viewport = browserRegistry.getState(id).viewport;
    await this.command(webContents, "Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: Math.max(1, Math.round(viewport.width / 2)),
      y: Math.max(1, Math.round(viewport.height / 2)),
      deltaX: typeof args.deltaX === "number" ? args.deltaX : 0,
      deltaY: typeof args.deltaY === "number" ? args.deltaY : 600,
    });
    return { text: `Scrolled browser ${id}.` };
  }

  async screenshot(args: Record<string, unknown>): Promise<BrowserToolResult> {
    const { id, webContents } = await this.target(asText(args.browserId) || null);
    const image = await webContents.capturePage();
    const png = image.toPNG();
    if (png.length === 0) throw new Error("Browser screenshot returned no data.");
    return {
      text: `Screenshot of browser ${id} at ${webContents.getURL()}.`,
      image: { data: png.toString("base64"), mimeType: "image/png" },
    };
  }

  async waitFor(args: Record<string, unknown>): Promise<BrowserToolResult> {
    const text = asText(args.text).toLowerCase();
    const urlContains = asText(args.urlContains).toLowerCase();
    if (!text && !urlContains) throw new Error("text or urlContains is required.");
    const timeoutMs = Math.min(30_000, Math.max(100, Number(args.timeoutMs) || 5_000));
    const deadline = Date.now() + timeoutMs;
    do {
      const { id, webContents } = await this.target(asText(args.browserId) || null);
      const urlMatch = !urlContains || webContents.getURL().toLowerCase().includes(urlContains);
      let textMatch = !text;
      if (text) {
        const evaluated = await this.command(webContents, "Runtime.evaluate", {
          expression: "document.body?.innerText || ''",
          returnByValue: true,
        });
        const value = ((evaluated.result as { value?: unknown } | undefined)?.value ?? "") as unknown;
        textMatch = asText(value).toLowerCase().includes(text);
      }
      if (urlMatch && textMatch) return { text: `Condition matched in browser ${id}.` };
      await delay(200);
    } while (Date.now() < deadline);
    throw new Error(`Timed out after ${timeoutMs}ms waiting for browser condition.`);
  }
}
