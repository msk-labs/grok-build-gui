/**
 * Turn the parser's cell formatting into inline styles, and resolve the layout
 * facts an HTML table needs that a spreadsheet expresses differently: merged
 * regions become colspan/rowspan plus a set of covered cells to skip, and
 * frozen panes become sticky offsets.
 */
import type { CSSProperties } from "react";
import type {
  CellStyle,
  MergeRegion,
} from "../../../../electron/office/types";

export function cellCss(style: CellStyle | undefined): CSSProperties {
  if (!style) return {};
  const css: CSSProperties = {};

  if (style.bold) css.fontWeight = 600;
  if (style.italic) css.fontStyle = "italic";
  if (style.underline || style.strike) {
    css.textDecoration = [
      style.underline ? "underline" : "",
      style.strike ? "line-through" : "",
    ]
      .filter(Boolean)
      .join(" ");
  }
  if (style.color) css.color = style.color;
  if (style.fill) css.background = style.fill;
  if (style.fontSize) css.fontSize = `${style.fontSize}px`;
  // Workbook fonts are rarely installed; keep the app's stack as a fallback.
  if (style.fontName) css.fontFamily = `"${style.fontName}", var(--font)`;
  if (style.align) css.textAlign = style.align;
  if (style.valign) {
    css.verticalAlign =
      style.valign === "middle" ? "middle" : style.valign;
  }
  if (style.wrap) {
    css.whiteSpace = "pre-wrap";
    css.wordBreak = "break-word";
  }

  if (style.border) {
    const line = "1px solid var(--border-strong)";
    if (style.border.top) css.borderTop = line;
    if (style.border.right) css.borderRight = line;
    if (style.border.bottom) css.borderBottom = line;
    if (style.border.left) css.borderLeft = line;
  }
  return css;
}

export type MergeSpan = { rowSpan: number; colSpan: number };

export type MergeMap = {
  /** Spans keyed by `row:col` of the region's top-left cell. */
  spans: Map<string, MergeSpan>;
  /** `row:col` of cells swallowed by a region — these render no `<td>`. */
  covered: Set<string>;
};

export function key(row: number, col: number): string {
  return `${row}:${col}`;
}

export function buildMergeMap(merges: MergeRegion[]): MergeMap {
  const spans = new Map<string, MergeSpan>();
  const covered = new Set<string>();

  for (const region of merges) {
    const rowSpan = region.bottom - region.top + 1;
    const colSpan = region.right - region.left + 1;
    if (rowSpan < 1 || colSpan < 1) continue;
    if (rowSpan === 1 && colSpan === 1) continue;

    spans.set(key(region.top, region.left), { rowSpan, colSpan });
    for (let r = region.top; r <= region.bottom; r += 1) {
      for (let c = region.left; c <= region.right; c += 1) {
        if (r === region.top && c === region.left) continue;
        covered.add(key(r, c));
      }
    }
  }
  return { spans, covered };
}

/** Default column width when the workbook does not specify one. */
const DEFAULT_COL_PX = 88;
const GUTTER_PX = 44;

/**
 * Left offsets for sticky frozen columns. Index 0 is the row-number gutter, so
 * data column `c` reads `offsets[c + 1]`.
 */
export function frozenOffsets(
  columnWidths: Array<number | null>,
  frozenCols: number,
): number[] {
  const offsets = [0];
  let running = GUTTER_PX;
  for (let c = 0; c < frozenCols; c += 1) {
    offsets.push(running);
    running += columnWidths[c] ?? DEFAULT_COL_PX;
  }
  return offsets;
}
