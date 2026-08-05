import { describe, expect, it } from "vitest";
import { officeKindForPath as mainKind } from "../../../../electron/office/index";
import { isLegacyOfficeBinary, officeKindForPath } from "./officeKind";

/** Every extension either side claims to know about. */
const EXTENSIONS = [
  "csv", "tsv", "xlsx", "xls", "ods", "docx", "pptx",
  "doc", "ppt", "txt", "md", "png", "",
];

describe("officeKindForPath", () => {
  it("classifies the formats the viewers mount", () => {
    expect(officeKindForPath("report.xlsx")).toBe("sheet");
    expect(officeKindForPath("notes.DOCX")).toBe("doc");
    expect(officeKindForPath("deck.pptx")).toBe("slides");
    expect(officeKindForPath("src/index.ts")).toBeNull();
  });

  it("handles windows paths and dotfiles without extensions", () => {
    expect(officeKindForPath("C:\\Users\\me\\q3.xlsx")).toBe("sheet");
    expect(officeKindForPath("/home/me/.gitignore")).toBeNull();
  });

  it("flags legacy containers separately from previewable ones", () => {
    expect(isLegacyOfficeBinary("old.doc")).toBe(true);
    expect(isLegacyOfficeBinary("old.ppt")).toBe(true);
    expect(isLegacyOfficeBinary("new.docx")).toBe(false);
  });

  // The renderer keeps its own copy of the table so the parsers stay out of
  // the renderer bundle; this catches the two drifting apart.
  it("agrees with the main-process mapping", () => {
    for (const ext of EXTENSIONS) {
      const file = ext ? `/tmp/sample.${ext}` : "/tmp/sample";
      expect(officeKindForPath(file)).toBe(mainKind(file));
    }
  });
});
