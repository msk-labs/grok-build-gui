/**
 * Launch the bundled Grok Build interactive TUI in the system terminal.
 * Uses the same pinned artifact as ACP (`findGrok`), not PATH `grok`.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { findGrok } from "./findGrok.js";
import {
  buildSystemProxyEnvironment,
  PROXY_ENV_KEYS,
} from "./systemProxy.js";

const execFileAsync = promisify(execFile);

export type OpenGrokTuiResult =
  | { ok: true }
  | { ok: false; error: string };

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildLaunchCommand(
  grokPath: string,
  env: NodeJS.ProcessEnv,
  cwd?: string | null,
): string {
  const bin = shellSingleQuote(grokPath);
  const unsetArgs = PROXY_ENV_KEYS.map(
    (key) => `-u ${shellSingleQuote(key)}`,
  );
  const assignments = PROXY_ENV_KEYS.flatMap((key) => {
    const value = env[key];
    return typeof value === "string"
      ? [shellSingleQuote(`${key}=${value}`)]
      : [];
  });
  const launch = `exec env ${[...unsetArgs, ...assignments, bin].join(" ")}`;
  if (cwd && cwd.length > 0) {
    return `cd ${shellSingleQuote(cwd)} && ${launch}`;
  }
  return launch;
}

async function openDarwin(cmd: string): Promise<void> {
  // AppleScript: open a new Terminal window running the interactive TUI.
  const script = [
    'tell application "Terminal"',
    `  do script ${JSON.stringify(cmd)}`,
    "  activate",
    "end tell",
  ].join("\n");
  await execFileAsync("osascript", ["-e", script], { timeout: 10_000 });
}

async function openLinux(cmd: string): Promise<void> {
  const candidates: Array<{ bin: string; args: string[] }> = [
    { bin: "x-terminal-emulator", args: ["-e", "bash", "-lc", cmd] },
    { bin: "gnome-terminal", args: ["--", "bash", "-lc", cmd] },
    { bin: "konsole", args: ["-e", "bash", "-lc", cmd] },
    { bin: "xterm", args: ["-e", "bash", "-lc", cmd] },
  ];
  let lastError: unknown = null;
  for (const c of candidates) {
    try {
      await execFileAsync(c.bin, c.args, { timeout: 10_000 });
      return;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("No supported terminal emulator found");
}

async function openWindows(
  grokPath: string,
  env: NodeJS.ProcessEnv,
  cwd?: string | null,
): Promise<void> {
  // Start a new console window; keep it open only while grok runs.
  const args = ["/c", "start", "Grok Build", "cmd", "/k", grokPath];
  await execFileAsync("cmd.exe", args, {
    timeout: 10_000,
    cwd: cwd && cwd.length > 0 ? cwd : undefined,
    env,
  });
}

/**
 * Open the system console and run the bundled Grok Build TUI.
 * @param cwd Optional working directory (typically the active workspace).
 */
export async function openGrokTui(
  cwd?: string | null,
): Promise<OpenGrokTuiResult> {
  const probe = findGrok();
  if (!probe) {
    return {
      ok: false,
      error:
        "The bundled Grok Build executable is missing or invalid. Run `npm run artifact:grok-build`, then try again.",
    };
  }

  try {
    const env = await buildSystemProxyEnvironment();
    if (process.platform === "darwin") {
      await openDarwin(buildLaunchCommand(probe.path, env, cwd));
      return { ok: true };
    }
    if (process.platform === "win32") {
      await openWindows(probe.path, env, cwd);
      return { ok: true };
    }
    await openLinux(buildLaunchCommand(probe.path, env, cwd));
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
