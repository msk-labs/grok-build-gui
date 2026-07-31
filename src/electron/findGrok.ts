import { accessSync, constants } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { app } from "electron";
import grokManifest from "../../config/runtime/grok-build.json";

export const GROK_BUILD_ARTIFACT_VERSION = grokManifest.version;

function isExecutable(path: string): boolean {
  try {
    accessSync(path, process.platform === "win32" ? undefined : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function platformArtifact(): {
  artifactPlatform: string;
  executable: string;
} | null {
  const platforms = grokManifest.platforms as Record<
    string,
    { artifactPlatform: string; executable: string }
  >;
  return platforms[`${process.platform}-${process.arch}`] ?? null;
}

function bundledCandidate(): string | null {
  const platform = platformArtifact();
  if (!platform) return null;
  if (app.isPackaged) {
    return path.join(
      process.resourcesPath,
      "grok-build",
      platform.executable,
    );
  }
  return path.join(
    app.getAppPath(),
    "thirdparty",
    "grok-build",
    GROK_BUILD_ARTIFACT_VERSION,
    platform.artifactPlatform,
    platform.executable,
  );
}

export type GrokProbe = {
  path: string;
  version: string | null;
};

/** Locate the pinned Grok Build artifact shipped with this GUI release. */
export function findGrok(): GrokProbe | null {
  const candidate = bundledCandidate();
  if (!candidate || !isExecutable(candidate)) return null;
  let version: string | null = null;
  try {
    version = execFileSync(candidate, ["--version"], {
      encoding: "utf8",
      timeout: 5000,
    }).trim();
  } catch {
    return null;
  }
  if (!new RegExp(`\\bgrok\\s+${GROK_BUILD_ARTIFACT_VERSION}\\b`).test(version)) {
    return null;
  }
  return { path: candidate, version };
}
