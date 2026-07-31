# Testing auto-update

Three levels, cheapest first. Only level 3 exercises the install + relaunch —
Squirrel.Mac replaces an app bundle, and a dev run does not have one.

| Level | Covers | Needs |
| --- | --- | --- |
| 1. Unit tests | every button state | nothing |
| 2. Local feed in dev | check → available → download → progress | a local HTTP server |
| 3. Real build | install + relaunch | signed build + published release |

## 1. Button states

```bash
npx vitest run --config config/vite.config.ts --root . src/renderer/components/sidebar/UpdateButton.test.tsx
```

Covers: hidden when idle / up to date / unsupported, download click, ring
geometry mid-download, restart fallback. No app run required.

## 2. Local feed against a dev run

An unpackaged run normally reports "updates unavailable in development". Drop a
`dev-app-update.yml` in the repo root and it checks that feed instead —
`unsupportedReason()` looks for the file and points electron-updater at it via
`forceDevUpdateConfig`. The file is gitignored.

One command sets all of it up — writes `dev-app-update.yml`, fabricates a
release archive with a correct `sha512`, and serves the feed:

```bash
npm run dev:update-feed
```

Then in another terminal:

```bash
npm run dev
```

The advertised version is `9.9.9`, so it always beats the local one. A few
seconds after launch the update button appears in the sidebar footer; clicking
it downloads the 40 MB archive for real, so the ring is driven by genuine
bytes. The install step then fails — expected in dev, and the reason level 3
exists.

Flags: `--version`, `--port`, `--size` (MB). A bigger `--size` makes the
progress ring easier to watch.

Delete `dev-app-update.yml` when you are done, or the next `npm run dev` will
check a feed that is no longer being served. That failure is silent by design
(the startup check never raises a banner) — to see it, use "check for updates"
in Settings → Updates, which does report errors.

## 3. Real build, real release

The only way to verify install + relaunch.

1. Publish the newer version first. Bump `version` in `package.json` to the
   target (say `0.1.1`), then:

   ```bash
   UPDATE_GITHUB_OWNER=<owner> UPDATE_GITHUB_REPO=<repo> npm run package:mac
   ```

   Attach the `.dmg`, the `.zip`, and `latest-mac.yml` from `out/release/` to a
   **public** GitHub release tagged `v0.1.1`. A private repo would need a token
   inside the client.

2. Build the older version to upgrade *from*: set `version` back to `0.1.0`,
   run the same packaging command, and install that DMG to `/Applications`.

3. Launch the installed 0.1.0 from `/Applications` — not from `out/release/`,
   since Squirrel needs the app in a writable location it owns. Within a few
   seconds the update button appears. Click it; when the ring completes the app
   relaunches on 0.1.1.

4. Confirm in Settings → Updates that the current version now reads 0.1.1.

### If nothing happens

- Settings → Updates shows the reason in words. "No release feed configured"
  means the build had no `UPDATE_GITHUB_*` env vars — check
  `Grok Build GUI.app/Contents/Resources/app-update.yml` exists.
- The updater's own log lives at
  `~/Library/Logs/Grok Build GUI/main.log`.
- An unsigned or ad-hoc-signed build (`MAC_SIGNING_IDENTITY=-`) downloads but
  cannot install: Squirrel refuses to replace a bundle whose signature does not
  match. Use the real Developer ID build for level 3.
