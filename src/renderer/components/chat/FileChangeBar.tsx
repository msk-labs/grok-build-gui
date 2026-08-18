import type { FileChange } from "../../lib/fileChanges";
import { extensionOf, useFileIcons } from "./useFileIcons";
import { useTranslation } from "react-i18next";

export type OpenFileViewRequest = {
  path: string;
  /** Session workspace that authorized this path. Captured when opened. */
  root?: string;
  /** diff: show +/−; content: full new file body (no git markers). */
  mode: "diff" | "content";
  oldText?: string | null;
  newText?: string;
};

type Props = {
  changes: FileChange[];
  onOpen: (req: OpenFileViewRequest) => void;
  /** Workspace root — used for relative path display. */
  workspaceRoot?: string;
};

function StatsBadge({ added, removed }: { added: number; removed: number }) {
  if (added === 0 && removed === 0) return null;
  return (
    <span className="file-change-stats">
      {added > 0 ? <span className="file-change-add">+{added}</span> : null}
      {removed > 0 ? (
        <span className="file-change-del">-{removed}</span>
      ) : null}
    </span>
  );
}

/** Minimal file glyph (Codex-like). */
function FileIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
    >
      <path
        d="M3.5 1.5h6.086L13.5 5.414V14.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M9.5 1.5V5.5H13.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function displayPath(path: string, root?: string): string {
  if (!root) return path.replace(/\\/g, "/");
  const normRoot = root.replace(/\\/g, "/").replace(/\/+$/, "");
  const normPath = path.replace(/\\/g, "/");
  if (normPath === normRoot) return path;
  if (normPath.startsWith(normRoot + "/")) {
    return normPath.slice(normRoot.length + 1);
  }
  return normPath;
}

/** Split `src/foo/Bar.tsx` → dir `src/foo/` + name `Bar.tsx` (Codex layout). */
function splitRelPath(rel: string): { dir: string; name: string } {
  const norm = rel.replace(/\\/g, "/");
  const i = norm.lastIndexOf("/");
  if (i < 0) return { dir: "", name: norm };
  return { dir: norm.slice(0, i + 1), name: norm.slice(i + 1) };
}

/**
 * Codex-style vertical file list under an assistant turn.
 * One full-width row per file; click opens the right split.
 */
export function FileChangeBar({ changes, onOpen, workspaceRoot }: Props) {
  const { t } = useTranslation();
  // Hooks must run before the early return below.
  const icons = useFileIcons(
    changes.map((c) => c.path),
    workspaceRoot,
  );
  if (changes.length === 0) return null;

  return (
    <div className="file-change-bar" aria-label={t("files.changed")}>
      <ul className="file-change-list">
        {changes.map((c) => {
          const isCreate = c.kind === "create";
          const mode: "diff" | "content" =
            isCreate || c.pathOnly || !c.newText ? "content" : "diff";
          const rel = displayPath(c.path, workspaceRoot);
          const { dir, name } = splitRelPath(rel);
          const icon = icons.get(extensionOf(c.path));

          return (
            <li key={c.path}>
              <button
                type="button"
                className="file-change-row"
                title={c.path}
                onClick={() => {
                  onOpen({
                    path: c.path,
                    mode,
                    oldText: c.oldText,
                    newText: c.newText,
                  });
                }}
              >
                <span className="file-change-icon" aria-hidden>
                  {icon ? (
                    <img className="file-change-icon-img" src={icon} alt="" />
                  ) : (
                    <FileIcon />
                  )}
                </span>
                <span className="file-change-path">
                  {dir ? (
                    <span className="file-change-dir">{dir}</span>
                  ) : null}
                  <span className="file-change-name">{name}</span>
                </span>
                {isCreate ? (
                  <span className="file-change-tag">{t("tools.newTag")}</span>
                ) : (
                  <StatsBadge
                    added={c.stats.added}
                    removed={c.stats.removed}
                  />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
