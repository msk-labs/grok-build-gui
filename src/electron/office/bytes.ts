/**
 * Word and PowerPoint are handed to the renderer as raw bytes.
 *
 * Reproducing their layout — pagination, text-box geometry, theme colours,
 * inline images — means laying content out against a real DOM, so the
 * rendering libraries only run in the renderer. The main process stays
 * responsible for what it is actually good for: resolving the path inside the
 * workspace and refusing files too large to ship over IPC.
 */
import fs from "node:fs/promises";
import type { DocDocument, SlidesDocument } from "./types.js";

export async function readDocBytes(filePath: string): Promise<DocDocument> {
  const buffer = await fs.readFile(filePath);
  return {
    kind: "doc",
    base64: buffer.toString("base64"),
    bytes: buffer.byteLength,
  };
}

export async function readSlideBytes(
  filePath: string,
): Promise<SlidesDocument> {
  const buffer = await fs.readFile(filePath);
  return {
    kind: "slides",
    base64: buffer.toString("base64"),
    bytes: buffer.byteLength,
  };
}
