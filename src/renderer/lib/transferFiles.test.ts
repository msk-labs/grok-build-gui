import { describe, expect, it } from "vitest";
import { extractTransferFiles } from "./transferFiles";

type FakeItem = { kind: string; type: string; file: File | null };

function transfer(types: string[], items: FakeItem[]): DataTransfer {
  return {
    types,
    items: items.map((i) => ({
      kind: i.kind,
      type: i.type,
      getAsFile: () => i.file,
    })),
    files: items.map((i) => i.file).filter((f): f is File => !!f),
  } as unknown as DataTransfer;
}

function png(name: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });
}

describe("extractTransferFiles", () => {
  it("returns the pasted image of a screenshot clipboard", () => {
    const image = png("image.png");
    const files = extractTransferFiles(
      transfer(["Files"], [{ kind: "file", type: "image/png", file: image }]),
    );
    expect(files).toEqual([image]);
  });

  it("ignores text-only payloads so normal paste still runs", () => {
    const files = extractTransferFiles(
      transfer(
        ["text/plain", "text/html"],
        [{ kind: "string", type: "text/plain", file: null }],
      ),
    );
    expect(files).toEqual([]);
  });

  it("keeps files and drops string items in a mixed payload", () => {
    const image = png("shot.png");
    const files = extractTransferFiles(
      transfer(
        ["Files", "text/html"],
        [
          { kind: "string", type: "text/html", file: null },
          { kind: "file", type: "image/png", file: image },
        ],
      ),
    );
    expect(files).toEqual([image]);
  });

  it("falls back to the files list when items are unavailable", () => {
    const image = png("copied.png");
    const data = {
      types: ["Files"],
      items: undefined,
      files: [image],
    } as unknown as DataTransfer;
    expect(extractTransferFiles(data)).toEqual([image]);
  });

  it("returns nothing without a payload", () => {
    expect(extractTransferFiles(null)).toEqual([]);
  });
});
