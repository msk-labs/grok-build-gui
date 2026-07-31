import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { downloadArtifact } = require("@electron/get");
const electronPackage = require("electron/package.json");
const electronChecksums = require("electron/checksums.json");

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const electronRoot = path.join(projectRoot, "node_modules", "electron");
const distRoot = path.join(electronRoot, "dist");
const platformExecutable = {
  darwin: path.join("Electron.app", "Contents", "MacOS", "Electron"),
  linux: "electron",
  win32: "electron.exe",
}[process.platform];

if (!platformExecutable) {
  throw new Error(`Electron does not support ${process.platform}.`);
}

const versionPath = path.join(distRoot, "version");
const markerPath = path.join(electronRoot, "path.txt");
const executablePath = path.join(distRoot, platformExecutable);
const installed =
  existsSync(executablePath) &&
  existsSync(versionPath) &&
  existsSync(markerPath) &&
  readFileSync(versionPath, "utf8").trim().replace(/^v/, "") ===
    electronPackage.version &&
  readFileSync(markerPath, "utf8").trim() === platformExecutable;

if (installed) {
  console.log(`Electron ${electronPackage.version} runtime is ready.`);
  process.exit(0);
}

const archive = await downloadArtifact({
  version: electronPackage.version,
  artifactName: "electron",
  platform: process.platform,
  arch: process.arch,
  checksums: electronChecksums,
});

rmSync(distRoot, { recursive: true, force: true });
mkdirSync(distRoot, { recursive: true });
const extractCommand = {
  darwin: {
    command: "ditto",
    args: ["-x", "-k", archive, distRoot],
  },
  linux: {
    command: "unzip",
    args: ["-q", archive, "-d", distRoot],
  },
  win32: {
    command: path.join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "tar.exe",
    ),
    args: ["-xf", archive, "-C", distRoot],
  },
}[process.platform];
const extraction = spawnSync(extractCommand.command, extractCommand.args, {
  encoding: "utf8",
  timeout: 300_000,
});
if (extraction.error || extraction.status !== 0) {
  const detail = `${extraction.stdout ?? ""}\n${extraction.stderr ?? ""}`.trim();
  throw new Error(
    `Could not extract Electron ${electronPackage.version}` +
      `${detail ? `:\n${detail}` : "."}`,
  );
}

const bundledTypes = path.join(distRoot, "electron.d.ts");
if (existsSync(bundledTypes)) {
  renameSync(bundledTypes, path.join(electronRoot, "electron.d.ts"));
}
writeFileSync(markerPath, platformExecutable, "utf8");

if (!existsSync(executablePath) || !existsSync(versionPath)) {
  throw new Error(
    `Electron ${electronPackage.version} runtime extraction was incomplete.`,
  );
}
console.log(`Prepared Electron ${electronPackage.version} runtime.`);
