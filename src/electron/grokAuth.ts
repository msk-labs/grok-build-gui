import { execFile, spawn, type ChildProcess } from "node:child_process";
import { shell } from "electron";
import { findGrok } from "./findGrok.js";
import {
  clearGrokAuthFile,
  getGrokAccount,
  type GrokAccount,
} from "./grokAccount.js";
import { extractGrokLoginUrl } from "./grokAuthUrl.js";
import { buildSystemProxyEnvironment } from "./systemProxy.js";

export type GrokAuthActionResult = {
  ok: boolean;
  account: GrokAccount;
  error?: string;
};

type ActiveLogin = {
  child: ChildProcess;
  cancelled: boolean;
};

let activeLogin: ActiveLogin | null = null;

function authEnvironment(): Promise<NodeJS.ProcessEnv> {
  return buildSystemProxyEnvironment(process.env, {
    GROK_DISABLE_AUTOUPDATER: "1",
  });
}

function cleanCliMessage(value: string): string {
  return value
    .replace(/\u001b\[[0-?]*[ -\/]*[@-~]/g, "")
    .trim()
    .slice(-4000);
}

function failure(error: string): GrokAuthActionResult {
  return { ok: false, account: getGrokAccount(), error };
}

/** Start the bundled CLI's browser OIDC flow and wait for its local callback. */
export async function loginToGrok(): Promise<GrokAuthActionResult> {
  if (activeLogin) {
    return failure("A Grok sign-in is already in progress.");
  }

  const probe = findGrok();
  if (!probe) {
    return failure("The bundled Grok Build executable is missing or invalid.");
  }

  const env = await authEnvironment();
  if (activeLogin) {
    return failure("A Grok sign-in is already in progress.");
  }
  return new Promise((resolve) => {
    const child = spawn(probe.path, ["login", "--oauth"], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const login: ActiveLogin = { child, cancelled: false };
    activeLogin = login;
    let stdout = "";
    let stderr = "";
    let openedLoginUrl: string | null = null;
    let browserOpenError: string | null = null;

    function openPrintedLoginUrl(): void {
      if (openedLoginUrl) return;
      const url = extractGrokLoginUrl(`${stdout}\n${stderr}`);
      if (!url) return;

      openedLoginUrl = url;
      void shell.openExternal(url).catch((error: unknown) => {
        browserOpenError =
          error instanceof Error
            ? `Could not open the sign-in page: ${error.message}`
            : "Could not open the sign-in page in your browser.";
        child.kill("SIGTERM");
      });
    }

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = (stdout + chunk.toString()).slice(-16_000);
      openPrintedLoginUrl();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-16_000);
      openPrintedLoginUrl();
    });
    child.on("error", (error) => {
      if (activeLogin === login) activeLogin = null;
      resolve(failure(`Could not start Grok sign-in: ${error.message}`));
    });
    child.on("close", (code) => {
      if (activeLogin === login) activeLogin = null;
      if (login.cancelled) {
        resolve(failure("Sign-in was canceled."));
        return;
      }
      const account = getGrokAccount();
      if (code === 0 && account.loggedIn) {
        resolve({ ok: true, account });
        return;
      }
      const detail = cleanCliMessage(stderr) || cleanCliMessage(stdout);
      resolve(
        failure(
          browserOpenError ||
            detail ||
            (code === 0
              ? "Grok did not save a valid sign-in. Please try again."
              : `Grok sign-in exited with code ${code ?? "unknown"}.`),
        ),
      );
    });
  });
}

export function cancelGrokLogin(): boolean {
  if (!activeLogin) return false;
  activeLogin.cancelled = true;
  activeLogin.child.kill("SIGTERM");
  return true;
}

/** Let the bundled CLI clear every cached credential format it owns. */
export async function logoutFromGrok(): Promise<GrokAuthActionResult> {
  if (activeLogin) {
    return failure("Cancel the current sign-in before signing out.");
  }

  const probe = findGrok();
  if (!probe) {
    return failure("The bundled Grok Build executable is missing or invalid.");
  }

  const env = await authEnvironment();
  return new Promise((resolve) => {
    execFile(
      probe.path,
      ["logout"],
      { env, windowsHide: true },
      (error, stdout, stderr) => {
        const cliAccount = getGrokAccount();
        if (!cliAccount.loggedIn) {
          resolve({ ok: true, account: cliAccount });
          return;
        }
        // A corrupt/stale auth entry can be visible to the GUI while the CLI
        // reports "No cached session". The user explicitly confirmed sign-out,
        // so remove only the credential file; chats/config remain untouched.
        try {
          clearGrokAuthFile();
          const clearedAccount = getGrokAccount();
          if (!clearedAccount.loggedIn) {
            resolve({ ok: true, account: clearedAccount });
            return;
          }
        } catch (clearError) {
          resolve(
            failure(
              clearError instanceof Error
                ? clearError.message
                : String(clearError),
            ),
          );
          return;
        }
        const detail = cleanCliMessage(stderr) || cleanCliMessage(stdout);
        resolve(
          failure(
            detail ||
              error?.message ||
              "Grok did not clear the cached sign-in. Please try again.",
          ),
        );
      },
    );
  });
}
