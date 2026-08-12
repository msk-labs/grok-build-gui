const path = require("node:path");
const grokManifest = require("./runtime/grok-build.json");
const computerUseManifest = require("./runtime/open-computer-use.json");

/**
 * Signing identity, supplied by the release script. Public releases use the
 * stable self-signed "Grok Desktop" certificate so no legal name or Apple Team
 * ID is exposed. Unset means unsigned: the build runs locally, but Squirrel.Mac
 * cannot install an update over it — see docs/process/MAC_RELEASE.md.
 *
 *   MAC_SIGNING_IDENTITY="Grok Desktop"
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
 * Auto-update feed. Two providers, first match wins:
 *
 *   UPDATE_FEED_URL=<base-url>
 *     Generic — any static host that serves `latest-mac.yml` beside the zip.
 *     A local server is what the level-3 test in
 *     docs/process/testing-auto-update.md uses, so verifying install +
 *     relaunch needs no public release at all.
 *
 *   UPDATE_GITHUB_OWNER=<org-or-user> UPDATE_GITHUB_REPO=<repo>
 *     GitHub Releases. Must be public — a private repo would need a token
 *     shipped inside the client.
 *
 * Unset, the build carries no `app-update.yml` and the app reports "no release
 * feed configured" instead of failing a check.
 */
const updateFeedUrl = process.env.UPDATE_FEED_URL;
const updateOwner = process.env.UPDATE_GITHUB_OWNER;
const updateRepo = process.env.UPDATE_GITHUB_REPO;
const publish = updateFeedUrl
  ? [{ provider: "generic", url: updateFeedUrl }]
  : updateOwner && updateRepo
    ? [{ provider: "github", owner: updateOwner, repo: updateRepo }]
    : null;

if (!publish) {
  console.warn(
    "[electron-builder] UPDATE_FEED_URL and UPDATE_GITHUB_OWNER/REPO unset — " +
      "packaging without an auto-update feed.",
  );
}

module.exports = {
  appId: "ai.grok.build.gui",
  ...(publish ? { publish } : {}),
  productName: "Grok GUI",
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
    // Self-signed certificates cannot use Apple's trusted timestamp service.
    // Disabling it also avoids a network wait for every signed resource.
    timestamp: "none",
    hardenedRuntime: true,
    notarize: false,
    entitlements: "resources/entitlements.mac.plist",
    entitlementsInherit: "resources/entitlements.mac.plist",
    // Every mac artifact except the DMG, which overrides this below. Left to
    // the default the zip is named after productName, and productName has
    // spaces: GitHub rewrites those to dots on upload ("Grok.Build.GUI-…"),
    // while latest-mac.yml records the dashed form, so electron-updater asks
    // for a URL that 404s. Naming the zip here keeps the two identical.
    artifactName: "Grok-GUI-${version}-${arch}-mac.${ext}",
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
    artifactName: "Grok-GUI-${version}-win-${arch}-setup.${ext}",
  },
  dmg: {
    artifactName: "Grok-GUI-${version}-mac-${arch}.${ext}",
    title: "Grok GUI Installer",
    background: "dmg-background.png",
    icon: "resources/icon.icns",
    iconSize: 112,
    iconTextSize: 15,
    // Sign before electron-builder generates the blockmap and update manifest,
    // otherwise a post-build signature would invalidate their size and hash.
    sign: true,
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
