# macOS release

The public macOS artifact is a signed, notarized, and stapled Apple Silicon
DMG. It contains `Grok Build GUI.app` and an `/Applications` shortcut for drag-and-drop
installation.

## Signing identity

Nothing about the signer is committed. Both values come from the environment,
so a clone signs with its own certificate and this repository carries no one's
name or Team ID:

```bash
export MAC_SIGNING_IDENTITY="Developer ID Application: Example Ltd (ABCDE12345)"
export APPLE_KEYCHAIN_PROFILE="<your-notarytool-profile>"
```

List what is available on the machine with
`security find-identity -v -p codesigning`.

A Developer ID certificate always carries the signer's legal name (individual
account) or organisation name (company account), and `codesign -dv` reveals it
to anyone holding the app. A **self-signed** certificate avoids that: pick any
Common Name in Keychain Access → Certificate Assistant → Create a Certificate
(type: Code Signing), and pass it as `MAC_SIGNING_IDENTITY`. Auto-update still
works, because Squirrel.Mac only requires the old and new bundles to satisfy
the same designated requirement, and a fixed certificate keeps that stable.
The trade-off is Gatekeeper: a downloaded self-signed build must be opened with
right-click → Open the first time. Notarization is not available for
self-signed certificates, so skip `npm run package:mac` and invoke
electron-builder directly.

## One-time notarization setup

Only needed for a notarized Developer ID release. Store the credentials in the
login keychain — never put the app-specific password in this repository:

```bash
xcrun notarytool store-credentials "<your-notarytool-profile>" \
  --apple-id "<apple-id-email>" \
  --team-id "<TEAM_ID>" \
  --password "<app-specific-password>"
```

## Build the release

```bash
./scripts/package-dmg
```

The release command:

1. signs the app with `MAC_SIGNING_IDENTITY`;
2. verifies and notarizes the app, then staples its ticket;
3. creates the drag-and-drop DMG;
4. signs, notarizes, and staples the DMG;
5. runs code-signing, Gatekeeper, stapler, and disk-image verification.

The final artifact is written to
`out/release/Grok-Build-GUI-<version>-mac-arm64.dmg`.

Set `APPLE_KEYCHAIN` as well when the notarytool profile is stored in a
non-default keychain.

For a local ad-hoc `.app` that is not suitable for distribution, run
`npm run package:mac:local`.

For a local ad-hoc signed DMG that exercises the complete bundle layout without
Apple notarization credentials, run:

```bash
./scripts/package-dmg --preview
```

Both DMG modes restore the manifest-pinned Grok Build and Open Computer Use
runtime dependencies and embed them in the application. Downloaded runtime
files under `thirdparty/`, the generated `.app`, and DMG outputs are ignored and
must not be committed.
