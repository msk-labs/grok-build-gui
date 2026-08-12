import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const packageJson = JSON.parse(
  readFileSync(path.join(projectRoot, "package.json"), "utf8"),
);
// Releases deliberately use the project's stable self-signed identity. Keeping
// this fixed preserves the designated requirement used by Squirrel.Mac and
// prevents a local Developer ID certificate from being selected accidentally.
const identity = process.env.MAC_SIGNING_IDENTITY ?? "Grok Desktop";
const releaseDir = path.join(projectRoot, "out", "release");
const appDir = path.join(releaseDir, "mac-arm64");
const appPath = path.join(appDir, "Grok GUI.app");
const dmgPath = path.join(
  releaseDir,
  `Grok-GUI-${packageJson.version}-mac-arm64.dmg`,
);
const electronBuilder = path.join(
  projectRoot,
  "node_modules",
  ".bin",
  "electron-builder",
);

if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("The macOS release must run on an Apple Silicon Mac.");
}

if (identity !== "Grok Desktop") {
  throw new Error(
    'macOS releases must use the self-signed "Grok Desktop" identity. ' +
      "Refusing to sign with a different certificate.",
  );
}

process.env.MAC_SIGNING_IDENTITY = identity;

function run(command, args, options = {}) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture
      ? `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim()
      : "";
    throw new Error(
      `${path.basename(command)} failed with exit code ${result.status}${
        detail ? `:\n${detail}` : "."
      }`,
    );
  }
  return result.stdout ?? "";
}

run("npm", ["run", "build"]);

rmSync(dmgPath, { force: true });
run(electronBuilder, [
  "--config",
  "config/electron-builder.cjs",
  "--mac",
  "dmg",
  "zip",
  "--arm64",
  "--publish",
  "never",
]);

if (!existsSync(appPath)) {
  throw new Error(`Expected signed app was not created at ${appPath}.`);
}

run("codesign", ["--verify", "--deep", "--strict", "--verbose=4", appPath]);

if (!existsSync(dmgPath)) {
  throw new Error(`Expected DMG was not created at ${dmgPath}.`);
}

run("codesign", [
  "--force",
  "--sign",
  identity,
  dmgPath,
]);
run("codesign", ["--verify", "--strict", "--verbose=4", dmgPath]);
run("hdiutil", ["verify", dmgPath]);

console.log(
  `\nSelf-signed release ready: ${dmgPath}\n` +
    "Gatekeeper cannot validate self-signed downloads; users must right-click " +
    "the app and choose Open the first time.",
);

if (process.env.UPDATE_GITHUB_OWNER && process.env.UPDATE_GITHUB_REPO) {
  const feed = path.join(releaseDir, "latest-mac.yml");
  const updateZip = path.join(
    releaseDir,
    `Grok-GUI-${packageJson.version}-arm64-mac.zip`,
  );
  for (const required of [feed, updateZip]) {
    if (!existsSync(required)) {
      throw new Error(
        `Auto-update artifact missing: ${required}. The app cannot update itself without it.`,
      );
    }
  }
  console.log(
    [
      "\nUpload all three to the GitHub release tagged " +
        `v${packageJson.version}:`,
      `  ${dmgPath}`,
      `  ${updateZip}`,
      `  ${feed}`,
    ].join("\n"),
  );
} else {
  console.warn(
    "\nUPDATE_GITHUB_OWNER / UPDATE_GITHUB_REPO were unset — this build has no " +
      "update feed and installed copies will not auto-update.",
  );
}
