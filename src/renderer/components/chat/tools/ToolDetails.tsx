import { useTranslation } from "react-i18next";
import type { ToolCallItem, ToolDiff, ToolVideoContent } from "../../../types/chat";
import { basename } from "../../../lib/lineDiff";
import {
  classifyTool,
  toolDiffs,
  toolTextOutputs,
} from "../../../lib/toolPresentation";
import { toolEditStats } from "../../../lib/fileChanges";
import { toolImages, toolVideos } from "../../../lib/toolImages";
import type { OpenFileViewRequest } from "../FileChangeBar";
import { ToolResultImages } from "../ToolResultImages";
import "./tools.css";

export function ToolDetails({
  tool,
  onOpenFile,
}: {
  tool: ToolCallItem;
  onOpenFile?: (request: OpenFileViewRequest) => void;
}) {
  const kind = classifyTool(tool);
  const outputs = toolTextOutputs(tool);
  const diffs = toolDiffs(tool);
  const images = toolImages(tool);
  const videos = toolVideos(tool);

  return (
    <div className={`tool-presentation tool-presentation-${kind}`}>
      {kind === "media" ? (
        <>
          <ToolResultImages images={images} />
          <ToolResultVideos videos={videos} />
        </>
      ) : null}
      {kind === "edit" ? (
        <DiffList diffs={diffs} tool={tool} onOpenFile={onOpenFile} />
      ) : (
        <LocationList tool={tool} onOpenFile={onOpenFile} />
      )}
      <OutputList outputs={outputs} kind={kind} />
    </div>
  );
}

function LocationList({
  tool,
  onOpenFile,
}: {
  tool: ToolCallItem;
  onOpenFile?: (request: OpenFileViewRequest) => void;
}) {
  return (
    <>
      {(tool.locations ?? []).map((location, index) => {
        if (!location.path) return null;
        const path = location.path;
        return (
          <button
            key={`${path}-${index}`}
            type="button"
            className="tool-path-btn"
            title={path}
            onClick={() => onOpenFile?.({ path, mode: "content" })}
          >
            <span>{path}</span>
            {location.line != null ? (
              <span className="tool-location-line">:{location.line}</span>
            ) : null}
          </button>
        );
      })}
    </>
  );
}

function DiffList({
  diffs,
  tool,
  onOpenFile,
}: {
  diffs: ToolDiff[];
  tool: ToolCallItem;
  onOpenFile?: (request: OpenFileViewRequest) => void;
}) {
  const { t } = useTranslation();
  if (diffs.length === 0) {
    return <LocationList tool={tool} onOpenFile={onOpenFile} />;
  }

  return (
    <>
      {diffs.map((diff) => {
        const created = diff.oldText == null || diff.oldText === "";
        const stats = toolEditStats({ ...tool, content: [diff] });
        return (
          <button
            key={diff.path}
            type="button"
            className="tool-diff-chip"
            onClick={() =>
              onOpenFile?.({
                path: diff.path,
                mode: created ? "content" : "diff",
                oldText: diff.oldText,
                newText: diff.newText,
              })
            }
          >
            <span className="tool-diff-chip-name">{basename(diff.path)}</span>
            {created ? (
              <span className="file-change-tag">{t("tools.newTag")}</span>
            ) : stats ? (
              <span className="file-change-stats">
                <span className="file-change-add">+{stats.added}</span>
                <span className="file-change-del">−{stats.removed}</span>
              </span>
            ) : null}
            <span className="tool-diff-chip-hint">
              {created ? t("tools.openFile") : t("tools.openDiff")}
            </span>
          </button>
        );
      })}
    </>
  );
}

function OutputList({
  outputs,
  kind,
}: {
  outputs: string[];
  kind: ReturnType<typeof classifyTool>;
}) {
  return (
    <>
      {outputs.map((output, index) => (
        <pre key={index} className={`tool-preview tool-preview-${kind}`}>
          {output.length > 4000 ? `${output.slice(0, 4000)}…` : output}
        </pre>
      ))}
    </>
  );
}

function ToolResultVideos({ videos }: { videos: ToolVideoContent[] }) {
  if (videos.length === 0) return null;
  return (
    <div className="tool-result-videos">
      {videos.map((video, index) =>
        video.uploadedUrl ? (
          <video
            key={video.uploadedUrl}
            className="tool-result-video"
            src={video.uploadedUrl}
            controls
            preload="metadata"
          />
        ) : (
          <div
            key={video.path || index}
            className="tool-result-video-missing"
            title={video.path}
          >
            {video.filename || video.path}
          </div>
        ),
      )}
    </div>
  );
}
