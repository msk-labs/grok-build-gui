import { existsSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

export type TerminalShellPreference =
  | "system"
  | "powershell"
  | "cmd"
  | "git-bash"
  | "wsl"
  | "zsh"
  | "bash"
  | "sh";

export type TerminalShellOption = {
  value: TerminalShellPreference;
  label: string;
};

export type TerminalShellLaunch = {
  executable: string;
  args: string[];
};

const WINDOWS_PREFERENCES = new Set<TerminalShellPreference>([
  "system",
  "powershell",
  "cmd",
  "git-bash",
  "wsl",
]);
const UNIX_PREFERENCES = new Set<TerminalShellPreference>([
  "system",
  "zsh",
  "bash",
  "sh",
]);

function findOnPath(
  command: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  pathExists: (path: string) => boolean,
): string | null {
  if (isAbsolute(command)) return pathExists(command) ? command : null;
  const extensions =
    platform === "win32"
      ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";")
      : [""];
  for (const directory of (env.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = join(
        directory,
        command.toLowerCase().endsWith(extension.toLowerCase())
          ? command
          : `${command}${extension}`,
      );
      if (pathExists(candidate)) return candidate;
    }
  }
  return null;
}

function findGitBash(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  pathExists: (path: string) => boolean,
): string | null {
  const fromPath = findOnPath("bash.exe", platform, env, pathExists);
  if (fromPath && /[/\\]Git[/\\]/i.test(fromPath)) return fromPath;
  for (const root of [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA]) {
    if (!root) continue;
    const candidate =
      root === env.LOCALAPPDATA
        ? join(root, "Programs", "Git", "bin", "bash.exe")
        : join(root, "Git", "bin", "bash.exe");
    if (pathExists(candidate)) return candidate;
  }
  return null;
}

export function normalizeTerminalShellPreference(
  value: unknown,
  platform: NodeJS.Platform = process.platform,
): TerminalShellPreference {
  const allowed = platform === "win32" ? WINDOWS_PREFERENCES : UNIX_PREFERENCES;
  return typeof value === "string" && allowed.has(value as TerminalShellPreference)
    ? (value as TerminalShellPreference)
    : "system";
}

export function listTerminalShellOptions(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  pathExists: (path: string) => boolean = existsSync,
): TerminalShellOption[] {
  if (platform === "win32") {
    const options: TerminalShellOption[] = [{ value: "system", label: "System default" }];
    if (findOnPath("pwsh.exe", platform, env, pathExists) || findOnPath("powershell.exe", platform, env, pathExists)) {
      options.push({ value: "powershell", label: "PowerShell" });
    }
    if (findOnPath("cmd.exe", platform, env, pathExists) || env.COMSPEC) {
      options.push({ value: "cmd", label: "CMD" });
    }
    if (findGitBash(platform, env, pathExists)) options.push({ value: "git-bash", label: "Git Bash" });
    if (findOnPath("wsl.exe", platform, env, pathExists)) options.push({ value: "wsl", label: "WSL" });
    return options;
  }

  const options: TerminalShellOption[] = [{ value: "system", label: "Login shell" }];
  for (const [value, label, executable] of [
    ["zsh", "Zsh", "/bin/zsh"],
    ["bash", "Bash", "/bin/bash"],
    ["sh", "Sh", "/bin/sh"],
  ] as const) {
    if (pathExists(executable)) options.push({ value, label });
  }
  return options;
}

export function resolveTerminalShell(
  preference: unknown,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  pathExists: (path: string) => boolean = existsSync,
): TerminalShellLaunch {
  const selected = normalizeTerminalShellPreference(preference, platform);
  if (platform === "win32") {
    if (selected === "powershell") {
      return {
        executable:
          findOnPath("pwsh.exe", platform, env, pathExists) ??
          findOnPath("powershell.exe", platform, env, pathExists) ??
          "powershell.exe",
        args: [],
      };
    }
    if (selected === "cmd") {
      return { executable: env.COMSPEC || "cmd.exe", args: [] };
    }
    if (selected === "git-bash") {
      const executable = findGitBash(platform, env, pathExists);
      if (executable) return { executable, args: ["--login"] };
    }
    if (selected === "wsl") {
      const executable = findOnPath("wsl.exe", platform, env, pathExists);
      if (executable) return { executable, args: [] };
    }
    return {
      executable:
        findOnPath("pwsh.exe", platform, env, pathExists) ??
        findOnPath("powershell.exe", platform, env, pathExists) ??
        "powershell.exe",
      args: [],
    };
  }

  const executable =
    selected === "system"
      ? env.SHELL && pathExists(env.SHELL)
        ? env.SHELL
        : ["/bin/zsh", "/bin/bash", "/bin/sh"].find(pathExists) ?? "/bin/sh"
      : `/${selected === "zsh" || selected === "bash" || selected === "sh" ? `bin/${selected}` : "bin/sh"}`;
  const base = executable.split("/").pop();
  return {
    executable,
    args: base === "zsh" || base === "bash" ? ["-l"] : [],
  };
}
