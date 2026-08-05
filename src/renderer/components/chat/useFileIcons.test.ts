import { describe, expect, it } from "vitest";
import { extensionOf } from "./useFileIcons";

describe("extensionOf", () => {
  it("lowercases the extension", () => {
    expect(extensionOf("Report.XLSX")).toBe("xlsx");
    expect(extensionOf("deck.pptx")).toBe("pptx");
  });

  it("reads the last segment of posix and windows paths", () => {
    expect(extensionOf("a/b/c.docx")).toBe("docx");
    expect(extensionOf("C:\\Users\\me\\q3.xlsx")).toBe("xlsx");
  });

  it("returns empty for dotfiles and extensionless names", () => {
    expect(extensionOf(".gitignore")).toBe("");
    expect(extensionOf("Makefile")).toBe("");
    expect(extensionOf("dir.with.dots/file")).toBe("");
  });
});
