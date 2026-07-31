import type { ToolCallItem } from "../../types/chat";
import { toolEditStats } from "../../lib/fileChanges";
import { toolImages } from "../../lib/toolImages";
import type { OpenFileViewRequest } from "./FileChangeBar";
import { HighlightText } from "./HighlightText";
import { ProcessFold } from "./ProcessFold";
import { ToolResultImages } from "./ToolResultImages";
import { ToolDetails } from "./tools/ToolDetails";
import { useTranslation } from "react-i18next";
import {
  activityGroupLabel,
  isToolActive,
  statusLabel,
  toolSummaryLabel,
} from "./toolActivitySummary";

/** Ordered process steps inside one semantic activity group. */
export type ActivityGroupItem =
  | { type: "tool"; tool: ToolCallItem }
  | {
      type: "thought";
      id: string;
      text: string;
      /** True while this is the live tip of a streaming turn. */
      live?: boolean;
      /** Open only when search navigation targets this thought. */
      searchHit?: boolean;
    };

export function isToolDone(status: string): boolean {
  return !isToolActive(status);
}

type ToolFoldProps = {
  tool: ToolCallItem;
  onOpenFile?: (req: OpenFileViewRequest) => void;
};

/**
 * Auto-collapsed tool step. Expand to inspect paths, text output, and diffs.
 * Edit tools show +N/−M on the summary (Codex-style).
 * Always starts collapsed — never auto-opens while running.
 */
export function ToolFold({ tool, onOpenFile }: ToolFoldProps) {
  const { t } = useTranslation();
  const active = isToolActive(tool.status);
  const stats = toolEditStats(tool);

  return (
    <ProcessFold
      label={
        <span className="tool-summary">
          <span className="tool-summary-title">
            {toolSummaryLabel(tool, t)}
          </span>
          {stats && (stats.added > 0 || stats.removed > 0) ? (
            <span className="tool-summary-stats" aria-hidden>
              {stats.added > 0 ? (
                <span className="file-change-add">+{stats.added}</span>
              ) : null}
              {stats.removed > 0 ? (
                <span className="file-change-del">−{stats.removed}</span>
              ) : null}
            </span>
          ) : null}
        </span>
      }
      live={active}
      className="process-fold-l2"
      defaultOpen={false}
    >
      <div className="process-done-body tool-detail">
        <div className="tool-row">
          <span className={`tool-status ${tool.status}`}>
            {statusLabel(tool.status, t)}
          </span>
          {tool.kind ? <span className="tool-kind">{tool.kind}</span> : null}
          <span className="tool-title">
            {toolSummaryLabel(tool, t)}
          </span>
        </div>

        <ToolDetails tool={tool} onOpenFile={onOpenFile} />

        {!tool.locations?.length && !tool.content?.length && !tool.contentPreview ? (
          <div className="tool-empty-detail">
            {t("tools.noExtraDetail")}
          </div>
        ) : null}
      </div>
    </ProcessFold>
  );
}

/**
 * Semantic activity group for a consecutive process run (tools + thoughts).
 * Summary describes tool categories only; expand for L2 thought/tool folds.
 * Group, tools, and thoughts all stay collapsed by default. Only search
 * navigation opens the matching thought (and its parent group).
 */
export function ToolActivityGroup({
  items,
  onOpenFile,
  highlightQuery,
}: {
  items: ActivityGroupItem[];
  onOpenFile?: (req: OpenFileViewRequest) => void;
  highlightQuery?: string | null;
}) {
  const { t } = useTranslation();
  const tools = items
    .filter((item): item is Extract<ActivityGroupItem, { type: "tool" }> =>
      item.type === "tool",
    )
    .map((item) => item.tool);
  const anyToolActive = tools.some((tool) => isToolActive(tool.status));
  const liveThought = items.some(
    (item) => item.type === "thought" && item.live,
  );
  const anyActive = anyToolActive || liveThought;
  const searchOpen = items.some(
    (item) => item.type === "thought" && item.searchHit,
  );

  // Surface generated images outside the collapsed group so they stay visible.
  const resultImages = tools.flatMap((tool) => toolImages(tool));

  return (
    <>
      <ProcessFold
        label={activityGroupLabel(tools, t, { liveThought })}
        live={anyActive}
        className="process-fold-tool-group"
        defaultOpen={false}
        openWhen={searchOpen}
      >
        <div className="tool-group-body tool-list">
          {items.map((item) => {
            if (item.type === "tool") {
              return (
                <ToolFold
                  key={item.tool.id}
                  tool={item.tool}
                  onOpenFile={onOpenFile}
                />
              );
            }
            if (!item.text) return null;
            // Thoughts default collapsed; only search navigation opens them.
            return (
              <ProcessFold
                key={item.id}
                label={
                  item.live ? t("tools.thinking") : t("tools.thought")
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
                      query={highlightQuery}
                    />
                  </div>
                </div>
              </ProcessFold>
            );
          })}
        </div>
      </ProcessFold>
      <ToolResultImages images={resultImages} />
    </>
  );
}
