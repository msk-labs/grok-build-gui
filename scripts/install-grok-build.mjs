import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const manifest = JSON.parse(
  readFileSync(
    path.join(projectRoot, "config", "runtime", "grok-build.json"),
    "utf8",
  ),
);
const platformKey = `${process.platform}-${process.arch}`;
const platform = manifest.platforms[platformKey];
const verifyOnly = process.argv.includes("--verify");

if (!platform) {
  throw new Error(
    `Grok Build ${manifest.version} is not configured for ${platformKey}.`,
  );
}

const versionRoot = path.join(
  projectRoot,
  manifest.artifactRelativeRoot,
  platform.artifactPlatform,
);
const executablePath = path.join(versionRoot, platform.executable);
const markerPath = path.join(versionRoot, "artifact.json");

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function detectedVersion(filePath) {
  const result = spawnSync(filePath, ["--version"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  if (result.status !== 0) return null;
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`.match(
    /\bgrok\s+(\d+\.\d+\.\d+)\b/i,
  )?.[1] ?? null;
}

function validateArtifact() {
  try {
    const marker = JSON.parse(readFileSync(markerPath, "utf8"));
    if (
      marker.version !== manifest.version ||
      marker.platform !== platformKey ||
      marker.sha256 !== platform.sha256 ||
      statSync(executablePath).size !== platform.size ||
      sha256(executablePath) !== platform.sha256 ||
      detectedVersion(executablePath) !== manifest.version
    ) {
      return false;
    }
    return manifest.notices.every((notice) => {
      const noticePath = path.join(versionRoot, notice.path);
      return existsSync(noticePath) && sha256(noticePath) === notice.sha256;
    });
  } catch {
    return false;
  }
}

async function download(url, output) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    rmSync(output, { force: true });
    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(300_000),
      });
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      await pipeline(response.body, createWriteStream(output));
      return;
    } catch (error) {
      lastError = error;
    }
  }
  rmSync(output, { force: true });
  const detail =
    lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Download failed for ${url}: ${detail}`);
}

if (validateArtifact()) {
  console.log(`Grok Build ${manifest.version} artifact is ready at ${versionRoot}`);
  process.exit(0);
}

if (verifyOnly) {
  console.error(
    `Grok Build ${manifest.version} artifact is missing or invalid. Run npm run artifact:grok-build.`,
  );
  process.exit(1);
}

const tempRoot = mkdtempSync(path.join(tmpdir(), "grok-build-gui-runtime-"));
const partialRoot = `${versionRoot}.partial-${process.pid}-${Date.now()}`;

try {
  const downloadedBinary = path.join(tempRoot, platform.executable);
  await download(platform.url, downloadedBinary);
  if (
    statSync(downloadedBinary).size !== platform.size ||
    sha256(downloadedBinary) !== platform.sha256
  ) {
    throw new Error("Downloaded Grok Build artifact failed integrity validation.");
  }
  chmodSync(downloadedBinary, 0o755);
  if (detectedVersion(downloadedBinary) !== manifest.version) {
    throw new Error("Downloaded Grok Build artifact reported an unexpected version.");
  }

  mkdirSync(partialRoot, { recursive: true });
  const partialExecutable = path.join(partialRoot, platform.executable);
  copyFileSync(downloadedBinary, partialExecutable);
  chmodSync(partialExecutable, 0o755);
  for (const notice of manifest.notices) {
    const noticePath = path.join(partialRoot, notice.path);
    mkdirSync(path.dirname(noticePath), { recursive: true });
    await download(notice.url, noticePath);
    if (sha256(noticePath) !== notice.sha256) {
      throw new Error(`License notice failed validation: ${notice.path}`);
    }
  }
  writeFileSync(
    path.join(partialRoot, "artifact.json"),
    JSON.stringify(
      {
        version: manifest.version,
        platform: platformKey,
        artifactPlatform: platform.artifactPlatform,
        sha256: platform.sha256,
        source: platform.url,
      },
      null,
      2,
    ),
    "utf8",
  );

  rmSync(versionRoot, { recursive: true, force: true });
  mkdirSync(path.dirname(versionRoot), { recursive: true });
  renameSync(partialRoot, versionRoot);
  if (!validateArtifact()) {
    throw new Error("Installed Grok Build artifact failed final validation.");
  }
  console.log(`Installed Grok Build ${manifest.version} at ${versionRoot}`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
  rmSync(partialRoot, { recursive: true, force: true });
}
