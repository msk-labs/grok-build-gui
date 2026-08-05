import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SheetDocument } from "../../../../electron/office/types";
import { buildMergeMap, cellCss, frozenOffsets, key } from "./sheetCss";

type Props = {
  doc: SheetDocument;
  /** Switch the workbook sheet; the parent re-fetches. */
  onSelectSheet: (sheet: string) => void;
  onSave: (rows: string[][]) => Promise<void>;
  saving: boolean;
};

/** Rows rendered before the user asks for more; keeps the cell count sane. */
const PAGE = 100;
const PAGE_STEP = 200;

/** Spreadsheet column label: 0 → A, 26 → AA. */
function columnLabel(index: number): string {
  let label = "";
  for (let n = index; n >= 0; n = Math.floor(n / 26) - 1) {
    label = String.fromCharCode(65 + (n % 26)) + label;
  }
  return label;
}

function toText(doc: SheetDocument): string[][] {
  return doc.rows.map((row) => row.map((cell) => cell.v));
}

/**
 * Spreadsheet grid with the workbook's own formatting: fills, fonts, borders,
 * merges, column widths, and frozen panes.
 *
 * Only the focused cell mounts an `<input>` — every other cell stays a styled
 * text node, which is what keeps a wide sheet responsive.
 */
export function SheetView({ doc, onSelectSheet, onSave, saving }: Props) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<string[][]>(() => toText(doc));
  const [baseRows, setBaseRows] = useState<string[][]>(() => toText(doc));
  const [editing, setEditing] = useState<{ r: number; c: number } | null>(null);
  const [limit, setLimit] = useState(PAGE);

  // A new sheet (or a reload) resets the draft.
  useEffect(() => {
    setRows(toText(doc));
    setBaseRows(toText(doc));
    setEditing(null);
    setLimit(PAGE);
  }, [doc]);

  const dirty = useMemo(
    () => JSON.stringify(rows) !== JSON.stringify(baseRows),
    [rows, baseRows],
  );
  const merge = useMemo(() => buildMergeMap(doc.merges), [doc.merges]);
  const stickyLeft = useMemo(
    () => frozenOffsets(doc.columnWidths, doc.frozen.cols),
    [doc.columnWidths, doc.frozen.cols],
  );

  const columns = rows[0]?.length ?? 0;
  const visible = rows.slice(0, limit);

  const updateCell = (r: number, c: number, value: string) => {
    setRows((current) => {
      const next = current.map((row) => [...row]);
      next[r]![c] = value;
      return next;
    });
  };

  const save = async () => {
    await onSave(rows);
    setBaseRows(rows.map((row) => [...row]));
  };

  return (
    <div className="office-sheet">
      <div className="office-subbar">
        {doc.sheetNames.length > 1 ? (
          <div className="office-sheet-tabs" role="tablist">
            {doc.sheetNames.map((name) => (
              <button
                key={name}
                type="button"
                role="tab"
                aria-selected={name === doc.sheet}
                className={`office-sheet-tab${name === doc.sheet ? " is-active" : ""}`}
                disabled={dirty || saving}
                title={dirty ? t("office.saveBeforeSwitch") : name}
                onClick={() => onSelectSheet(name)}
              >
                {name}
              </button>
            ))}
          </div>
        ) : (
          <span className="office-subbar-label">{doc.sheet}</span>
        )}

        <span className="office-subbar-spacer" />

        {doc.editable && dirty ? (
          <>
            <button
              type="button"
              className="office-btn"
              disabled={saving}
              onClick={() => {
                setRows(baseRows.map((row) => [...row]));
                setEditing(null);
              }}
            >
              {t("office.discard")}
            </button>
            <button
              type="button"
              className="office-btn is-primary"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? t("office.saving") : t("office.save")}
            </button>
          </>
        ) : null}
        {!doc.editable ? (
          <span className="office-subbar-note">{t("office.readOnly")}</span>
        ) : null}
      </div>

      <div className="office-sheet-scroll">
        <table className="office-grid">
          <thead>
            <tr>
              <th className="office-grid-gutter" scope="col" />
              {Array.from({ length: columns }, (_, c) => (
                <th
                  key={c}
                  scope="col"
                  style={{
                    width: doc.columnWidths[c] ?? undefined,
                    ...(c < doc.frozen.cols
                      ? { position: "sticky", left: stickyLeft[c + 1], zIndex: 4 }
                      : {}),
                  }}
                >
                  {columnLabel(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, r) => (
              <tr key={r} className={r < doc.frozen.rows ? "is-frozen" : ""}>
                <th className="office-grid-gutter" scope="row">
                  {r + 1}
                </th>
                {row.map((value, c) => {
                  if (merge.covered.has(key(r, c))) return null;
                  const span = merge.spans.get(key(r, c));
                  const style = doc.rows[r]?.[c]?.s;
                  const frozenCol = c < doc.frozen.cols;
                  const css = {
                    ...cellCss(
                      style === undefined ? undefined : doc.styles[style],
                    ),
                    ...(frozenCol
                      ? {
                          position: "sticky" as const,
                          left: stickyLeft[c + 1],
                          zIndex: 2,
                        }
                      : {}),
                  };

                  if (editing?.r === r && editing.c === c && doc.editable) {
                    return (
                      <td
                        key={c}
                        className="is-editing"
                        rowSpan={span?.rowSpan}
                        colSpan={span?.colSpan}
                        style={css}
                      >
                        <input
                          autoFocus
                          className="office-grid-input"
                          value={value}
                          onChange={(e) => updateCell(r, c, e.target.value)}
                          onBlur={() => setEditing(null)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === "Escape") {
                              e.currentTarget.blur();
                            }
                          }}
                        />
                      </td>
                    );
                  }

                  return (
                    <td
                      key={c}
                      title={value}
                      rowSpan={span?.rowSpan}
                      colSpan={span?.colSpan}
                      style={css}
                      onClick={
                        doc.editable ? () => setEditing({ r, c }) : undefined
                      }
                    >
                      {value}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>

        {rows.length > limit ? (
          <button
            type="button"
            className="office-btn office-more"
            onClick={() => setLimit((n) => n + PAGE_STEP)}
          >
            {t("office.showMore", { shown: limit, total: rows.length })}
          </button>
        ) : null}
      </div>
    </div>
  );
}
