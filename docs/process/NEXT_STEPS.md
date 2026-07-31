# Next steps

Follow [AGENT_GUIDELINES.md](AGENT_GUIDELINES.md): confirm → small step → verify.

## Session handoff (2026-07-16)

**Done**
- Scaffolded the root project with Electron + Vite + React + TS.
- ACP client in main process: bundled `grok` → `agent stdio` → initialize → session/new → prompt stream → permission modal → cancel.
- Codex-style chat UI (sidebar, chat, composer); **light theme** (Codex-like).
- Fixed black screen: preload must be **CJS** (`out/electron/preload.cjs`), not ESM `.mjs`.
- Headless ACP smoke OK (`@agentclientprotocol/sdk` + local `grok`).
- Charter default tech: Electron (not Tauri). Disposable upstream sources live
  under ignored `tmp/`.
- Grok Build 0.2.111 is pinned by manifest, downloaded into gitignored
  `thirdparty/`, and bundled into the macOS Apple Silicon `.app` with license
  notices. Its self-updater is disabled under the GUI.
- Windows x64 and ARM64 Grok Build artifacts are pinned by the same manifest.
  `bootstrap.cmd` initializes Grok Build, Open Computer Use, Electron, and
  native npm dependencies without changing the user's PATH.
- `npm run package:mac` produces a signed, notarized, stapled drag-and-drop DMG
  containing both Grok Build and Open Computer Use.
- `npm run package:mac:local` remains available for an ad-hoc signed local app.
- **Shared sessions with CLI**: sidebar lists agent sessions via `_x.ai/session/list` (same `~/.grok/sessions` store as `grok sessions`). New chat → `session/new`; open → `session/load` (history replay via `session/update` + `_meta.isReplay`).

**Known**
- Theme: light only (no dark/light toggle by request).
- Session switch keeps transcript in memory for the GUI process only; re-load from agent if not yet loaded this run.
- No Markdown/diff polish.
- macOS signing and notarization are driven entirely by `MAC_SIGNING_IDENTITY`
  and `APPLE_KEYCHAIN_PROFILE`; nothing about the signer is committed. See
  [MAC_RELEASE.md](MAC_RELEASE.md).
- Dev tip: only one `npm run dev`; kill stale Electron/vite if port fights.

**Run**
```bash
./bootstrap --start
```

## Now
1. Dogfood: connect on a workspace that has CLI sessions → open one → continue a turn; create new in GUI → resume in CLI (or reverse).
2. Contract checks: missing binary, stream, permission, cancel, list/load.
3. Optional: Markdown in assistant messages; tool path/diff display.
4. Keep the signed/notarized DMG release gate green before distribution.

## Later (not now)
Intel macOS/Linux artifacts, Windows packaging/signing, external Grok selection,
`agent serve`, second backend, generated compat, TUI parity, theme toggle.
