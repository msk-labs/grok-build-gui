import {
  useCallback,
  useEffect,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { ChevronTreeIcon, FileTreeIcon, FolderTreeIcon } from "./fileIcons";
import {
  FileTreeContextMenu,
  type FileTreeCtxTarget,
} from "./FileTreeContextMenu";
import type { FsEntry } from "./types";
import { useTranslation } from "react-i18next";

type Props = {
  root: string;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  /** Bump to force a full reload of the tree. */
  refreshKey: number;
};

type ChildrenMap = Record<string, FsEntry[] | "loading" | "error">;

function pathKey(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Lazy-loaded workspace tree. Directories expand on click; files select for preview.
 * Right-click opens a Codex-style context menu.
 */
export function FileTree({
  root,
  selectedPath,
  onSelectFile,
  refreshKey,
}: Props) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [children, setChildren] = useState<ChildrenMap>({});
  const [rootError, setRootError] = useState<string | null>(null);
  const [ctx, setCtx] = useState<FileTreeCtxTarget | null>(null);

  const loadDir = useCallback(
    async (dirPath: string) => {
      if (!window.grok?.listDir) {
        setChildren((prev) => ({ ...prev, [dirPath]: "error" }));
        return;
      }
      setChildren((prev) => ({ ...prev, [dirPath]: "loading" }));
      const res = await window.grok.listDir({ root, path: dirPath });
      if (!res.ok) {
        setChildren((prev) => ({ ...prev, [dirPath]: "error" }));
        if (pathKey(dirPath) === pathKey(root)) setRootError(res.error);
        return;
      }
      if (pathKey(dirPath) === pathKey(root)) setRootError(null);
      setChildren((prev) => ({ ...prev, [dirPath]: res.entries }));
    },
    [root],
  );

  // Initial root load + refresh.
  useEffect(() => {
    setExpanded({});
    setChildren({});
    setRootError(null);
    setCtx(null);
    void loadDir(root);
    setExpanded({ [root]: true });
  }, [root, refreshKey, loadDir]);

  const toggleDir = useCallback(
    (dirPath: string) => {
      setExpanded((prev) => {
        const nextOpen = !prev[dirPath];
        if (nextOpen && children[dirPath] == null) {
          void loadDir(dirPath);
        }
        return { ...prev, [dirPath]: nextOpen };
      });
    },
    [children, loadDir],
  );

  const expandDir = useCallback(
    (dirPath: string) => {
      setExpanded((prev) => {
        if (prev[dirPath]) return prev;
        if (children[dirPath] == null) void loadDir(dirPath);
        return { ...prev, [dirPath]: true };
      });
    },
    [children, loadDir],
  );

  const openCtx = useCallback((entry: FsEntry, e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setCtx({ entry, x: e.clientX, y: e.clientY });
  }, []);

  const onCtxOpen = useCallback(
    (entry: FsEntry) => {
      if (entry.kind === "file") {
        onSelectFile(entry.path);
      } else {
        expandDir(entry.path);
      }
    },
    [expandDir, onSelectFile],
  );

  const rootEntries = children[root];

  if (rootError) {
    return <div className="files-tree-status">{rootError}</div>;
  }
  if (rootEntries === "loading" || rootEntries == null) {
    return <div className="files-tree-status">{t("common.loading")}</div>;
  }
  if (rootEntries === "error") {
    return <div className="files-tree-status">{t("files.couldNotList")}</div>;
  }
  if (rootEntries.length === 0) {
    return <div className="files-tree-status">{t("files.emptyFolder")}</div>;
  }

  return (
    <div
      className="files-tree"
      role="tree"
      aria-label={t("files.workspaceFiles")}
    >
      {rootEntries.map((entry) => (
        <TreeNode
          key={entry.path}
          entry={entry}
          depth={0}
          expanded={expanded}
          childrenMap={children}
          selectedPath={selectedPath}
          onToggleDir={toggleDir}
          onSelectFile={onSelectFile}
          onContextMenu={openCtx}
          loadingLabel={t("common.loading")}
          failedLabel={t("files.failedLoad")}
          emptyLabel={t("files.empty")}
        />
      ))}
      {ctx ? (
        <FileTreeContextMenu
          target={ctx}
          workspaceRoot={root}
          onClose={() => setCtx(null)}
          onOpen={onCtxOpen}
        />
      ) : null}
    </div>
  );
}

type NodeProps = {
  entry: FsEntry;
  depth: number;
  expanded: Record<string, boolean>;
  childrenMap: ChildrenMap;
  selectedPath: string | null;
  onToggleDir: (path: string) => void;
  onSelectFile: (path: string) => void;
  onContextMenu: (entry: FsEntry, e: ReactMouseEvent) => void;
  loadingLabel: string;
  failedLabel: string;
  emptyLabel: string;
};

function TreeNode({
  entry,
  depth,
  expanded,
  childrenMap,
  selectedPath,
  onToggleDir,
  onSelectFile,
  onContextMenu,
  loadingLabel,
  failedLabel,
  emptyLabel,
}: NodeProps) {
  const isDir = entry.kind === "dir";
  const open = Boolean(expanded[entry.path]);
  const selected =
    selectedPath != null && pathKey(selectedPath) === pathKey(entry.path);
  const kids = childrenMap[entry.path];

  return (
    <div className="files-tree-node">
      <button
        type="button"
        className={
          selected
            ? "files-tree-row files-tree-row-selected"
            : "files-tree-row"
        }
        style={{ paddingLeft: 8 + depth * 12 }}
        role="treeitem"
        aria-expanded={isDir ? open : undefined}
        aria-selected={selected}
        title={entry.path}
        onClick={() => {
          if (isDir) onToggleDir(entry.path);
          else onSelectFile(entry.path);
        }}
        onContextMenu={(e) => onContextMenu(entry, e)}
      >
        <span className="files-tree-chevron" aria-hidden>
          {isDir ? (
            <ChevronTreeIcon open={open} />
          ) : (
            <span className="files-tree-chevron-spacer" />
          )}
        </span>
        <span className="files-tree-kind-icon" aria-hidden>
          {isDir ? <FolderTreeIcon open={open} /> : <FileTreeIcon />}
        </span>
        <span className="files-tree-name">{entry.name}</span>
      </button>
      {isDir && open ? (
        <div className="files-tree-children" role="group">
          {kids === "loading" || kids == null ? (
            <div
              className="files-tree-status files-tree-status-nested"
              style={{ paddingLeft: 20 + (depth + 1) * 12 }}
            >
              {loadingLabel}
            </div>
          ) : kids === "error" ? (
            <div
              className="files-tree-status files-tree-status-nested"
              style={{ paddingLeft: 20 + (depth + 1) * 12 }}
            >
              {failedLabel}
            </div>
          ) : kids.length === 0 ? (
            <div
              className="files-tree-status files-tree-status-nested"
              style={{ paddingLeft: 20 + (depth + 1) * 12 }}
            >
              {emptyLabel}
            </div>
          ) : (
            kids.map((child) => (
              <TreeNode
                key={child.path}
                entry={child}
                depth={depth + 1}
                expanded={expanded}
                childrenMap={childrenMap}
                selectedPath={selectedPath}
                onToggleDir={onToggleDir}
                onSelectFile={onSelectFile}
                onContextMenu={onContextMenu}
                loadingLabel={loadingLabel}
                failedLabel={failedLabel}
                emptyLabel={emptyLabel}
              />
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
