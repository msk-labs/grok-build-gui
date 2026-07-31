const path = require("node:path");
const grokManifest = require("./runtime/grok-build.json");
const computerUseManifest = require("./runtime/open-computer-use.json");

/**
 * Signing identity, from the environment only. A committed default would
 * publish the signer's name and Team ID into an open repository, and on
 * another machine it would silently pick a certificate nobody chose. Unset
 * means unsigned: the build runs locally, but Squirrel.Mac cannot install an
 * update over it — see docs/process/MAC_RELEASE.md.
 *
 *   MAC_SIGNING_IDENTITY="Developer ID Application: Example Ltd (ABCDE12345)"
 *   MAC_SIGNING_IDENTITY=-   ad-hoc; local smoke tests only, breaks updates
 */
const developerIdApplication = process.env.MAC_SIGNING_IDENTITY ?? null;

if (!developerIdApplication && process.platform === "darwin") {
  console.warn(
    "[electron-builder] MAC_SIGNING_IDENTITY unset — building unsigned. " +
      "Installed copies will not be able to auto-update.",
  );
}

const platformKey = `${process.platform}-${process.arch}`;
const grokPlatform = grokManifest.platforms[platformKey];

if (!grokPlatform) {
  throw new Error(`Packaging is not configured for ${platformKey}.`);
}

/**
 * Auto-update feed (GitHub Releases). Set both to enable it:
 *   UPDATE_GITHUB_OWNER=<org-or-user> UPDATE_GITHUB_REPO=<repo> npm run package:mac
 *
 * Unset, the build carries no `app-update.yml` and the app reports "no release
 * feed configured" instead of failing a check. Releases must be public — a
 * private repo would need a token shipped in the client.
 */
const updateOwner = process.env.UPDATE_GITHUB_OWNER;
const updateRepo = process.env.UPDATE_GITHUB_REPO;
const publish =
  updateOwner && updateRepo
    ? [{ provider: "github", owner: updateOwner, repo: updateRepo }]
    : null;

if (!publish) {
  console.warn(
    "[electron-builder] UPDATE_GITHUB_OWNER / UPDATE_GITHUB_REPO unset — " +
      "packaging without an auto-update feed.",
  );
}

module.exports = {
  appId: "ai.grok.build.gui",
  ...(publish ? { publish } : {}),
  productName: "Grok Build GUI",
  directories: {
    buildResources: "resources",
    output: "out/release",
  },
  files: ["out/renderer/**", "out/electron/**", "package.json"],
  asar: true,
  // node-pty must run `spawn-helper` from disk, and it has no `.node` suffix —
  // unpack the whole module so the helper lands outside app.asar.
  asarUnpack: ["**/*.node", "**/node_modules/node-pty/**"],
  // node-pty ships Windows prebuilds for both x64 and ARM64. Rebuilding them
  // here would unnecessarily require the Visual Studio Spectre libraries.
  npmRebuild: process.platform !== "win32",
  extraResources: [
    {
      from: path.join(
        grokManifest.artifactRelativeRoot,
        grokPlatform.artifactPlatform,
      ),
      to: grokManifest.packagedResourceSubdir,
    },
    {
      from: computerUseManifest.artifactRelativePath,
      to: computerUseManifest.packagedResourceSubdir,
    },
  ],
  mac: {
    category: "public.app-category.developer-tools",
    icon: "resources/icon.icns",
    identity: developerIdApplication,
    hardenedRuntime: true,
    notarize: false,
    entitlements: "resources/entitlements.mac.plist",
    entitlementsInherit: "resources/entitlements.mac.plist",
    // Squirrel.Mac updates from a zip, not the DMG — the DMG stays the
    // human download, the zip is what electron-updater fetches.
    target: [
      { target: "dmg", arch: ["arm64"] },
      { target: "zip", arch: ["arm64"] },
    ],
  },
  win: {
    icon: "resources/icon.png",
    target: [{ target: "nsis", arch: ["x64"] }],
    artifactName: "Grok-Build-GUI-${version}-win-${arch}-setup.${ext}",
  },
  dmg: {
    artifactName: "Grok-Build-GUI-${version}-mac-${arch}.${ext}",
    title: "Grok Build GUI Installer",
    background: "dmg-background.png",
    icon: "resources/icon.icns",
    iconSize: 112,
    iconTextSize: 15,
    sign: false,
    window: {
      width: 760,
      height: 460,
    },
    contents: [
      {
        x: 205,
        y: 260,
      },
      {
        x: 555,
        y: 260,
        type: "link",
        path: "/Applications",
      },
    ],
  },
};
