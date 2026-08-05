/**
 * Renderer-side extension mapping.
 *
 * Deliberately duplicates the table in `src/electron/office/index.ts` rather
 * than importing it: that module pulls in the parsers, and the renderer must
 * only ever learn *which* viewer to mount, never how to parse.
 */
export type OfficeKind = "sheet" | "doc" | "slides";

const KIND_BY_EXT: Record<string, OfficeKind> = {
  csv: "sheet",
  tsv: "sheet",
  xlsx: "sheet",
  xls: "sheet",
  ods: "sheet",
  docx: "doc",
  pptx: "slides",
};

/** Pre-2007 containers we cannot parse but can still hand to the OS. */
const LEGACY_EXT = new Set(["doc", "ppt"]);

function extensionOf(filePath: string): string {
  const name = filePath.replace(/\\/g, "/").split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** `null` when the path is not an Office file we render in-app. */
export function officeKindForPath(filePath: string): OfficeKind | null {
  return KIND_BY_EXT[extensionOf(filePath)] ?? null;
}

export function isLegacyOfficeBinary(filePath: string): boolean {
  return LEGACY_EXT.has(extensionOf(filePath));
}
