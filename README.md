# Grok Build GUI

Desktop **control plane** for [Grok Build](https://x.ai/cli) over
[ACP](https://agentclientprotocol.com). Application source is grouped under
`src/`: React renderer code lives in `src/renderer/`, while Electron main-process
code lives in `src/electron/`.

The app does not reimplement the agent. It runs pinned, integrity-checked Grok
Build and Open Computer Use runtime dependencies, spawns `grok agent stdio`, and
drives sessions through ACP.

## Requirements

- Node.js 22.12+
- Windows 10/11 on x64 or ARM64 for development
- macOS on Apple Silicon for development and the current packaged release

Linux x64 and ARM64 platform identifiers are reserved in the Grok Build runtime
manifest, but Linux remains unsupported until pinned artifact URLs, sizes, and
SHA-256 values are added and verified.

## Bootstrap and run

After cloning the repository on macOS, run:

```bash
./bootstrap
npm run dev
```

To prepare dependencies and start the app in one command:

```bash
./bootstrap --start
```

On Windows PowerShell or Command Prompt, run:

```powershell
.\bootstrap.cmd
npm.cmd run dev
```

To prepare dependencies and start the app in one command:

```powershell
.\bootstrap.cmd --start
```

`bootstrap.cmd` works even when the PowerShell execution policy blocks local
scripts. `bootstrap.ps1` is also available for environments that allow local
PowerShell scripts and accepts `-Start`.

`bootstrap` installs the locked npm dependencies and restores the exact runtime
versions declared in `config/runtime/`. Downloaded runtime files are placed
under `thirdparty/` and are never committed.

## Managed runtime dependencies

- `thirdparty/grok-build/<version>/` contains the pinned Grok executable and
  license notices. This release executable is required by the app and is
  embedded into the packaged application.
- `thirdparty/open-computer-use/<version>/package/` contains the pinned Open
  Computer Use package, which is also embedded into the packaged application.
- `thirdparty/open-computer-use/LICENSE` is tracked because it must accompany
  redistributed Open Computer Use builds.

The application only auto-detects these project-managed dependencies during
development and the corresponding bundled resources in packaged builds. The
downloaded Grok Build and Open Computer Use binaries are ignored and must never
be committed; their tracked manifests are the source of truth for the exact
versions and integrity hashes.

Useful checks:

```bash
npm run artifacts
npm run artifacts:verify
npm test
npm run typecheck
```

## Temporary research material

Put cloned or extracted upstream sources such as Grok Build, Codex application
code, comparison bundles, and one-off research output under `tmp/`. The entire
directory is ignored and must be safe to delete without affecting development,
tests, packaging, or application startup.

The Grok Build source tree under `tmp/`, when present, is reference-only. Other
developers do not need it, bootstrap never downloads it, and production code
must not import from or build against it.

Do not add upstream source snapshots, generated dependency packages, build
outputs, DMGs, `.app` bundles, or design previews to the repository.

## Packaging

On Windows x64, build the unsigned NSIS installer with:

```powershell
npm run package:win
```

The installer is written to
`out/release/Grok-Build-GUI-<version>-win-x64-setup.exe`.

On an Apple Silicon Mac, build the macOS DMG with:

```bash
./scripts/package-dmg --preview
./scripts/package-dmg
```

The preview command creates an ad-hoc signed DMG for local verification. The
default command creates the Developer ID-signed, notarized, and stapled release
DMG. Both flows restore the manifest-pinned runtime dependencies before
packaging and include them in the final application bundle.

See [docs/process/MAC_RELEASE.md](docs/process/MAC_RELEASE.md) for signing and
notarization setup.

## Repository layout

- `src/renderer/`: React, styles, renderer state, and renderer tests.
- `src/electron/`: Electron main process, preload, ACP, and local system
  integrations.
- `config/`: Vite, TypeScript, Electron Builder, and pinned runtime manifests.
- `resources/`: tracked application icons, DMG artwork, and macOS entitlements.
- `scripts/`: dependency installers and DMG release commands.
- `out/`: ignored renderer, Electron, application, and DMG build outputs.
- `thirdparty/`: ignored pinned runtime dependencies restored by bootstrap.
- `tmp/`: ignored disposable upstream source trees and research material.

## Architecture and process

- [Architecture charter](docs/architecture/PROJECT_CHARTER.md)
- [Agent guidelines](docs/process/AGENT_GUIDELINES.md)
- [Next steps](docs/process/NEXT_STEPS.md)

The GUI license is TBD. The bundled Grok Build artifact is Apache-2.0 and ships
with its upstream and third-party notices. Open Computer Use 0.2.1 is
MIT-licensed and retains its license in packaged distributions.
