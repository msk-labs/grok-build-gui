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
// Both come from the environment only — never a committed default. This repo
// is public: a hardcoded identity would publish the signer's name and Team ID,
// and would sign and notarize under that account for anyone who cloned it.
const identity = process.env.MAC_SIGNING_IDENTITY;
const keychainProfile = process.env.APPLE_KEYCHAIN_PROFILE;
const keychainPath = process.env.APPLE_KEYCHAIN;
const releaseDir = path.join(projectRoot, "out", "release");
const appDir = path.join(releaseDir, "mac-arm64");
const appPath = path.join(appDir, "Grok Build GUI.app");
const uploadZip = path.join(
  releaseDir,
  `Grok-Build-GUI-${packageJson.version}-mac-arm64-notary-upload.zip`,
);
const dmgPath = path.join(
  releaseDir,
  `Grok-Build-GUI-${packageJson.version}-mac-arm64.dmg`,
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

if (!identity) {
  throw new Error(
    'MAC_SIGNING_IDENTITY is required, e.g. "Developer ID Application: ' +
      'Example Ltd (ABCDE12345)". Run `security find-identity -v -p ' +
      "codesigning` to list the certificates on this machine.",
  );
}

if (!keychainProfile) {
  throw new Error(
    "APPLE_KEYCHAIN_PROFILE is required — the notarytool profile name created " +
      "by `xcrun notarytool store-credentials`. See docs/process/MAC_RELEASE.md.",
  );
}

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

function notarize(target) {
  const args = [
    "notarytool",
    "submit",
    target,
    "--keychain-profile",
    keychainProfile,
    "--wait",
    "--output-format",
    "json",
  ];
  if (keychainPath) args.push("--keychain", keychainPath);

  const output = run("xcrun", args, { capture: true });
  const result = JSON.parse(output);
  console.log(`Apple notarization status: ${result.status}`);
  if (result.status !== "Accepted") {
    throw new Error(
      `Apple rejected notarization request ${result.id ?? "(unknown id)"}.`,
    );
  }
}

run("npm", ["run", "build"]);

run(electronBuilder, [
  "--config",
  "config/electron-builder.cjs",
  "--mac",
  "dir",
  "--arm64",
]);

if (!existsSync(appPath)) {
  throw new Error(`Expected signed app was not created at ${appPath}.`);
}

run("codesign", ["--verify", "--deep", "--strict", "--verbose=4", appPath]);

rmSync(uploadZip, { force: true });
run("ditto", [
  "-c",
  "-k",
  "--sequesterRsrc",
  "--keepParent",
  appPath,
  uploadZip,
]);
notarize(uploadZip);

run("xcrun", ["stapler", "staple", appPath]);
run("xcrun", ["stapler", "validate", appPath]);
run("spctl", ["--assess", "--type", "execute", "--verbose=4", appPath]);

rmSync(dmgPath, { force: true });
// The zip is built from the same stapled .app and is what electron-updater
// downloads; building it here also emits the `latest-mac.yml` feed manifest.
// `--publish never` keeps the upload a deliberate, separate step.
run(electronBuilder, [
  "--config",
  "config/electron-builder.cjs",
  "--prepackaged",
  appPath,
  "--mac",
  "dmg",
  "zip",
  "--arm64",
  "--publish",
  "never",
]);

if (!existsSync(dmgPath)) {
  throw new Error(`Expected DMG was not created at ${dmgPath}.`);
}

run("codesign", [
  "--force",
  "--timestamp",
  "--sign",
  identity,
  dmgPath,
]);
run("codesign", ["--verify", "--strict", "--verbose=4", dmgPath]);
notarize(dmgPath);

run("xcrun", ["stapler", "staple", dmgPath]);
run("xcrun", ["stapler", "validate", dmgPath]);
run("hdiutil", ["verify", dmgPath]);
run("spctl", [
  "--assess",
  "--type",
  "open",
  "--context",
  "context:primary-signature",
  "--verbose=4",
  dmgPath,
]);

console.log(`\nRelease ready: ${dmgPath}`);

if (process.env.UPDATE_GITHUB_OWNER && process.env.UPDATE_GITHUB_REPO) {
  const feed = path.join(releaseDir, "latest-mac.yml");
  const updateZip = path.join(
    releaseDir,
    `Grok-Build-GUI-${packageJson.version}-mac-arm64.zip`,
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
