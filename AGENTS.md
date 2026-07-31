# Agents

Use this file as the mandatory entry point. Read linked documents only when the
task needs them:

| Task | Read |
| --- | --- |
| Any non-trivial code or structural change | [Agent guidelines](docs/process/AGENT_GUIDELINES.md) |
| Product behavior, architecture, ACP, IPC, or shared contracts | [Project charter](docs/architecture/PROJECT_CHARTER.md) |
| Planning or choosing the next project task | [Next steps](docs/process/NEXT_STEPS.md) |
| macOS signing, notarization, or DMG work | [macOS release](docs/process/MAC_RELEASE.md) |

## Repository map

- `src/renderer/`: React UI, renderer state, styles, and renderer tests.
- `src/electron/`: Electron main process, preload, ACP, and local integrations.
- `config/`: Vite, TypeScript, Electron Builder, and pinned runtime manifests.
- `resources/`: tracked icons, DMG artwork, and macOS entitlements.
- `scripts/`: runtime installers and macOS packaging commands.
- `thirdparty/`: bootstrap-downloaded runtime dependencies; generated content is
  ignored except required license files.
- `tmp/`: disposable upstream source trees and research material; production
  code, tests, and packaging must never depend on it.
- `out/`: generated build and release output; never commit it.

## Required defaults

- Write code, documentation, and Git commit messages in English.
- **Communication:** When *implementing* code or structural work, stay thorough
  enough to finish the task (verify, don't leave half-done). When *answering
  questions* (explain, compare, diagnose without coding), keep replies short —
  prefer a few sentences or a tight bullet list; no long essays, repeated
  background, or filler.
- Ask before implementing when scope, success criteria, product behavior, or
  architecture has multiple reasonable interpretations.
- Make the smallest change that fully solves the request. Avoid drive-by
  refactors, formatting churn, speculative abstractions, and unrelated cleanup.
- Keep renderer feature folders independent. Compose features at `App` or a
  thin layout boundary; do not create cross-feature imports.
- Keep UI modules focused and roughly under 200–300 lines. Put application state
  in focused hooks, presentation in components, and pure logic in `lib/`.
- Treat ACP and the documented Grok CLI as the integration boundary. Do not link
  application code to reference-only Grok Build internals under `tmp/`.

## Runtime and repository hygiene

- `./bootstrap` is the supported clean-clone setup path.
- Grok Build and Open Computer Use versions and integrity hashes are pinned in
  `config/runtime/`.
- Downloaded runtime binaries belong under ignored `thirdparty/`; never commit
  them.
- Never commit `node_modules/`, `out/`, `tmp/`, `.app`, DMG, blockmap, extracted
  upstream sources, caches, previews, or local credentials.
- Keep the repository root minimal: put operational commands in `scripts/` and
  detailed guidance in `docs/`; do not add new root-level guide files.
- Keep `package-lock.json` committed and update it only when dependencies
  intentionally change.
- Do not edit or delete unrelated user files in a dirty working tree.

## Sandbox and command execution

- On Windows, the restricted agent sandbox may fail before a project command
  starts, including `CreateProcessAsUserW` error 1920 when launching PowerShell.
  Do not treat that as a project, bootstrap, test, or build failure.
- When an important command fails with a process-creation, permission, DNS,
  connection, registry, or artifact-download error that may be sandbox-related,
  rerun the same scoped command with the required sandbox escalation and a clear
  approval reason before diagnosing project code.
- Test connectivity from the same execution context that will perform the
  install or build. Check the actual required endpoints (npm, x.ai artifacts,
  GitHub/Electron) rather than assuming that general internet access implies
  dependency access.
- Do not change npm registries, Electron mirrors, proxies, or other persistent
  user configuration merely to work around a sandbox failure. Verify the
  current configuration and official-source connectivity first, and ask before
  making any persistent environment change.
- Record whether a reported result came from the restricted sandbox or an
  approved host execution, especially for bootstrap, artifact, packaging, and
  GUI startup verification.

## Verification

Run checks proportional to the change:

- Code or configuration: `npm test` and `npm run typecheck`.
- Dependency/bootstrap paths: start without `node_modules/`, `out/`, or the
  versioned downloads under `thirdparty/` (preserve tracked license files), run
  `./bootstrap`, then run `npm run artifacts:verify`.
- Renderer or Electron startup paths: run `npm run dev` and confirm the window
  loads; stop the process after verification.
- DMG or packaging paths: run `./scripts/package-dmg --preview` and confirm the
  packaged app contains both `grok-build` and `open-computer-use`.
- Before handoff: run `git diff --check` and verify generated files are still
  ignored and unstaged.
