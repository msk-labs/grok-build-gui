/**
 * Files carried by a clipboard or drag payload (pasted screenshots, copied
 * files). Returns an empty list for text-only payloads so a normal paste is
 * left untouched.
 */
export function extractTransferFiles(
  data: DataTransfer | null | undefined,
): File[] {
  if (!data) return [];
  // Chromium marks real file payloads with the "Files" type. Rich text that
  // merely renders an image does not, so plain paste keeps working.
  if (!Array.from(data.types ?? []).includes("Files")) return [];

  const files: File[] = [];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  if (files.length > 0) return files;

  return Array.from(data.files ?? []);
}
