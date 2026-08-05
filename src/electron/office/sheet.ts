/**
 * Spreadsheet reading and write-back.
 *
 * `.xlsx` goes through ExcelJS because it exposes formatting — fills, fonts,
 * borders, merges, column widths, frozen panes — and because writing back
 * through the *loaded* workbook mutates only the cells the user touched. That
 * is what keeps an edit from flattening the document, which is exactly what
 * rebuilding a workbook from values does.
 *
 * `.xls` / `.ods` fall back to SheetJS, values only: no reliable style model.
 *
 * Delimited text (csv/tsv) is parsed here rather than by either library,
 * because both coerce cell types on read and would turn an id column like
 * `00734` into `734` the first time a user saves.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { cellStyleOf, columnWidthToPx, parseRange, StyleTable } from "./sheetStyle.js";
import {
  MAX_SHEET_COLS,
  MAX_SHEET_ROWS,
  type MergeRegion,
  type SheetCell,
  type SheetDocument,
} from "./types.js";

const DELIMITED = new Set([".csv", ".tsv"]);
/** Formats we are willing to write back. Legacy .xls / .ods stay read-only. */
const WRITABLE = new Set([".csv", ".tsv", ".xlsx"]);

function ext(filePath: string): string {
  return path.extname(filePath).toLowerCase();
}

function delimiterFor(filePath: string): string {
  return ext(filePath) === ".tsv" ? "\t" : ",";
}

export function isDelimited(filePath: string): boolean {
  return DELIMITED.has(ext(filePath));
}

export function isSheetWritable(filePath: string): boolean {
  return WRITABLE.has(ext(filePath));
}

/** RFC 4180-style parse: quoted fields, doubled quotes, CRLF or LF rows. */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === "") {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.length > 0 ? rows : [[""]];
}

export function serializeDelimited(
  rows: string[][],
  delimiter: string,
): string {
  const body = rows
    .map((row) =>
      row
        .map((raw) => {
          const value = String(raw ?? "");
          return value.includes(delimiter) || /["\r\n]/.test(value)
            ? `"${value.replace(/"/g, '""')}"`
            : value;
        })
        .join(delimiter),
    )
    .join("\n");
  return body.length > 0 ? `${body}\n` : "";
}

/** SheetJS ships a large UMD bundle — keep it off the startup path. */
async function sheetjs() {
  return await import("@e965/xlsx");
}

async function exceljs() {
  return (await import("exceljs")).default;
}

/**
 * Render a cell the way a spreadsheet app would.
 *
 * ExcelJS hands back the *typed* value and the number format separately, so the
 * format is applied here with SheetJS's SSF — the same formatter Excel's own
 * codes were written for.
 */
export async function displayValue(cell: {
  value: unknown;
  numFmt?: string;
}): Promise<string> {
  const value = cell.value;
  if (value == null) return "";

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.richText)) {
      return record.richText
        .map((run) => String((run as { text?: unknown }).text ?? ""))
        .join("");
    }
    if ("error" in record) return String(record.error);
    if ("text" in record) return String(record.text ?? "");
    if ("result" in record) {
      return await displayValue({ value: record.result, numFmt: cell.numFmt });
    }
    if ("formula" in record || "sharedFormula" in record) return "";
    if (value instanceof Date) {
      return await formatNumber(dateToSerial(value), cell.numFmt ?? "yyyy-mm-dd");
    }
    return String(value);
  }

  if (typeof value === "number") {
    return await formatNumber(value, cell.numFmt);
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value);
}

/** Excel's serial epoch is 1899-12-30 in the 1900 date system. */
function dateToSerial(date: Date): number {
  return date.getTime() / 86_400_000 + 25569;
}

async function formatNumber(value: number, numFmt?: string): Promise<string> {
  if (!numFmt || numFmt === "General") return String(value);
  try {
    const XLSX = await sheetjs();
    return XLSX.SSF.format(numFmt, value);
  } catch {
    // Unsupported or malformed format code — the raw number still informs.
    return String(value);
  }
}

/** Cap the grid and pad every row so it renders as a rectangle. */
function rectangular(
  rows: SheetCell[][],
): { rows: SheetCell[][]; capped: boolean } {
  const capped =
    rows.length > MAX_SHEET_ROWS ||
    rows.some((row) => row.length > MAX_SHEET_COLS);
  const clipped = rows.slice(0, MAX_SHEET_ROWS);
  const width = Math.min(
    MAX_SHEET_COLS,
    Math.max(1, ...clipped.map((row) => row.length)),
  );
  return {
    rows: clipped.map((row) =>
      Array.from({ length: width }, (_, i) => row[i] ?? { v: "" }),
    ),
    capped,
  };
}

function plainDocument(
  partial: Pick<SheetDocument, "sheetNames" | "sheet" | "rows" | "truncated" | "editable">,
): SheetDocument {
  return {
    kind: "sheet",
    styles: [],
    merges: [],
    columnWidths: [],
    frozen: { rows: 0, cols: 0 },
    styled: false,
    ...partial,
  };
}

async function readDelimitedSheet(filePath: string): Promise<SheetDocument> {
  const text = await fs.readFile(filePath, "utf8");
  const name = path.basename(filePath);
  const { rows, capped } = rectangular(
    parseDelimited(text.replace(/^﻿/, ""), delimiterFor(filePath)).map(
      (row) => row.map((v) => ({ v })),
    ),
  );
  return plainDocument({
    sheetNames: [name],
    sheet: name,
    rows,
    truncated: capped,
    editable: true,
  });
}

/** `.xls` / `.ods`: values only, via SheetJS. */
async function readLegacySheet(
  filePath: string,
  requestedSheet?: string,
): Promise<SheetDocument> {
  const XLSX = await sheetjs();
  const workbook = XLSX.read(await fs.readFile(filePath), { type: "buffer" });
  const sheetNames = workbook.SheetNames.slice();
  const sheet =
    requestedSheet && sheetNames.includes(requestedSheet)
      ? requestedSheet
      : sheetNames[0];

  if (!sheet) {
    return plainDocument({
      sheetNames: [],
      sheet: "",
      rows: [[{ v: "" }]],
      truncated: false,
      editable: false,
    });
  }

  const aoa = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheet]!, {
    header: 1,
    raw: false,
    blankrows: true,
    defval: "",
  });
  const { rows, capped } = rectangular(
    aoa.map((row) => row.map((cell) => ({ v: cell == null ? "" : String(cell) }))),
  );
  return plainDocument({
    sheetNames,
    sheet,
    rows,
    truncated: capped,
    editable: false,
  });
}

export async function readSheet(
  filePath: string,
  requestedSheet?: string,
): Promise<SheetDocument> {
  if (isDelimited(filePath)) return await readDelimitedSheet(filePath);
  if (ext(filePath) !== ".xlsx") {
    return await readLegacySheet(filePath, requestedSheet);
  }

  const ExcelJS = await exceljs();
  const workbook = new ExcelJS.Workbook();
  // readFile rather than load(buffer): ExcelJS reads the path itself, which
  // sidesteps the Buffer generic mismatch between @types/node and its own types.
  await workbook.xlsx.readFile(filePath);

  const sheetNames = workbook.worksheets.map((ws) => ws.name);
  const target =
    (requestedSheet && workbook.getWorksheet(requestedSheet)) ||
    workbook.worksheets[0];

  if (!target) {
    return plainDocument({
      sheetNames,
      sheet: "",
      rows: [[{ v: "" }]],
      truncated: false,
      editable: true,
    });
  }

  const styles = new StyleTable();
  const height = Math.min(target.rowCount, MAX_SHEET_ROWS);
  const width = Math.min(Math.max(target.columnCount, 1), MAX_SHEET_COLS);

  const rows: SheetCell[][] = [];
  for (let r = 1; r <= height; r += 1) {
    const row = target.getRow(r);
    const cells: SheetCell[] = [];
    for (let c = 1; c <= width; c += 1) {
      const cell = row.getCell(c);
      const style = styles.intern(cellStyleOf(cell));
      const v = await displayValue(cell);
      cells.push(style === undefined ? { v } : { v, s: style });
    }
    rows.push(cells);
  }

  const { rows: shaped, capped } = rectangular(rows);
  const view = target.views?.[0];
  return {
    kind: "sheet",
    sheetNames,
    sheet: target.name,
    rows: shaped,
    styles: styles.styles,
    merges: readMerges(target),
    columnWidths: Array.from({ length: shaped[0]?.length ?? 0 }, (_, i) =>
      columnWidthToPx(target.getColumn(i + 1)?.width),
    ),
    frozen: {
      rows: view?.state === "frozen" ? (view.ySplit ?? 0) : 0,
      cols: view?.state === "frozen" ? (view.xSplit ?? 0) : 0,
    },
    truncated: capped || target.rowCount > MAX_SHEET_ROWS,
    editable: true,
    styled: true,
  };
}

function readMerges(worksheet: { model?: { merges?: unknown } }): MergeRegion[] {
  const raw = worksheet.model?.merges;
  if (!Array.isArray(raw)) return [];
  const regions: MergeRegion[] = [];
  for (const entry of raw) {
    const parsed = typeof entry === "string" ? parseRange(entry) : null;
    if (parsed) regions.push(parsed);
  }
  return regions;
}

/**
 * Narrow a display string back to a number only when the round-trip is exact.
 * `"734"` becomes numeric; `"00734"`, `"1,234"`, and `"1e999"` stay text.
 */
function coerce(value: string): string | number {
  const trimmed = value.trim();
  if (trimmed === "") return value;
  const num = Number(trimmed);
  return Number.isFinite(num) && String(num) === trimmed ? num : value;
}

/**
 * Write `rows` back to `sheetName`.
 *
 * Only cells whose display text actually changed are assigned. That matters:
 * blindly writing every cell back would replace formulas with their results and
 * turn every date into the string it happened to render as.
 */
export async function writeSheet(
  filePath: string,
  sheetName: string,
  rows: string[][],
): Promise<void> {
  if (!isSheetWritable(filePath)) {
    throw new Error(`Saving is not supported for ${ext(filePath)} files`);
  }

  if (isDelimited(filePath)) {
    await fs.writeFile(
      filePath,
      serializeDelimited(rows, delimiterFor(filePath)),
      "utf8",
    );
    return;
  }

  const ExcelJS = await exceljs();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const target = workbook.getWorksheet(sheetName) ?? workbook.worksheets[0];
  if (!target) throw new Error("Workbook has no sheets");

  for (const [r, row] of rows.entries()) {
    for (const [c, next] of row.entries()) {
      const cell = target.getRow(r + 1).getCell(c + 1);
      // Writing through a merged follower corrupts the region; only the
      // top-left master owns the value.
      if (cell.isMerged && cell.master !== cell) continue;
      if ((await displayValue(cell)) === next) continue;
      cell.value = next === "" ? null : coerce(next);
    }
  }

  await workbook.xlsx.writeFile(filePath);
}
