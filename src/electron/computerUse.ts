import { execFile } from "node:child_process";
import {
  accessSync,
  constants,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { app } from "electron";
import type { ClientMcpStdio } from "./acp/sessionManager.js";
import {
  computerUseMcpEnvironment,
  computerUsePermissionsRequired,
} from "./computerUsePlatform.js";

const execFileAsync = promisify(execFile);

const MIN_VERSION = [0, 2, 1] as const;
const MAX_VERSION_EXCLUSIVE = [0, 3, 0] as const;
export const COMPUTER_USE_SUPPORTED_RANGE = ">=0.2.1 <0.3.0";
export const COMPUTER_USE_ARTIFACT_VERSION = "0.2.1";

type ComputerUseConfig = {
  enabled: boolean;
};

export type ComputerUseStatus = {
  enabled: boolean;
  permissionsRequired: boolean;
  available: boolean;
  compatible: boolean;
  ready: boolean;
  commandPath: string | null;
  source: "bundled" | "project" | null;
  version: string | null;
  supportedRange: string;
  error: string | null;
};

export type ComputerUsePermissionCheckResult = {
  ok: boolean;
  allowed: boolean;
  error?: string;
};

const DEFAULT_CONFIG: ComputerUseConfig = {
  enabled: true,
};

function isExecutable(candidate: string): boolean {
  try {
    accessSync(
      candidate,
      process.platform === "win32" ? undefined : constants.X_OK,
    );
    return true;
  } catch {
    return false;
  }
}

function nativeExecutable(packageRoot: string): string | null {
  const platformKey = `${process.platform}-${process.arch}`;
  const relativeByPlatform: Record<string, string[]> = {
    "darwin-arm64": [
      "dist",
      "Open Computer Use.app",
      "Contents",
      "MacOS",
      "OpenComputerUse",
    ],
    "darwin-x64": [
      "dist",
      "Open Computer Use.app",
      "Contents",
      "MacOS",
      "OpenComputerUse",
    ],
    "linux-arm64": ["dist", "linux", "arm64", "open-computer-use"],
    "linux-x64": ["dist", "linux", "amd64", "open-computer-use"],
    "win32-arm64": [
      "dist",
      "windows",
      "arm64",
      "open-computer-use.exe",
    ],
    "win32-x64": [
      "dist",
      "windows",
      "amd64",
      "open-computer-use.exe",
    ],
  };
  const relative = relativeByPlatform[platformKey];
  return relative ? path.join(packageRoot, ...relative) : null;
}

function resolveExecutable(): {
  commandPath: string | null;
  source: ComputerUseStatus["source"];
} {
  const artifactRoots: Array<{
    root: string;
    source: Exclude<ComputerUseStatus["source"], null>;
  }> = [];
  if (app.isPackaged) {
    artifactRoots.push({
      root: path.join(process.resourcesPath, "open-computer-use"),
      source: "bundled",
    });
  }
  artifactRoots.push({
    root: path.join(
      app.getAppPath(),
      "thirdparty",
      "open-computer-use",
      COMPUTER_USE_ARTIFACT_VERSION,
      "package",
    ),
    source: "project",
  });

  for (const artifact of artifactRoots) {
    const candidate = nativeExecutable(artifact.root);
    if (candidate && isExecutable(candidate)) {
      return { commandPath: candidate, source: artifact.source };
    }
  }

  return { commandPath: null, source: null };
}

function parseVersion(raw: string): string | null {
  return raw.match(/\bv?(\d+\.\d+\.\d+)\b/i)?.[1] ?? null;
}

function versionTuple(version: string): [number, number, number] {
  const [major = 0, minor = 0, patch = 0] = version
    .split(".")
    .map((part) => Number(part));
  return [major, minor, patch];
}

function compareVersion(
  left: readonly number[],
  right: readonly number[],
): number {
  for (let i = 0; i < 3; i += 1) {
    const delta = (left[i] ?? 0) - (right[i] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function isSupportedVersion(version: string): boolean {
  const tuple = versionTuple(version);
  return (
    compareVersion(tuple, MIN_VERSION) >= 0 &&
    compareVersion(tuple, MAX_VERSION_EXCLUSIVE) < 0
  );
}

export class ComputerUseManager {
  private config: ComputerUseConfig = { ...DEFAULT_CONFIG };
  private loaded = false;
  private status: ComputerUseStatus = {
    enabled: DEFAULT_CONFIG.enabled,
    permissionsRequired: computerUsePermissionsRequired(),
    available: false,
    compatible: false,
    ready: false,
    commandPath: null,
    source: null,
    version: null,
    supportedRange: COMPUTER_USE_SUPPORTED_RANGE,
    error: null,
  };

  private configPath(): string {
    return path.join(app.getPath("userData"), "computer-use.json");
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const parsed = JSON.parse(readFileSync(this.configPath(), "utf8")) as
        Partial<ComputerUseConfig> & { commandPath?: unknown };
      this.config = {
        enabled:
          typeof parsed.enabled === "boolean"
            ? parsed.enabled
            : DEFAULT_CONFIG.enabled,
      };
      if ("commandPath" in parsed) this.persist();
    } catch {
      this.config = { ...DEFAULT_CONFIG };
    }
  }

  private persist(): void {
    const target = this.configPath();
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(this.config, null, 2), "utf8");
  }

  async probe(): Promise<ComputerUseStatus> {
    this.ensureLoaded();
    const resolved = resolveExecutable();
    const commandPath = resolved.commandPath;
    if (!commandPath) {
      this.status = {
        enabled: this.config.enabled,
        permissionsRequired: computerUsePermissionsRequired(),
        available: false,
        compatible: false,
        ready: false,
        commandPath: null,
        source: null,
        version: null,
        supportedRange: COMPUTER_USE_SUPPORTED_RANGE,
        error: "The built-in Open Computer Use artifact is not prepared.",
      };
      return this.getStatus();
    }

    try {
      const result = await execFileAsync(commandPath, ["--version"], {
        encoding: "utf8",
        timeout: 5_000,
        maxBuffer: 256 * 1024,
        env: process.env,
      });
      const version = parseVersion(`${result.stdout}\n${result.stderr}`);
      const compatible = Boolean(version && isSupportedVersion(version));
      this.status = {
        enabled: this.config.enabled,
        permissionsRequired: computerUsePermissionsRequired(),
        available: true,
        compatible,
        ready: this.config.enabled && compatible,
        commandPath,
        source: resolved.source,
        version,
        supportedRange: COMPUTER_USE_SUPPORTED_RANGE,
        error: !version
          ? "Could not read the Open Computer Use version."
          : compatible
            ? null
            : `Open Computer Use ${version} is outside the supported range ${COMPUTER_USE_SUPPORTED_RANGE}.`,
      };
    } catch (error) {
      this.status = {
        enabled: this.config.enabled,
        permissionsRequired: computerUsePermissionsRequired(),
        available: true,
        compatible: false,
        ready: false,
        commandPath,
        source: resolved.source,
        version: null,
        supportedRange: COMPUTER_USE_SUPPORTED_RANGE,
        error:
          error instanceof Error
            ? `Failed to probe Open Computer Use: ${error.message}`
            : `Failed to probe Open Computer Use: ${String(error)}`,
      };
    }
    return this.getStatus();
  }

  async setEnabled(enabled: boolean): Promise<ComputerUseStatus> {
    this.ensureLoaded();
    this.config.enabled = enabled;
    this.persist();
    return this.probe();
  }

  async checkPermissions(): Promise<ComputerUsePermissionCheckResult> {
    if (!this.status.commandPath) {
      await this.probe();
    }
    const commandPath = this.status.commandPath;
    if (!commandPath) {
      return {
        ok: false,
        allowed: false,
        error: "Open Computer Use is not available.",
      };
    }

    if (!computerUsePermissionsRequired()) {
      return { ok: true, allowed: true };
    }

    try {
      const result = await execFileAsync(commandPath, ["doctor"], {
        encoding: "utf8",
        maxBuffer: 256 * 1024,
        env: process.env,
      });
      const output = `${result.stdout}\n${result.stderr}`;
      const permissions = output.match(
        /accessibility=(granted|missing),\s*screenRecording=(granted|missing)/i,
      );
      if (!permissions) {
        return {
          ok: false,
          allowed: false,
          error: "Could not read the Open Computer Use permission status.",
        };
      }
      return {
        ok: true,
        allowed:
          permissions[1]?.toLowerCase() === "granted" &&
          permissions[2]?.toLowerCase() === "granted",
      };
    } catch (error) {
      return {
        ok: false,
        allowed: false,
        error:
          error instanceof Error
            ? `Failed to check Open Computer Use permissions: ${error.message}`
            : `Failed to check Open Computer Use permissions: ${String(error)}`,
      };
    }
  }

  getStatus(): ComputerUseStatus {
    return { ...this.status };
  }

  getMcpServer(): ClientMcpStdio | null {
    if (!this.status.ready || !this.status.commandPath) return null;
    return {
      name: "computer-use",
      command: this.status.commandPath,
      args: ["mcp"],
      env: computerUseMcpEnvironment(),
    };
  }

  /**
   * Release Open Computer Use's per-turn UI state/overlay. The native runtime
   * exposes this out-of-band command because closing the MCP stdio stream is
   * not sufficient to end its host turn cleanly.
   */
  async endTurn(payload?: Record<string, unknown>): Promise<boolean> {
    const commandPath = this.status.commandPath;
    // An already-loaded agent session can still own a running MCP process
    // after the user disables injection for future sessions.
    if (!this.status.compatible || !commandPath) return false;
    try {
      await execFileAsync(
        commandPath,
        ["turn-ended", JSON.stringify(payload ?? {})],
        {
          encoding: "utf8",
          timeout: 5_000,
          maxBuffer: 256 * 1024,
          env: process.env,
        },
      );
      return true;
    } catch (error) {
      // Cleanup is best-effort: the MCP process may already have exited when
      // the agent closed or deleted its session.
      console.warn(
        "[grok-gui] Open Computer Use turn cleanup failed:",
        error instanceof Error ? error.message : error,
      );
      return false;
    }
  }
}

export const computerUseManager = new ComputerUseManager();
