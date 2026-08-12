# Testing auto-update

Three levels, cheapest first. Only level 3 exercises the install + relaunch —
Squirrel.Mac replaces an app bundle, and a dev run does not have one.

| Level | Covers | Needs |
| --- | --- | --- |
| 1. Unit tests | every button state | nothing |
| 2. Local feed in dev | check → available → download → progress | a local HTTP server |
| 3. Real build | install + relaunch | signed build + a feed (a local server is enough) |

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

## 3. Real build

The only way to verify install + relaunch. Signing is mandatory here and
notarization is not — see "What signing actually requires" below.

Nothing has to be published: point `UPDATE_FEED_URL` at a local server and the
whole upgrade happens on the machine. Substitute
`UPDATE_GITHUB_OWNER` / `UPDATE_GITHUB_REPO` when testing the real GitHub feed
instead; that release must be public, since a private repo would need a token
inside the client.

1. Build the newer version first. Bump `version` in `package.json` to `0.1.1`,
   then:

   ```bash
   npm run build
   MAC_SIGNING_IDENTITY="<identity>" UPDATE_FEED_URL="http://localhost:8099" \
     npx electron-builder --config config/electron-builder.cjs \
     --mac dmg zip --arm64 --publish never
   ```

   Copy `latest-mac.yml` and the `.zip` out of `out/release/` into a directory
   to serve. Keep the `.zip.blockmap` beside them so differential download can
   be exercised too.

2. Build the older version to upgrade *from*: set `version` back to `0.1.0` and
   run the same command. Use `--mac zip` rather than `--mac dir` — `dir` skips
   the step that writes `app-update.yml` into the bundle, and without that file
   the app reports "no release feed configured".

3. Install it somewhere Squirrel can replace in place, and **not** over an
   existing copy you care about:

   ```bash
   cp -R "out/release/mac-arm64/Grok GUI.app" ~/Applications/
   ```

4. Serve the 0.1.1 artifacts on the port the bundle was built against:

   ```bash
   python3 -m http.server 8099 --bind 127.0.0.1
   ```

5. Launch the installed 0.1.0 — not the copy in `out/release/`. Within a few
   seconds the update button appears. Click it; when the ring completes the app
   relaunches on 0.1.1.

6. Confirm it took: the server log should show a `GET` for the `.zip`, the
   bundle's `CFBundleShortVersionString` should now read `0.1.1`, and the
   process id should have changed.

## What signing actually requires

Squirrel.Mac reads the *running* app's designated requirement and checks the
downloaded bundle against it. That is why the level-3 build must be signed, and
why ad-hoc (`MAC_SIGNING_IDENTITY=-`) cannot work: an ad-hoc requirement is
`cdhash H"…"`, which changes with every build, so the new bundle never matches.

A Developer ID is *not* required. Any certificate that stays the same across
both builds works, because the requirement then pins the certificate hash:

```
designated => identifier "ai.grok.build.gui" and certificate leaf = H"<cert-sha1>"
```

A self-signed code-signing certificate therefore upgrades cleanly, and embeds
no name or Team ID in the shipped binary. Notarization is irrelevant to the
updater — it only governs Gatekeeper on first launch of a downloaded build.

Losing that certificate is unrecoverable for installed copies: a build signed
with a different one no longer satisfies their designated requirement, and they
will download updates forever without being able to install them. Back it up.

### If nothing happens

- Settings → Updates shows the reason in words. "No release feed configured"
  means the build had no `UPDATE_GITHUB_*` env vars — check
  `Grok GUI.app/Contents/Resources/app-update.yml` exists.
- The updater's own log lives at
  `~/Library/Logs/Grok GUI/main.log`.
- An unsigned or ad-hoc-signed build (`MAC_SIGNING_IDENTITY=-`) downloads but
  cannot install: Squirrel refuses to replace a bundle whose signature does not
  match. Use a release signed with the stable `Grok Desktop` identity for level 3.
