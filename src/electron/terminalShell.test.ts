// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({ existsSync: () => false }));
vi.mock("node:path", () => ({
  delimiter: ";",
  isAbsolute: (path: string) => /^(?:[a-z]:[\\/]|\/)/i.test(path),
  join: (...parts: string[]) => {
    const separator = /^[a-z]:/i.test(parts[0] ?? "") ? "\\" : "/";
    return parts
      .map((part, index) =>
        index === 0
          ? part.replace(/[\\/]+$/g, "")
          : part.replace(/^[\\/]+|[\\/]+$/g, ""),
      )
      .join(separator);
  },
}));
import {
  listTerminalShellOptions,
  normalizeTerminalShellPreference,
  resolveTerminalShell,
} from "./terminalShell";

function windowsFiles(...paths: string[]) {
  const normalized = new Set(paths.map((path) => path.toLowerCase()));
  return (path: string) => normalized.has(path.toLowerCase());
}

describe("terminal shell selection", () => {
  it("detects installed Windows shells", () => {
    const env = {
      PATH: "C:\\Tools;C:\\Windows\\System32",
      PATHEXT: ".EXE",
      ProgramFiles: "C:\\Program Files",
      COMSPEC: "C:\\Windows\\System32\\cmd.exe",
    };
    const exists = windowsFiles(
      "C:\\Tools\\pwsh.exe",
      "C:\\Windows\\System32\\cmd.exe",
      "C:\\Windows\\System32\\wsl.exe",
      "C:\\Program Files\\Git\\bin\\bash.exe",
    );

    const options = listTerminalShellOptions("win32", env, exists);
    expect(options.map((option) => option.value)).toEqual([
      "system",
      "powershell",
      "cmd",
      "git-bash",
      "wsl",
    ]);
    expect(options.find((option) => option.value === "cmd")?.label).toBe("CMD");
  });

  it("prefers PowerShell 7 for the Windows system default", () => {
    const env = { PATH: "C:\\Tools", PATHEXT: ".EXE" };
    const launch = resolveTerminalShell(
      "system",
      "win32",
      env,
      windowsFiles("C:\\Tools\\pwsh.exe"),
    );

    expect(launch).toEqual({ executable: "C:\\Tools\\pwsh.exe", args: [] });
  });

  it("falls back to the Windows system shell when a saved option disappeared", () => {
    const launch = resolveTerminalShell(
      "git-bash",
      "win32",
      { PATH: "", COMSPEC: "C:\\Windows\\System32\\cmd.exe" },
      () => false,
    );

    expect(launch).toEqual({ executable: "powershell.exe", args: [] });
  });

  it("uses the macOS login shell and login arguments", () => {
    const launch = resolveTerminalShell(
      "system",
      "darwin",
      { SHELL: "/opt/homebrew/bin/bash" },
      (path) => path === "/opt/homebrew/bin/bash",
    );

    expect(launch).toEqual({
      executable: "/opt/homebrew/bin/bash",
      args: ["-l"],
    });
  });

  it("rejects preferences from the other platform", () => {
    expect(normalizeTerminalShellPreference("wsl", "darwin")).toBe("system");
    expect(normalizeTerminalShellPreference("zsh", "win32")).toBe("system");
  });
});
