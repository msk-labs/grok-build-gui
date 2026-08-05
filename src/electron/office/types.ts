/**
 * Shared Office document shapes. Imported by the parsers, the IPC layer, the
 * preload bridge, and (transitively, via `GrokApi`) the renderer.
 */

/** Preview families we render in-app. `null` elsewhere means "not an Office file". */
export type OfficeKind = "sheet" | "doc" | "slides";

/**
 * Visual attributes of a cell, kept in a per-document lookup table.
 *
 * Sheets repeat the same handful of formats across thousands of cells, so cells
 * carry a style index instead of an inline object — otherwise the IPC payload
 * is mostly duplicated colour strings.
 */
export type CellStyle = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  /** `#rrggbb`. */
  color?: string;
  /** `#rrggbb` background fill. */
  fill?: string;
  fontSize?: number;
  fontName?: string;
  align?: "left" | "center" | "right";
  valign?: "top" | "middle" | "bottom";
  wrap?: boolean;
  border?: {
    top?: boolean;
    right?: boolean;
    bottom?: boolean;
    left?: boolean;
  };
};

export type SheetCell = {
  /** Display text, already formatted through the cell's number format. */
  v: string;
  /** Index into `SheetDocument.styles`; absent means "no styling". */
  s?: number;
};

/** Top-left anchored merge region, in 0-based grid coordinates. */
export type MergeRegion = {
  top: number;
  left: number;
  bottom: number;
  right: number;
};

/** Spreadsheet: one sheet materialized with the formatting an editor shows. */
export type SheetDocument = {
  kind: "sheet";
  /** Every sheet in the workbook, in workbook order (csv/tsv report one). */
  sheetNames: string[];
  /** Name of the sheet in `rows`. */
  sheet: string;
  rows: SheetCell[][];
  styles: CellStyle[];
  merges: MergeRegion[];
  /** Column widths in CSS pixels; `null` keeps the default. */
  columnWidths: Array<number | null>;
  /** Frozen pane split, as counts of pinned rows/columns. */
  frozen: { rows: number; cols: number };
  /** True when rows/columns were capped for display. */
  truncated: boolean;
  /** Editing is only offered for formats we can write back safely. */
  editable: boolean;
  /** False for formats read without style support (.xls/.ods, csv). */
  styled: boolean;
};

/**
 * Word document handed to the renderer as raw bytes.
 *
 * Layout fidelity — pagination, margins, table borders, inline images — needs a
 * real DOM to lay out against, so the rendering happens in the renderer and the
 * main process only reads and size-checks the file.
 */
export type DocDocument = {
  kind: "doc";
  /** Base64 of the .docx container. */
  base64: string;
  bytes: number;
};

/** Presentation handed to the renderer as raw bytes, for the same reason. */
export type SlidesDocument = {
  kind: "slides";
  /** Base64 of the .pptx container. */
  base64: string;
  bytes: number;
};

export type OfficeDocument = SheetDocument | DocDocument | SlidesDocument;

/** Largest file we will parse; OOXML expands a lot in memory. */
export const MAX_OFFICE_BYTES = 32 * 1024 * 1024;
export const MAX_SHEET_ROWS = 5000;
export const MAX_SHEET_COLS = 200;
