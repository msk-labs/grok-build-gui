# Codex conversation folding comparison

## Scope

This compares the current application working tree with the locally installed
Codex desktop application. It is a static analysis of the shipped production
bundle, not the original Codex TypeScript source.

- Application path: `/Applications/ChatGPT.app`
- Bundle identifier: `com.openai.codex`
- Version: `26.715.72359`
- Build: `5718`
- `app.asar` SHA-256:
  `6c6528eb1e8450cdc506a59586f8caffe87576e200977e2a11bdea0cecf1c718`
- Extracted files: 6,095 (214 MB)
- Full extraction:
  `tmp/codex-app-26.715.72359/`
- Readable conversation bundle:
  `tmp/codex-app-analysis-26.715.72359/conversation.pretty.js`

The extracted application did not include source maps. Function names in the
readable bundle therefore remain minified, but strings, state transitions, item
types, grouping rules, and render structure are preserved.

## Main finding

The current project models folding as a two-level hierarchy around an assistant
turn:

1. A completed turn folds the entire process trail under `Worked for …`.
2. Thoughts and tools have nested folds inside that outer fold.

Codex `26.715.72359` does not use `Worked for …` as an outer fold. It renders
`worked-for` as a standalone divider and folds semantic activity groups
independently. Reasoning is also independent: it is visible while streaming and
collapses when complete.

## Rule-by-rule comparison

| Area | Codex `26.715.72359` | Current app | Difference |
| --- | --- | --- | --- |
| `Worked for` | A standalone, non-collapsible divider between activity and the final response. | The label of an L1 fold wrapping every process block before the last text block. | The project's top-level folding boundary does not match Codex. |
| Final response detection | Uses explicit typed timeline items, including `worked-for` and `assistant-message`. | Treats the last non-empty text block as final after streaming ends. | The project uses a positional heuristic; Codex uses protocol semantics. |
| Activity grouping | Consecutive items whose normalized metadata says `grouping === "groupable"` form a group. Non-groupable items become standalone units. | Only consecutive `tool` blocks form a group, and only when there are at least two. Text and thought blocks break the run. | Codex grouping is type/metadata-driven and covers more than tools. |
| Completed group summary | Builds semantic summary parts such as `Read files`, `Ran commands`, `Edited files`, `Searched the web`, and `Used … integrations`. | Uses the generic count label `Ran N operations`. | Codex summarizes outcomes and categories, not just operation count. |
| Active group summary | Shows the most relevant active item, for example `Running {command}`, `Editing files`, or `Searching the web …`; falls back to `Thinking`. | Uses `Running N operations`. | Codex exposes the current activity rather than the group size. |
| Group default state | Collapsed by default. The latest live group can run an initial closing animation. | Collapsed immediately through a native `<details>` element. | Default visibility is similar, but lifecycle and animation differ. |
| Expanded group body | Directly renders the grouped activity items in a vertically scrollable, edge-faded body capped at `max-h-56`. | Renders an unbounded list of nested `ToolFold` components. | The project can create a taller and more deeply nested disclosure tree. |
| Reasoning while live | Body is automatically visible while reasoning is incomplete; no completed-state disclosure is needed yet. | The live thought is still collapsed by default and only adds pulse dots to its label. | Live reasoning visibility is opposite. |
| Reasoning when complete | Automatically hidden, then user-expandable. Label is `Thought` or `Thought for {elapsed}`. | Remains a collapsed `Thought` fold, without per-thought elapsed time. | Completed default is close, but timing and transition differ. |
| Individual command details | Command output has its own collapsed/expanded state. Other activity types use specialized renderers and are not forced into one generic tool fold. | Every tool is represented by the same generic L2 fold. | Codex uses per-activity disclosure rules. |
| Long user messages | Measures rendered content; defaults to a 20-line limit and shows `Show more` / `Show less`. Hidden interactive descendants are made inert. | User message text is always fully rendered. | The project is missing user-message folding and its accessibility handling. |
| Search-driven expansion | No search-specific default expansion is present in the inspected disclosure components. | A matching thought opens its L2 fold, and a matching process block opens the completed L1 fold. | This is a project-specific convenience, not part of the inspected Codex folding rules. |
| Mounting and animation | Uses `opening → expanded → closing → collapsed`; content remains mounted during the closing animation and unmounts after collapse. | Uses `<details>` and mounts children only while `open`. | Codex has explicit transition states; the project switches immediately. |

## Codex evidence

All line references below point to the generated readable bundle.

- `Worked for` labels and divider rendering:
  `conversation.pretty.js:92`, `conversation.pretty.js:117`
- Generic disclosure state machine and default-collapsed rule:
  `conversation.pretty.js:569`
- Semantic completed summary construction:
  `conversation.pretty.js:941`, `conversation.pretty.js:945`,
  `conversation.pretty.js:1024`
- Metadata-driven group/standalone partition:
  `conversation.pretty.js:1072`
- Live-versus-completed group header selection:
  `conversation.pretty.js:1090`
- Long user-message measurement, 20-line default, and accessibility handling:
  `conversation.pretty.js:1279`
- Command detail default state:
  `conversation.pretty.js:3710`
- Live-open/completed-collapsed reasoning:
  `conversation.pretty.js:6748`
- Group disclosure body and `max-h-56` cap:
  `conversation.pretty.js:7973`

## Current project evidence

- Last-text final-response heuristic and L1 `Worked for` fold:
  `src/renderer/components/chat/AssistantTimeline.tsx:49`,
  `src/renderer/components/chat/AssistantTimeline.tsx:100`
- Consecutive-tool-only grouping:
  `src/renderer/components/chat/AssistantTimeline.tsx:131`
- Thought fold, including live thoughts defaulting closed:
  `src/renderer/components/chat/AssistantTimeline.tsx:187`
- Native `<details>` state and conditional body mounting:
  `src/renderer/components/chat/ProcessFold.tsx:7`
- Generic `Running/Ran N operations` summary:
  `src/renderer/components/chat/ToolCards.tsx:207`
- Nested group of individual tool folds:
  `src/renderer/components/chat/ToolCards.tsx:226`
- User messages rendered without truncation:
  `src/renderer/components/chat/MessageBubble.tsx:47`

## Alignment implications

Matching this Codex version requires a behavior change rather than a styling-only
change:

1. Remove the completed-turn L1 wrapper; keep `Worked for …` as a divider.
2. Represent activity grouping explicitly instead of deriving it only from
   consecutive tool blocks.
3. Produce semantic active and completed summaries from activity categories.
4. Keep live reasoning open, then collapse it on completion.
5. Use specialized disclosure behavior for commands, patches, searches, and
   integrations rather than nesting every item under a generic tool fold.
6. Add measured long-user-message folding with accessible hidden content.

The project can retain search-driven auto-expansion as an intentional extension,
but it should be treated separately from Codex parity.
