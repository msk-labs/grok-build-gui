import type { DiffLine } from "../../lib/lineDiff";
import { lineDiff } from "../../lib/lineDiff";
import { useTranslation } from "react-i18next";

type Props = {
  oldText?: string | null;
  newText?: string;
  /** Precomputed lines (optional). */
  lines?: DiffLine[];
  className?: string;
};

/**
 * Git-style red/green line markers for an ACP file diff.
 */
export function DiffLines({ oldText, newText, lines, className }: Props) {
  const { t } = useTranslation();
  const rows =
    lines ??
    lineDiff(oldText ?? "", newText ?? "");

  if (rows.length === 0) {
    return (
      <div className={["diff-lines", "diff-lines-empty", className].filter(Boolean).join(" ")}>
        ({t("files.empty")})
      </div>
    );
  }

  return (
    <div
      className={["diff-lines", className].filter(Boolean).join(" ")}
      role="table"
      aria-label={t("files.diff")}
    >
      {rows.map((row, i) => {
        if (row.type === "same") {
          return (
            <div key={i} className="diff-line diff-line-same" role="row">
              <span className="diff-gutter" aria-hidden>
                {row.oldNo}
              </span>
              <span className="diff-gutter" aria-hidden>
                {row.newNo}
              </span>
              <span className="diff-mark" aria-hidden>
                {" "}
              </span>
              <span className="diff-text">{row.text || " "}</span>
            </div>
          );
        }
        if (row.type === "add") {
          return (
            <div key={i} className="diff-line diff-line-add" role="row">
              <span className="diff-gutter" aria-hidden />
              <span className="diff-gutter" aria-hidden>
                {row.newNo}
              </span>
              <span className="diff-mark" aria-hidden>
                +
              </span>
              <span className="diff-text">{row.text || " "}</span>
            </div>
          );
        }
        return (
          <div key={i} className="diff-line diff-line-del" role="row">
            <span className="diff-gutter" aria-hidden>
              {row.oldNo}
            </span>
            <span className="diff-gutter" aria-hidden />
            <span className="diff-mark" aria-hidden>
              −
            </span>
            <span className="diff-text">{row.text || " "}</span>
          </div>
        );
      })}
    </div>
  );
}
