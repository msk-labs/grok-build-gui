import { useEffect, useState } from "react";
import { DiffLines } from "../chat/DiffLines";
import { basename } from "../../lib/lineDiff";
import { OfficeView } from "./office/OfficeView";
import {
  isLegacyOfficeBinary,
  officeKindForPath,
} from "./office/officeKind";
import type { FileViewPayload } from "./types";
import { useTranslation } from "react-i18next";

type Props = {
  view: FileViewPayload;
  /** Workspace root for path-only fallback reads. */
  workspaceRoot?: string;
};

/**
 * Right-panel file viewer:
 * - mode "diff": git-style +/− lines from ACP oldText/newText
 * - mode "content": full file body (new files / path-only open)
 */
export function FileViewPane({ view, workspaceRoot }: Props) {
  const { t } = useTranslation();
  const [diskText, setDiskText] = useState<string | null>(null);
  const [diskError, setDiskError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // A file tab belongs to the session that opened it. Keep that root stable
  // even if another chat becomes active before the preview request runs.
  const fileRoot = view.root?.trim() || workspaceRoot?.trim() || "";

  // Office files are binary containers, so they bypass the text read entirely
  // and go straight to the dedicated viewers.
  const isOffice =
    view.mode === "content" &&
    Boolean(view.path) &&
    (officeKindForPath(view.path) !== null || isLegacyOfficeBinary(view.path));

  const needsDisk =
    view.mode === "content" &&
    !isOffice &&
    (view.newText == null || view.newText === "") &&
    Boolean(view.path);

  useEffect(() => {
    if (!needsDisk) {
      setDiskText(null);
      setDiskError(null);
      return;
    }
    const root = fileRoot;
    if (!root || !window.grok?.readTextFile) {
      setDiskError(t("files.workspaceUnavailableLoad"));
      return;
    }
    let cancelled = false;
    setLoading(true);
    setDiskError(null);
    void window.grok
      .readTextFile({ root, path: view.path })
      .then((res) => {
        if (cancelled) return;
        if (!res || res.ok === false) {
          setDiskError(
            res && "error" in res ? res.error : t("files.failedRead"),
          );
          setDiskText(null);
          return;
        }
        if (res.binary) {
          setDiskError(t("files.binaryNoPreview"));
          setDiskText(null);
          return;
        }
        setDiskText(
          res.text + (res.truncated ? `\n… (${t("files.truncated")})` : ""),
        );
      })
      .catch((e) => {
        if (!cancelled) {
          setDiskError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fileRoot, needsDisk, view.path, t]);

  const title = basename(view.path) || view.path;
  const isDiff = view.mode === "diff";
  const bodyText =
    view.newText != null && view.newText !== ""
      ? view.newText
      : diskText;

  return (
    <div
      className="file-view-pane"
      aria-label={isDiff ? t("files.diff") : t("tools.file")}
    >
      <div className="file-view-header">
        <div className="file-view-title" title={view.path}>
          {title}
        </div>
        <div className="file-view-path" title={view.path}>
          {view.path}
        </div>
        <div className="file-view-mode">
          {isDiff ? t("files.diff") : t("tools.file")}
        </div>
      </div>
      <div className="file-view-body">
        {isDiff ? (
          <DiffLines oldText={view.oldText} newText={view.newText ?? ""} />
        ) : isOffice ? (
          <OfficeView root={fileRoot} path={view.path} />
        ) : loading ? (
          <div className="file-view-empty">{t("common.loading")}</div>
        ) : diskError ? (
          <div className="file-view-error">{diskError}</div>
        ) : bodyText != null ? (
          <pre className="file-view-content">{bodyText || " "}</pre>
        ) : (
          <div className="file-view-empty">{t("tools.noContent")}</div>
        )}
      </div>
    </div>
  );
}
