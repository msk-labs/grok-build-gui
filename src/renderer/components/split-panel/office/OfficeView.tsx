import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { OfficeDocument } from "../../../../electron/office/types";
import { DocView } from "./DocView";
import { SheetView } from "./SheetView";
import { SlidesView } from "./SlidesView";
import { officeKindForPath } from "./officeKind";

type Props = {
  /** Workspace root the path is resolved against. */
  root: string;
  path: string;
};

/**
 * Loads an Office file through the main-process parser and mounts the viewer
 * for its kind. Also the fallback surface for formats we cannot parse
 * (legacy .doc/.ppt), where the only useful action is handing the file to the OS.
 */
export function OfficeView({ root, path }: Props) {
  const { t } = useTranslation();
  const kind = officeKindForPath(path);
  const [sheet, setSheet] = useState<string | undefined>(undefined);
  const [doc, setDoc] = useState<OfficeDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Selecting a different file must not carry the previous sheet choice over.
  useEffect(() => {
    setSheet(undefined);
  }, [root, path]);

  useEffect(() => {
    if (!kind) return;
    if (!root || !window.grok?.readOfficeDoc) {
      setError(t("files.workspaceUnavailableLoad"));
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void window.grok
      .readOfficeDoc({ root, path, sheet })
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          setDoc(null);
          setError(res.error);
          return;
        }
        setDoc(res.doc);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setDoc(null);
          setError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, root, path, sheet, t]);

  const openExternally = useCallback(() => {
    void window.grok?.openWith?.({ root, path });
  }, [root, path]);

  const saveRows = useCallback(
    async (rows: string[][]) => {
      if (!window.grok?.writeSheet || !doc || doc.kind !== "sheet") return;
      setSaving(true);
      setError(null);
      try {
        const res = await window.grok.writeSheet({
          root,
          path,
          sheet: doc.sheet,
          rows,
        });
        if (!res.ok) setError(res.error);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setSaving(false);
      }
    },
    [doc, root, path],
  );

  return (
    <div className="office-view">
      <div className="office-bar">
        <span className="office-bar-kind">
          {t(kind ? `office.kind.${kind}` : "office.kind.unsupported")}
        </span>
        {doc?.kind === "sheet" && doc.truncated ? (
          <span className="office-bar-note">{t("office.truncated")}</span>
        ) : null}
        <span className="office-subbar-spacer" />
        <button type="button" className="office-btn" onClick={openExternally}>
          {t("office.openExternally")}
        </button>
      </div>

      {error ? <div className="office-error">{error}</div> : null}

      {!kind ? (
        <div className="office-empty">{t("office.unsupportedHint")}</div>
      ) : loading && !doc ? (
        <div className="office-empty">{t("common.loading")}</div>
      ) : doc?.kind === "sheet" ? (
        <SheetView
          doc={doc}
          onSelectSheet={setSheet}
          onSave={saveRows}
          saving={saving}
        />
      ) : doc?.kind === "doc" ? (
        <DocView doc={doc} />
      ) : doc?.kind === "slides" ? (
        <SlidesView doc={doc} />
      ) : !error ? (
        <div className="office-empty">{t("tools.noContent")}</div>
      ) : null}
    </div>
  );
}
