import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { basename } from "../../../lib/lineDiff";
import { FileTree } from "./FileTree";
import { PanelSideIcon, RefreshIcon } from "./fileIcons";
import { OfficeView } from "../office/OfficeView";
import {
  isLegacyOfficeBinary,
  officeKindForPath,
} from "../office/officeKind";
import type { FilePreview } from "./types";
import { useTranslation } from "react-i18next";

type Props = {
  /** Workspace root for listing / reading (session or app cwd). */
  workspaceRoot?: string;
};

const TREE_MIN = 140;
const TREE_MAX = 480;
const TREE_DEFAULT = 220;

function folderLabel(root: string): string {
  const parts = root.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || root;
}

/**
 * Codex-style Files panel: collapsible tree (left) + text preview (right).
 * Opened from the split + menu / home as the `files` tool tab.
 */
export function FilesPane({ workspaceRoot }: Props) {
  const { t } = useTranslation();
  const root = workspaceRoot?.trim() || "";
  const [treeOpen, setTreeOpen] = useState(true);
  const [treeWidth, setTreeWidth] = useState(TREE_DEFAULT);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  // Reset selection when workspace changes.
  useEffect(() => {
    setSelectedPath(null);
    setPreview(null);
    setPreviewError(null);
    setRefreshKey((n) => n + 1);
  }, [root]);

  const loadPreview = useCallback(
    async (filePath: string) => {
      // Office files are read by their own parser inside OfficeView.
      if (officeKindForPath(filePath) || isLegacyOfficeBinary(filePath)) {
        setPreview(null);
        setPreviewError(null);
        setPreviewLoading(false);
        return;
      }
      if (!root || !window.grok?.readTextFile) {
        setPreviewError(t("files.workspaceUnavailable"));
        setPreview(null);
        return;
      }
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        const res = await window.grok.readTextFile({
          root,
          path: filePath,
        });
        if (!res.ok) {
          setPreview(null);
          setPreviewError(res.error);
          return;
        }
        setPreview({
          path: res.path,
          text: res.text,
          truncated: res.truncated,
          binary: res.binary,
          size: res.size,
        });
      } catch (e) {
        setPreview(null);
        setPreviewError(e instanceof Error ? e.message : String(e));
      } finally {
        setPreviewLoading(false);
      }
    },
    [root, t],
  );

  const onSelectFile = useCallback(
    (path: string) => {
      setSelectedPath(path);
      void loadPreview(path);
    },
    [loadPreview],
  );

  const onResizeStart = (e: ReactMouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startW: treeWidth };
    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const next = Math.max(
        TREE_MIN,
        Math.min(TREE_MAX, d.startW + (ev.clientX - d.startX)),
      );
      setTreeWidth(next);
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  if (!root) {
    return (
      <div
        className="files-pane files-pane-empty"
        aria-label={t("files.label")}
      >
        <p className="files-pane-empty-msg">
          {t("files.noWorkspace")}
        </p>
      </div>
    );
  }

  const title = selectedPath ? basename(selectedPath) : null;
  const isOffice = selectedPath
    ? officeKindForPath(selectedPath) !== null ||
      isLegacyOfficeBinary(selectedPath)
    : false;

  return (
    <div className="files-pane" aria-label={t("files.label")}>
      <div className="files-pane-toolbar">
        <button
          type="button"
          className="files-pane-tool-btn"
          onClick={() => setTreeOpen((v) => !v)}
          title={treeOpen ? t("files.hideTree") : t("files.showTree")}
          aria-label={treeOpen ? t("files.hideTree") : t("files.showTree")}
          aria-pressed={treeOpen}
        >
          <PanelSideIcon side={treeOpen ? "left" : "right"} />
        </button>
        <div className="files-pane-toolbar-title" title={root}>
          {folderLabel(root)}
        </div>
        <button
          type="button"
          className="files-pane-tool-btn"
          onClick={() => {
            setRefreshKey((n) => n + 1);
            if (selectedPath) void loadPreview(selectedPath);
          }}
          title={t("common.refresh")}
          aria-label={t("files.refreshTree")}
        >
          <RefreshIcon />
        </button>
      </div>

      <div className="files-pane-body">
        {treeOpen ? (
          <>
            <div
              className="files-pane-tree-col"
              style={{ width: treeWidth }}
            >
              <FileTree
                root={root}
                selectedPath={selectedPath}
                onSelectFile={onSelectFile}
                refreshKey={refreshKey}
              />
            </div>
            <div
              className="files-pane-split-resizer"
              onMouseDown={onResizeStart}
              role="separator"
              aria-orientation="vertical"
              aria-label={t("files.resizeTree")}
            />
          </>
        ) : null}

        <div className="files-pane-preview-col">
          {!selectedPath ? (
            <div className="files-pane-preview-empty">
              {t("files.selectPreview")}
            </div>
          ) : isOffice ? (
            <OfficeView
              key={`${selectedPath}:${refreshKey}`}
              root={root}
              path={selectedPath}
            />
          ) : previewLoading ? (
            <div className="files-pane-preview-empty">
              {t("common.loading")}
            </div>
          ) : previewError ? (
            <div className="files-pane-preview-error">{previewError}</div>
          ) : preview?.binary ? (
            <div className="files-pane-preview-empty">
              {t("files.binaryNoPreview")}
              {preview.size > 0
                ? ` · ${formatBytes(preview.size)}`
                : ""}
            </div>
          ) : preview ? (
            <>
              <div className="files-pane-preview-header">
                <span className="files-pane-preview-name" title={preview.path}>
                  {title}
                </span>
                <span className="files-pane-preview-meta">
                  {formatBytes(preview.size)}
                  {preview.truncated ? ` · ${t("files.truncated")}` : ""}
                </span>
              </div>
              <div className="files-pane-preview-scroll">
                <pre className="files-pane-preview-content">
                  {preview.text || " "}
                </pre>
              </div>
            </>
          ) : (
            <div className="files-pane-preview-empty">
              {t("tools.noContent")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
