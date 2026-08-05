/**
 * Office document preview entry point.
 *
 * Spreadsheets are parsed here — the grid needs structured cells, not a
 * document to lay out. Word and PowerPoint only get read and size-checked here;
 * their layout renderers need a DOM and therefore run in the renderer.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { readDocBytes, readSlideBytes } from "./bytes.js";
import { readSheet } from "./sheet.js";
import {
  MAX_OFFICE_BYTES,
  type OfficeDocument,
  type OfficeKind,
} from "./types.js";

export * from "./types.js";
export { writeSheet } from "./sheet.js";

const KIND_BY_EXT: Record<string, OfficeKind> = {
  ".csv": "sheet",
  ".tsv": "sheet",
  ".xlsx": "sheet",
  ".xls": "sheet",
  ".ods": "sheet",
  ".docx": "doc",
  ".pptx": "slides",
};

/** `null` for anything the in-app viewers do not handle. */
export function officeKindForPath(filePath: string): OfficeKind | null {
  return KIND_BY_EXT[path.extname(filePath).toLowerCase()] ?? null;
}

/**
 * Legacy binary formats (.doc, .ppt, pre-2007 .xls variants) are a different
 * container entirely; the viewers offer "open externally" for those instead.
 */
export function isLegacyOfficeBinary(filePath: string): boolean {
  return [".doc", ".ppt"].includes(path.extname(filePath).toLowerCase());
}

export async function readOfficeDocument(
  filePath: string,
  options?: { sheet?: string },
): Promise<OfficeDocument> {
  const kind = officeKindForPath(filePath);
  if (!kind) throw new Error("Unsupported document type");

  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error("Not a file");
  if (stat.size > MAX_OFFICE_BYTES) {
    throw new Error(
      `File is too large to preview (${Math.round(stat.size / 1024 / 1024)} MB)`,
    );
  }

  if (kind === "sheet") return await readSheet(filePath, options?.sheet);
  if (kind === "doc") return await readDocBytes(filePath);
  return await readSlideBytes(filePath);
}
