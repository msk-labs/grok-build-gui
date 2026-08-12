# macOS release

The public macOS artifact is a self-signed Apple Silicon
DMG. It contains `Grok GUI.app` and an `/Applications` shortcut for drag-and-drop
installation.

## Signing identity

Releases use a Code Signing certificate with the exact Common Name
`Grok Desktop`. Create it in Keychain Access → Certificate Assistant → Create a
Certificate, choose Code Signing, and make it self-signed. The release script
rejects every other identity, including Developer ID identities:

```bash
export MAC_SIGNING_IDENTITY="Grok Desktop"
```

List what is available on the machine with
`security find-identity -v -p codesigning`.

The fixed certificate keeps Squirrel.Mac's designated requirement stable, so
signed updates remain compatible. Apple does not notarize self-signed apps.
Gatekeeper therefore requires users to right-click the downloaded app and
choose Open on first launch.

## Build the release

```bash
./scripts/package-dmg
```

The release command:

1. builds and signs the app with the `Grok Desktop` identity;
2. creates the drag-and-drop DMG and updater zip;
3. signs the DMG;
4. verifies the app signature, DMG signature, and disk image.

The final artifact is written to
`out/release/Grok-GUI-<version>-mac-arm64.dmg`.

For a local ad-hoc `.app` that is not suitable for distribution, run
`npm run package:mac:local`.

For a local ad-hoc signed DMG that exercises the complete bundle layout, run:

```bash
./scripts/package-dmg --preview
```

Both DMG modes restore the manifest-pinned Grok Build and Open Computer Use
runtime dependencies and embed them in the application. Downloaded runtime
files under `thirdparty/`, the generated `.app`, and DMG outputs are ignored and
must not be committed.
