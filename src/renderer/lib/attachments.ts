import type { ChatFile, ChatImage } from "../types/chat";
import { uid } from "./sessionUpdate";

/** Max size for embedding file contents in the prompt (bytes). */
const MAX_EMBED_BYTES = 2 * 1024 * 1024;
/** Max size for images attached as vision blocks. */
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

const TEXT_EXT =
  /\.(ts|tsx|js|jsx|mjs|cjs|py|rs|go|md|txt|json|ya?ml|toml|css|scss|html?|svg|sh|bash|zsh|c|cc|cpp|h|hpp|java|kt|rb|php|sql|env|lock|log|xml|csv|ini|cfg|conf|dockerfile|makefile|gradle|properties|proto|graphql|vue|svelte|astro)$/i;

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|ico|avif|heic|heif)$/i;

export type PreparedAttachments = {
  images: Array<ChatImage & { data: string }>;
  files: ChatFile[];
  errors: string[];
};

function filePath(file: File): string | undefined {
  const p = (file as File & { path?: string }).path;
  return typeof p === "string" && p.length > 0 ? p : undefined;
}

function isImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  return IMAGE_EXT.test(file.name);
}

function isTextLike(file: File): boolean {
  if (file.type.startsWith("text/")) return true;
  if (
    file.type === "application/json" ||
    file.type === "application/xml" ||
    file.type === "application/javascript" ||
    file.type === "application/typescript" ||
    file.type === "application/x-yaml" ||
    file.type === "application/toml"
  ) {
    return true;
  }
  return TEXT_EXT.test(file.name);
}

function guessMime(file: File, asImage: boolean): string {
  if (file.type) return file.type;
  if (asImage) {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
    if (ext === "png") return "image/png";
    if (ext === "gif") return "image/gif";
    if (ext === "webp") return "image/webp";
    if (ext === "svg") return "image/svg+xml";
    return "image/png";
  }
  return "application/octet-stream";
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsText(file);
  });
}

function readAsBase64(file: File): Promise<string> {
  return readAsDataUrl(file).then((dataUrl) => {
    const i = dataUrl.indexOf(",");
    return i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
  });
}

function imageDims(
  dataUrl: string,
): Promise<{ width?: number; height?: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () =>
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({});
    img.src = dataUrl;
  });
}

function pathToFileUri(path: string): string {
  // Absolute POSIX or Windows path → file:// URI
  if (path.startsWith("file:")) return path;
  if (/^[A-Za-z]:[\\/]/.test(path)) {
    const normalized = path.replace(/\\/g, "/");
    return `file:///${normalized}`;
  }
  return path.startsWith("/") ? `file://${path}` : `file:///${path}`;
}

export function fileToResourceUri(file: ChatFile): string {
  if (file.path) return pathToFileUri(file.path);
  return `attachment:///${encodeURIComponent(file.name)}`;
}

/** Turn dropped / picked browser File objects into draft attachments. */
export async function prepareFiles(
  fileList: File[] | FileList,
): Promise<PreparedAttachments> {
  const files = Array.from(fileList);
  const images: Array<ChatImage & { data: string }> = [];
  const outFiles: ChatFile[] = [];
  const errors: string[] = [];

  for (const file of files) {
    if (!file || file.size === 0) {
      errors.push(`Skipped empty file: ${file?.name || "unknown"}`);
      continue;
    }

    try {
      if (isImageFile(file)) {
        if (file.size > MAX_IMAGE_BYTES) {
          errors.push(
            `${file.name} is too large (max ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB for images)`,
          );
          continue;
        }
        const dataUrl = await readAsDataUrl(file);
        const data = dataUrl.replace(/^data:[^;]+;base64,/, "");
        if (!data) {
          errors.push(`Could not read image: ${file.name}`);
          continue;
        }
        const dims = await imageDims(dataUrl);
        images.push({
          id: uid("img"),
          mimeType: guessMime(file, true),
          dataUrl,
          data,
          name: file.name,
          ...dims,
        });
        continue;
      }

      // Non-image: prefer embedded text, then small binary blob, else path link.
      if (isTextLike(file) && file.size <= MAX_EMBED_BYTES) {
        const text = await readAsText(file);
        outFiles.push({
          id: uid("file"),
          name: file.name,
          mimeType: guessMime(file, false),
          path: filePath(file),
          text,
          size: file.size,
        });
        continue;
      }

      if (file.size <= MAX_EMBED_BYTES) {
        const data = await readAsBase64(file);
        outFiles.push({
          id: uid("file"),
          name: file.name,
          mimeType: guessMime(file, false),
          path: filePath(file),
          data,
          size: file.size,
        });
        continue;
      }

      const path = filePath(file);
      if (path) {
        outFiles.push({
          id: uid("file"),
          name: file.name,
          mimeType: guessMime(file, false),
          path,
          size: file.size,
        });
        continue;
      }

      errors.push(
        `${file.name} is too large to embed and has no local path`,
      );
    } catch (err) {
      errors.push(
        `Failed to read ${file.name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { images, files: outFiles, errors };
}
