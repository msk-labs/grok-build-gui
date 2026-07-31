# Agent guidelines

Karpathy-style rules ([source idea](https://x.com/karpathy/status/2015883857489522876)).  
Bias: caution over speed. Scope lives in [PROJECT_CHARTER.md](../architecture/PROJECT_CHARTER.md).

## 1. Think before coding — ask when unclear
- State assumptions; if unclear, **ask** — do not guess silently.
- Surface alternative interpretations and simpler approaches.
- **Complex or fuzzy requests:** stop and ask the user before coding when any of these apply:
  - Goal, success criteria, or scope is ambiguous or multi-way.
  - Several designs are plausible and the choice changes structure or UX.
  - Work would touch hubs (`useGrokApp`, `sessionManager`, `sessionUpdate`, shared types, IPC) or span many modules.
  - Trade-offs are non-obvious (perf vs simplicity, break vs compat, large refactor vs local patch).
- Prefer 1–3 concrete options + a recommended default over open-ended questions.
- Do **not** invent product behavior, expand scope, or “just pick one” when confirmation is cheap.

## 2. Simplicity first
- Minimum code for the request. No speculative features/abstractions/config.
- If 200 lines could be 50, rewrite.

## 2b. Response length by task type
- **Implement / fix / refactor:** Complete the work. Verify proportionally. Don't
  leave the task half-done for the sake of brevity.
- **Q&A only** (explain, compare, “is it X?”, diagnose without changing code):
  **Be brief.** Default to a few sentences or a short bullet list. Skip long
  preambles, repeated context, multi-section essays, and “as discussed above”
  recaps unless the user asks for detail.

## 3. Surgical changes
- Touch only what the task requires. No drive-by refactors or format churn.
- Clean up only orphans **your** change created. Mention other dead code; don't delete it.

## 4. Goal-driven execution
- Define success checks first; loop until they pass.
- Multi-step plan form: `step → verify: check`

## 5. UI modules: independent and small
Architecture intent: [PROJECT_CHARTER.md](../architecture/PROJECT_CHARTER.md) → **UI modularity**. When editing `src/renderer/`:

- Keep feature folders independent: `components/chat/`, `composer/`, `sidebar/`, `layout/` — **no cross-imports** between features.
- Prefer small files (target roughly **under 200–300 lines** for UI pieces). Split before a module becomes a dump.
- Presentational components take **props**; put app state/handlers in hooks (`useGrokApp` and focused sub-hooks), not inside every view.
- Pure helpers stay pure (`lib/`, feature-local utils). Avoid growing hub files for cosmetic UI work.
- **Load only what you need:** UI-only change → that feature folder (+ types if required). Do not read the whole tree or every TS file by default.
- Changing shared contracts (types, IPC, stream reduce, session manager) may need a vertical slice — still minimize blast radius; do not “fix while here.”
- Prefer feature-scoped styles when adding CSS; avoid dumping unrelated rules into a mega global sheet when a local split is easy.

## This repo
- Spike ACP (`grok agent stdio`) before UI chrome unless asked for UI.
- MVP: dual install + one Grok ACP backend. No multi-model / bundled agent / L3 “self-compat” unless asked.
- Keep cloned or extracted upstream projects under ignored `tmp/`; application
  code and packaging must not depend on anything in that directory.
- No new root guide files; extend `docs/` only, and keep them short.
