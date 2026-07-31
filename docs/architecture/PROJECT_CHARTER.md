# Architecture charter (v0.3)

Short by design (token budget). Details only when coding needs them.

## Product
- **Build:** Desktop GUI **control plane** over **ACP** → local `grok agent`.
- **Not:** TUI reskin, second agent runtime, shell/pager as a library.
- **Endgame:** `AgentBackend` ports; Grok first, other models later.

```
GUI (UI, spawn, permission prompts, settings)
        │ ACP  stdio (MVP) | serve (later)
        ▼
grok agent (sessions, tools, goal/loops, app permissions, optional OS sandbox)
```

## Hard rules
| Do | Don't |
|----|--------|
| Talk ACP / documented CLI only | Link `xai-grok-shell` / pager internals |
| Agent owns session/tool/goal truth | GUI as second transcript authority |
| Pinned, verified Grok artifact + notices | Depend on an ambient system `grok` |
| Permission UI via ACP reverse-request | Claim OS sandbox is “prompt to allow” |
| Capability-detect features | Hardcode version folklore as only gate |
| One backend until a second is real | Speculative plugin frameworks |
| Keep disposable upstream trees under `tmp/` | Silent vendor forks in app code |
| UI features small + independent | Cross-feature UI imports; god components |

## UI modularity (`src/renderer/`)
Goal: local UI edits stay local — small blast radius, less code loaded per change.

| Layer | Own | Avoid |
|-------|-----|--------|
| Feature UI (`components/chat\|composer\|sidebar\|layout`) | Render + local UI state | Importing sibling features; owning ACP/session truth |
| Hooks | Wire IPC → props; session/composer state | Dumping all future features into one ever-growing hook without split |
| `lib/` pure helpers | Transcript merge, attachments, list merge | React/Electron coupling |
| Electron main / ACP | Process, agent stdio, IPC | UI markup or feature CSS |

- **Independence:** feature folders do not import each other; compose only at `App` (or a thin layout shell).
- **Size:** keep UI modules small; split when a file becomes a multi-concern hub (same spirit as process guidelines).
- **Edit scope:** cosmetic/feature-UI work should not force loading the whole project; hub files (`sessionManager`, stream reduce, shared types) only when the task truly needs them.
- Process detail: [../process/AGENT_GUIDELINES.md](../process/AGENT_GUIDELINES.md) §5.

## Visual contract

`src/renderer/styles/app.css :root` is the implementation source of truth.
Refactors must preserve these values unless the task explicitly changes the
visual system.

| Role | Contract |
|------|----------|
| UI font | `-apple-system`, `BlinkMacSystemFont`, `SF Pro Text`, `Segoe UI`, sans-serif |
| Monospace | `ui-monospace`, `SFMono-Regular`, `SF Mono`, Menlo, Consolas, monospace |
| Base UI | 14px / 1.5 / weight 445 |
| Chat body | 14px / 22px / weight 500 |
| Navigation | 14px / weight 400–500 |
| Brand title | 16px / weight 600 |
| Supporting text | 13px; metadata and disclosures 12px; compact labels 10–11px |
| Empty-state title | 24px / weight 500; supporting copy 16px |
| Primary surfaces | `#ffffff`; sidebar/tool surface `#f9f9f9`; user bubble `#f3f3f3` |
| Text | primary `#2a2c2f`; muted `rgba(42,44,47,.7)`; dim `rgba(42,44,47,.5)` |
| Borders | `rgba(42,44,47,.08)`; strong `rgba(42,44,47,.16)` |
| Semantic color | accent `#0f766e`; danger `#dc2626`; warning `#b45309` |

Do not replace the font stack, normalize weights to 400/600, or introduce
near-duplicate colors and type sizes in component styles. Reuse the root tokens
and the core 10/11/12/13/14/16/24px hierarchy. Existing scoped
11.5/12.5/13.5/15/20px exceptions are not general-purpose tokens and must not
spread during refactors.

## Safety (two layers)
1. **App permissions** (hooks/rules/mode) → may `request_permission` → **GUI must implement**.
2. **OS sandbox** (optional, default off): Seatbelt/Landlock; hard EPERM; **no human grant callback**.

YOLO / no-sandbox / non-localhost serve: explicit + visible.

## Compat
- Probe: path → version → ACP `initialize` → actionable errors.
- Tiers: Bundled / Unsupported. External installs may be reconsidered later.
- Prefer declarative maps over codegen. “Self-evolving compat” is experimental, default off, not an SLA.
- Contract smoke: init, session, stream chunk, permission allow+deny, cancel, bad binary.

## MVP (P0)
**In:** pinned bundled `grok`, stdio ACP, stream + tools UI, permission modal, cancel, clear errors.
**Out:** external Grok selection, multi-model backends, serve, full TUI parity.

## Defaults
- Transport: stdio. Tech: TS + Electron at the repository root. Language: English docs/code.
- Layout: `docs/` for guides; root only `README` + short `AGENTS.md`.

## Decisions
D1 ACP client not pager swap · D2 bundled-only pinned Grok · D3 one Grok backend first ·
D4 ports+tests when needed · D5 no L3-as-SLA · D6 permission UI required ·  
D7 loops stay in agent · D8 short docs (this file)

Edit discipline: [../process/AGENT_GUIDELINES.md](../process/AGENT_GUIDELINES.md).
