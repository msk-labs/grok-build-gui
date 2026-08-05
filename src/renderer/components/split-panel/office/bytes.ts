/** Decode the base64 the main process ships for docx/pptx containers. */

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  // Allocate the ArrayBuffer explicitly so the view is not typed over the
  // possibly-shared `ArrayBufferLike`, which Blob and structured clone reject.
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function base64ToBlob(base64: string, mime: string): Blob {
  return new Blob([base64ToBytes(base64)], { type: mime });
}
