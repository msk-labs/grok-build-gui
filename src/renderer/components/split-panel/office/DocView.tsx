import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DocDocument } from "../../../../electron/office/types";
import { base64ToBlob } from "./bytes";

type Props = { doc: DocDocument };

/**
 * Word preview with real layout.
 *
 * `docx-preview` reproduces the document the way Word paginates it — page size
 * and margins, paragraph and run styles, table borders and shading, numbering,
 * inline images — by writing into a container element and emitting matching
 * CSS. That needs a live DOM, which is why the bytes come over IPC and the
 * rendering happens here rather than in the main process.
 */
export function DocView({ doc }: Props) {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const container = host.current;
    if (!container) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    container.replaceChildren();

    void (async () => {
      try {
        const { renderAsync } = await import("docx-preview");
        const blob = base64ToBlob(
          doc.base64,
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        );
        if (cancelled) return;
        await renderAsync(blob, container, undefined, {
          className: "docx",
          inWrapper: true,
          // Keep the document's own page geometry — that is the whole point.
          ignoreWidth: false,
          ignoreHeight: false,
          breakPages: true,
          experimental: true,
          useBase64URL: true,
        });
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [doc.base64]);

  return (
    <div className="office-doc">
      {loading ? (
        <div className="office-empty">{t("common.loading")}</div>
      ) : null}
      {error ? <div className="office-error">{error}</div> : null}
      <div className="office-doc-host" ref={host} />
    </div>
  );
}
