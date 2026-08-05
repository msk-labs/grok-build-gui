import type { ReactNode } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { AssistantBlock } from "../../types/chat";
import { collectFileChanges, withTurnArtifacts } from "../../lib/fileChanges";
import type { OpenFileViewRequest } from "./FileChangeBar";
import { FileChangeBar } from "./FileChangeBar";
import { HighlightText } from "./HighlightText";
import { MessageMarkdown } from "./markdown/MessageMarkdown";
import { ProcessFold } from "./ProcessFold";
import {
  ToolActivityGroup,
  type ActivityGroupItem,
} from "./ToolCards";
import { WorkingIndicator } from "./WorkingIndicator";

/**
 * Codex-like timeline (block order preserved).
 *
 * Live:
 *   Intermediate text stays visible. Consecutive tools + thoughts share one
 *   collapsed semantic activity group whose label follows the current tool
 *   (or "Thinking" when only reasoning is live). Thought bodies and tool
 *   details stay collapsed — only summary + live dots are shown.
 *
 * Done:
 *   Activity groups stay collapsed with a tool-category summary title
 *   (thoughts are not named in the title). Expanding reveals L2 thought/tool
 *   folds, which also stay collapsed until clicked. "Worked for Xm Ys" is a
 *   divider before the final text. File change chips list edits/creates below
 *   the answer.
 */
export function AssistantTimeline({
  blocks,
  streaming,
  createdAt,
  finishedAt,
  artifacts,
  onOpenFile,
  workspaceRoot,
  highlightQuery,
}: {
  blocks: AssistantBlock[];
  streaming: boolean;
  createdAt: number;
  finishedAt?: number;
  /** Files found on disk after the turn that no tool call reported. */
  artifacts?: string[];
  onOpenFile?: (req: OpenFileViewRequest) => void;
  workspaceRoot?: string;
  /** When set, highlight matches in text / thoughts (search jump). */
  highlightQuery?: string | null;
}) {
  const { t } = useTranslation();
  if (streaming && blocks.length === 0) {
    return <WorkingIndicator />;
  }

  const lastTextIndex = findLastTextIndex(blocks);
  const done = !streaming;
  // Final text only after the turn ends; while live every text is "body".
  const finalIndex = done ? lastTextIndex : -1;

  const processBlocks: Array<{ block: AssistantBlock; index: number }> = [];
  let finalText: string | null = null;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    if (finalIndex >= 0 && i === finalIndex && block.type === "text") {
      finalText = block.text;
      continue;
    }
    processBlocks.push({ block, index: i });
  }

  const hasProcess = processBlocks.some(({ block }) => blockHasContent(block));
  const liveThoughtTip =
    streaming &&
    blocks.length > 0 &&
    blocks[blocks.length - 1]?.type === "thought"
      ? blocks.length - 1
      : -1;

  const processTrail = (
    <div className="process-trail">
      {renderProcessTrail(processBlocks, {
        streaming,
        liveThoughtTip,
        lastTextIndex,
        onOpenFile,
        highlightQuery,
        t,
      })}
    </div>
  );

  const fileChanges = done
    ? withTurnArtifacts(collectFileChanges(blocks), artifacts)
    : [];

  return (
    <>
      {hasProcess || streaming ? processTrail : null}

      {done && hasProcess ? (
        <WorkedForDivider label={workedForLabel(createdAt, finishedAt, t)} />
      ) : null}

      {finalText ? (
        <div className="message-body message-final">
          <MessageMarkdown
            text={finalText}
            highlightQuery={highlightQuery}
            onOpenFile={onOpenFile}
          />
        </div>
      ) : null}

      {done && onOpenFile ? (
        <FileChangeBar
          changes={fileChanges}
          onOpen={onOpenFile}
          workspaceRoot={workspaceRoot}
        />
      ) : null}
    </>
  );
}

/**
 * Walk process blocks in order.
 * Consecutive tool + thought runs share one semantic activity group; assistant
 * text keeps its own open position and splits groups.
 */
function renderProcessTrail(
  processBlocks: Array<{ block: AssistantBlock; index: number }>,
  opts: {
    streaming: boolean;
    liveThoughtTip: number;
    lastTextIndex: number;
    onOpenFile?: (req: OpenFileViewRequest) => void;
    highlightQuery?: string | null;
    t: TFunction<"translation">;
  },
): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0;
  while (i < processBlocks.length) {
    const { block, index } = processBlocks[i]!;

    if (block.type === "tool" || block.type === "thought") {
      const items: ActivityGroupItem[] = [];
      let keyId = "";
      let hasTool = false;

      while (i < processBlocks.length) {
        const cur = processBlocks[i]!;
        if (cur.block.type !== "tool" && cur.block.type !== "thought") break;

        if (cur.block.type === "tool") {
          if (!keyId) keyId = cur.block.tool.id;
          hasTool = true;
          items.push({ type: "tool", tool: cur.block.tool });
        } else {
          if (!cur.block.text) {
            i += 1;
            continue;
          }
          if (!keyId) keyId = cur.block.id;
          const q = opts.highlightQuery?.trim() ?? "";
          const thoughtHit =
            q.length > 0 &&
            cur.block.text.toLowerCase().includes(q.toLowerCase());
          items.push({
            type: "thought",
            id: cur.block.id,
            text: cur.block.text,
            live: cur.index === opts.liveThoughtTip,
            searchHit: thoughtHit,
          });
        }
        i += 1;
      }

      if (items.length === 0) continue;

      // Tool-bearing runs share one summary fold. Thought-only runs stay as
      // standalone L2 folds (avoids double-nesting a single thought).
      if (hasTool) {
        out.push(
          <ToolActivityGroup
            key={`tg-${keyId}`}
            items={items}
            onOpenFile={opts.onOpenFile}
            highlightQuery={opts.highlightQuery}
          />,
        );
      } else {
        for (const item of items) {
          if (item.type !== "thought") continue;
          // Standalone thoughts stay collapsed; search may open them.
          out.push(
            <ProcessFold
              key={item.id}
              label={
                item.live
                  ? opts.t("tools.thinking")
                  : opts.t("tools.thought")
              }
              live={item.live}
              className="process-fold-l2"
              defaultOpen={false}
              openWhen={Boolean(item.searchHit)}
            >
              <div className="process-done-body">
                <div className="thoughts">
                  <HighlightText
                    text={item.text}
                    query={opts.highlightQuery}
                  />
                </div>
              </div>
            </ProcessFold>,
          );
        }
      }
      continue;
    }

    // Intermediate / live body text — always open (not wrapped in a fold).
    if (block.type === "text") {
      if (!block.text) {
        i += 1;
        continue;
      }
      const growing =
        opts.streaming &&
        index === opts.lastTextIndex &&
        opts.lastTextIndex >= 0;
      out.push(
        <div
          key={block.id}
          className={`message-body message-process-text${growing ? " streaming-cursor" : ""}`}
        >
          <MessageMarkdown
            text={block.text}
            streaming={growing}
            highlightQuery={opts.highlightQuery}
            onOpenFile={opts.onOpenFile}
          />
        </div>,
      );
    }
    i += 1;
  }
  return out;
}

function WorkedForDivider({ label }: { label: string }) {
  return (
    <div className="process-divider" aria-label={label}>
      <span className="process-divider-label">{label}</span>
      <span className="process-divider-line" aria-hidden="true" />
    </div>
  );
}

function blockHasContent(block: AssistantBlock): boolean {
  if (block.type === "text" || block.type === "thought") return block.text.length > 0;
  return true;
}

function findLastTextIndex(blocks: AssistantBlock[]): number {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b?.type === "text" && b.text.length > 0) return i;
  }
  return -1;
}

/** Codex-style duration summary for the outer L1 fold. */
export function workedForLabel(
  createdAt: number,
  finishedAt: number | undefined,
  t: TFunction<"translation">,
): string {
  if (finishedAt == null || finishedAt < createdAt) {
    return t("tools.worked");
  }
  const ms = Math.max(0, finishedAt - createdAt);
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 1) {
    return t("tools.workedFor", {
      duration: t("tools.lessThanOneSecond"),
    });
  }
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const duration =
    m <= 0
      ? t("tools.seconds", { value: s })
      : s === 0
        ? t("tools.minutes", { value: m })
        : t("tools.minutesSeconds", { minutes: m, seconds: s });
  return t("tools.workedFor", { duration });
}
