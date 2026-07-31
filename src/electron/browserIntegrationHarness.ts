import { createServer, type Server } from "node:http";
import { writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { app, BrowserWindow, type WebContents } from "electron";
import { BrowserAutomation } from "./browserAutomation.js";
import { attachBrowserWindow } from "./browserIpc.js";
import { browserRegistry } from "./browserSession.js";

const resultPath = process.env.GROK_GUI_BROWSER_INTEGRATION_RESULT ?? "";
let currentStage = "starting";

type PermissionRecord = {
  title: string;
  kind: string;
  rawInput: unknown;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function setStage(stage: string): void {
  currentStage = stage;
  console.log(`[browser-integration] ${stage}`);
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string | (() => string),
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      setTimeout(
        () =>
          reject(
            new Error(typeof message === "function" ? message() : message),
          ),
        timeoutMs,
      );
    }),
  ]);
}

function waitForMainFrameLoad(
  contents: WebContents,
  timeoutMs: number,
): Promise<void> {
  return withTimeout(
    new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        contents.removeListener("did-finish-load", onFinish);
        contents.removeListener("did-fail-load", onFail);
      };
      const onFinish = () => {
        cleanup();
        resolve();
      };
      const onFail = (
        _event: unknown,
        errorCode: number,
        errorDescription: string,
        _validatedUrl: string,
        isMainFrame: boolean,
      ) => {
        if (!isMainFrame || errorCode === -3) return;
        cleanup();
        reject(
          new Error(
            `Embedded browser failed to load: ${errorDescription} (${errorCode}).`,
          ),
        );
      };

      contents.once("did-finish-load", onFinish);
      contents.on("did-fail-load", onFail);

      // Register listeners before checking the current state so a load that
      // finishes between attachment and this check cannot be missed.
      if (!contents.isLoadingMainFrame()) {
        cleanup();
        resolve();
      }
    }),
    timeoutMs,
    "Timed out waiting for the embedded browser main frame to load.",
  );
}

function fixtureHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Browser fixture</title></head>
  <body>
    <main>
      <h1>Browser automation fixture</h1>
      <button id="ordinary">Next step</button>
      <form id="form">
        <label>Name <input aria-label="Name" name="name"></label>
        <label>Password <input aria-label="Password" name="password" type="password"></label>
        <button type="submit">Continue</button>
      </form>
      <button id="delete">Delete account</button>
      <button id="popup">Open popup</button>
      <output id="status">Idle</output>
    </main>
    <script>
      document.querySelector("#ordinary").addEventListener("click", () => {
        document.querySelector("#status").textContent = "Ordinary click complete";
      });
      document.querySelector("#form").addEventListener("submit", (event) => {
        event.preventDefault();
        document.querySelector("#status").textContent = "Submitted";
      });
      document.querySelector("#delete").addEventListener("click", () => {
        document.querySelector("#status").textContent = "Deleted";
      });
      document.querySelector("#popup").addEventListener("click", () => {
        window.open("/popup");
      });
    </script>
  </body>
</html>`;
}

function startFixtureServer(): Promise<{
  server: Server;
  origin: string;
}> {
  const server = createServer((request, response) => {
    if (request.url === "/disconnect") {
      request.socket.destroy();
      return;
    }
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    if (request.url === "/popup") {
      response.end(
        "<!doctype html><title>Popup fixture</title><h1>Popup target</h1>",
      );
      return;
    }
    response.end(fixtureHtml());
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address() as AddressInfo;
      resolve({
        server,
        origin: `http://127.0.0.1:${address.port}`,
      });
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
}

function refFor(snapshot: string, name: string): string {
  const quoted = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = snapshot.match(
    new RegExp(`\\[(e\\d+)\\]\\s+\\w+\\s+"${quoted}"`),
  );
  if (!match?.[1]) {
    throw new Error(`Fixture element ${JSON.stringify(name)} has no ref.`);
  }
  return match[1];
}

async function run(): Promise<Record<string, unknown>> {
  setStage("starting fixture server");
  const fixture = await startFixtureServer();
  let win: BrowserWindow | null = null;
  try {
    setStage("creating renderer window");
    win = new BrowserWindow({
      show: true,
      width: 1000,
      height: 800,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: true,
      },
    });
    attachBrowserWindow(win);

    const permissionRequests: PermissionRecord[] = [];
    const automation = new BrowserAutomation(async (request) => {
      permissionRequests.push(request);
      return false;
    });

    const guestAttached = new Promise<WebContents>((resolve) => {
      win!.webContents.once("did-attach-webview", (_event, contents) => {
        browserRegistry.attach("right-1", contents, {
          width: 800,
          height: 600,
        });
        resolve(contents);
      });
    });
    setStage("loading renderer host");
    await win.loadURL(
      `data:text/html,${encodeURIComponent(
        '<!doctype html><style>html,body,webview{width:100%;height:100%;margin:0;display:flex}</style><body></body>',
      )}`,
    );
    setStage("creating retained webview");
    await win.webContents.executeJavaScript(`
      (() => {
        const view = document.createElement("webview");
        view.setAttribute("partition", "persist:grok-browser-right-1");
        view.setAttribute("allowpopups", "");
        view.setAttribute("webpreferences", "contextIsolation=yes,nodeIntegration=no,sandbox=yes");
        view.setAttribute("src", ${JSON.stringify(fixture.origin)});
        document.body.append(view);
      })()
    `);
    const guest = await withTimeout(
      guestAttached,
      10_000,
      "Timed out waiting for the renderer webview guest to attach.",
    );
    setStage("waiting for fixture page");
    await waitForMainFrameLoad(guest, 10_000);

    setStage("capturing accessibility snapshot");
    const firstSnapshot = await automation.snapshot({
      browserId: "right-1",
    });
    assert(
      firstSnapshot.text.includes("Browser automation fixture"),
      "Accessibility snapshot did not contain the fixture heading.",
    );

    setStage("clicking an ordinary control");
    await automation.click({
      browserId: "right-1",
      ref: refFor(firstSnapshot.text, "Next step"),
    });
    try {
      await automation.waitFor({
        browserId: "right-1",
        text: "Ordinary click complete",
        timeoutMs: 5_000,
      });
    } catch (error) {
      const status = await guest.executeJavaScript(
        "document.querySelector('#status')?.textContent ?? ''",
      );
      throw new Error(
        `Ordinary click wait failed (status=${JSON.stringify(status)}).`,
        { cause: error },
      );
    }
    assert(
      permissionRequests.length === 0,
      "Ordinary click unexpectedly requested permission.",
    );

    setStage("filling an ordinary field");
    await automation.fill({
      browserId: "right-1",
      ref: refFor(firstSnapshot.text, "Name"),
      value: "Alice",
    });
    const contents = browserRegistry.getWebContents("right-1");
    assert(contents, "Browser contents closed during the fixture test.");
    const nameValue = await contents.executeJavaScript(
      "document.querySelector('input[name=name]').value",
    );
    assert(nameValue === "Alice", "Ordinary field fill did not update the page.");

    setStage("checking password permission");
    let passwordDenied = false;
    try {
      await automation.fill({
        browserId: "right-1",
        ref: refFor(firstSnapshot.text, "Password"),
        value: "fixture-secret",
      });
    } catch (error) {
      passwordDenied =
        error instanceof Error &&
        error.message.includes("denied filling the password");
    }
    assert(passwordDenied, "Password fill was not denied.");
    const passwordPermission = permissionRequests.at(-1);
    assert(
      JSON.stringify(passwordPermission?.rawInput).includes("<redacted>"),
      "Password permission input was not redacted.",
    );
    assert(
      !JSON.stringify(permissionRequests).includes("fixture-secret"),
      "Password secret leaked into permission input.",
    );

    setStage("checking submit permission");
    let submitDenied = false;
    try {
      await automation.click({
        browserId: "right-1",
        ref: refFor(firstSnapshot.text, "Continue"),
      });
    } catch (error) {
      submitDenied =
        error instanceof Error &&
        error.message.includes("denied the browser action");
    }
    assert(submitDenied, "Submit control did not require permission.");
    const statusAfterDeniedSubmit = await contents.executeJavaScript(
      "document.querySelector('#status').textContent",
    );
    assert(
      statusAfterDeniedSubmit === "Ordinary click complete",
      "Denied submit still changed the page.",
    );

    setStage("intercepting a popup");
    await automation.click({
      browserId: "right-1",
      ref: refFor(firstSnapshot.text, "Open popup"),
    });
    try {
      await automation.waitFor({
        browserId: "right-1",
        urlContains: "/popup",
        text: "Popup target",
        timeoutMs: 5_000,
      });
    } catch (error) {
      throw new Error(
        `Popup wait failed (url=${JSON.stringify(
          browserRegistry.getState("right-1").url,
        )}).`,
        { cause: error },
      );
    }
    assert(
      browserRegistry.getState("right-1").url.endsWith("/popup"),
      "Popup was not redirected into the same embedded browser slot.",
    );

    setStage("capturing a screenshot");
    const screenshot = await automation.screenshot({
      browserId: "right-1",
    });
    assert(
      screenshot.image?.mimeType === "image/png" &&
        screenshot.image.data.length > 100,
      "Browser screenshot did not return PNG data.",
    );

    setStage("checking a failed navigation");
    await automation.navigate({
      browserId: "right-1",
      url: `${fixture.origin}/disconnect`,
    });
    assert(
      Boolean(browserRegistry.getState("right-1").error),
      "Disconnected fixture response did not surface a load error.",
    );

    setStage("checking unsafe URL rejection");
    let unsafeRejected = false;
    try {
      await automation.navigate({
        browserId: "right-1",
        url: "file:///fixture-secret",
      });
    } catch (error) {
      unsafeRejected =
        error instanceof Error && error.message.includes("only allows HTTP(S)");
    }
    assert(unsafeRejected, "Unsafe file navigation was not rejected.");

    setStage("completed");
    return {
      ok: true,
      fixtureOrigin: fixture.origin,
      checks: [
        "real retained webview navigation",
        "accessibility snapshot and refs",
        "ordinary click and fill",
        "password redaction and denial",
        "submit denial before page action",
        "same-slot popup interception",
        "wait and screenshot",
        "load error",
        "unsafe URL rejection",
      ],
    };
  } finally {
    await browserRegistry.closeAll();
    browserRegistry.setWindow(null);
    if (win && !win.isDestroyed()) win.destroy();
    await closeServer(fixture.server);
  }
}

async function finish(): Promise<void> {
  try {
    assert(resultPath, "Missing browser integration result path.");
    const result = await withTimeout(
      run(),
      45_000,
      () => `Browser integration timed out during: ${currentStage}.`,
    );
    await writeFile(resultPath, JSON.stringify(result, null, 2), "utf8");
    app.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    if (resultPath) {
      await writeFile(
        resultPath,
        JSON.stringify({ ok: false, error: message }, null, 2),
        "utf8",
      ).catch(() => undefined);
    }
    app.exit(1);
  }
}

void app.whenReady().then(finish);
