import { spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const manifestPath = path.join(
  projectRoot,
  "config",
  "runtime",
  "open-computer-use.json",
);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const packageRoot = path.join(projectRoot, manifest.artifactRelativePath);
const versionRoot = path.dirname(packageRoot);
const markerPath = path.join(versionRoot, "artifact.json");
const trackedLicensePath = path.join(projectRoot, manifest.licenseFile);
const verifyOnly = process.argv.includes("--verify");

function normalizedText(filePath) {
  return readFileSync(filePath, "utf8").replace(/\r\n/g, "\n").trim();
}

function nativeExecutable(root) {
  const platformKey = `${process.platform}-${process.arch}`;
  const relativeByPlatform = {
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
  if (!relative) {
    throw new Error(`Open Computer Use does not support ${platformKey}.`);
  }
  return path.join(root, ...relative);
}

function validateArtifact() {
  if (
    !existsSync(packageRoot) ||
    !existsSync(markerPath) ||
    !existsSync(trackedLicensePath)
  ) {
    return false;
  }
  try {
    const packageJson = JSON.parse(
      readFileSync(path.join(packageRoot, "package.json"), "utf8"),
    );
    const marker = JSON.parse(readFileSync(markerPath, "utf8"));
    if (
      packageJson.name !== manifest.packageName ||
      packageJson.version !== manifest.version ||
      packageJson.license !== manifest.license ||
      marker.integrity !== manifest.integrity ||
      !existsSync(path.join(packageRoot, "LICENSE")) ||
      normalizedText(path.join(packageRoot, "LICENSE")) !==
        normalizedText(trackedLicensePath)
    ) {
      return false;
    }
    const executable = nativeExecutable(packageRoot);
    accessSync(
      executable,
      process.platform === "win32" ? undefined : constants.X_OK,
    );
    return true;
  } catch {
    return false;
  }
}

function run(command, args, options = {}) {
  const spawnCommand =
    process.platform === "win32"
      ? (process.env.ComSpec ?? "cmd.exe")
      : command;
  const spawnArgs =
    process.platform === "win32"
      ? ["/d", "/c", command, ...args]
      : args;
  const result = spawnSync(spawnCommand, spawnArgs, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  if (result.status !== 0) {
    const detail = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
    throw new Error(
      `${command} ${args.join(" ")} failed${detail ? `:\n${detail}` : "."}`,
    );
  }
  return result.stdout ?? "";
}

if (validateArtifact()) {
  console.log(
    `Open Computer Use ${manifest.version} artifact is ready at ${packageRoot}`,
  );
  process.exit(0);
}

if (verifyOnly) {
  console.error(
    `Open Computer Use ${manifest.version} artifact is missing or invalid. Run npm run artifact:computer-use.`,
  );
  process.exit(1);
}

if (existsSync(packageRoot) || existsSync(markerPath)) {
  throw new Error(
    `Refusing to overwrite the invalid artifact at ${versionRoot}. Remove that version directory, then retry.`,
  );
}

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const tempRoot = mkdtempSync(path.join(tmpdir(), "grok-build-gui-ocu-"));
const installRoot = path.join(tempRoot, "install");
const partialRoot = path.join(
  versionRoot,
  `.package-${process.pid}-${Date.now()}`,
);

try {
  const packedRaw = run(npmCommand, [
    "pack",
    `${manifest.packageName}@${manifest.version}`,
    "--json",
    "--pack-destination",
    tempRoot,
  ]);
  const packed = JSON.parse(packedRaw)?.[0];
  if (!packed?.filename || packed.integrity !== manifest.integrity) {
    throw new Error(
      `Artifact integrity mismatch: expected ${manifest.integrity}, received ${packed?.integrity ?? "unknown"}.`,
    );
  }

  run(npmCommand, [
    "install",
    "--prefix",
    installRoot,
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--omit=dev",
    "--package-lock=false",
    path.join(tempRoot, packed.filename),
  ]);

  const installedPackage = path.join(
    installRoot,
    "node_modules",
    manifest.packageName,
  );
  mkdirSync(versionRoot, { recursive: true });
  cpSync(installedPackage, partialRoot, { recursive: true });
  renameSync(partialRoot, packageRoot);
  writeFileSync(
    markerPath,
    JSON.stringify(
      {
        packageName: manifest.packageName,
        version: manifest.version,
        integrity: manifest.integrity,
      },
      null,
      2,
    ),
    "utf8",
  );

  if (!validateArtifact()) {
    throw new Error("Installed Open Computer Use artifact failed validation.");
  }
  console.log(
    `Installed Open Computer Use ${manifest.version} artifact at ${packageRoot}`,
  );
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
  if (existsSync(partialRoot)) {
    rmSync(partialRoot, { recursive: true, force: true });
  }
}
