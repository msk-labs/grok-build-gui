import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { officeKindForPath, readOfficeDocument } from "./index";
import {
  displayValue,
  parseDelimited,
  serializeDelimited,
  writeSheet,
} from "./sheet";
import {
  cellStyleOf,
  columnWidthToPx,
  parseRange,
  StyleTable,
  toCssColor,
} from "./sheetStyle";

const dirs: string[] = [];

async function scratch(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "office-test-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("officeKindForPath", () => {
  it("maps the formats the viewers handle", () => {
    expect(officeKindForPath("/a/b.xlsx")).toBe("sheet");
    expect(officeKindForPath("/a/B.CSV")).toBe("sheet");
    expect(officeKindForPath("/a/b.docx")).toBe("doc");
    expect(officeKindForPath("/a/b.pptx")).toBe("slides");
  });

  it("rejects legacy binaries and unrelated files", () => {
    expect(officeKindForPath("/a/b.doc")).toBeNull();
    expect(officeKindForPath("/a/b.ppt")).toBeNull();
    expect(officeKindForPath("/a/b.ts")).toBeNull();
  });
});

describe("delimited round-trip", () => {
  it("preserves quotes, embedded delimiters, and newlines", () => {
    const text = 'a,"b,c"\n"say ""hi""","line\nbreak"\n';
    const rows = parseDelimited(text, ",");
    expect(rows).toEqual([
      ["a", "b,c"],
      ['say "hi"', "line\nbreak"],
    ]);
    expect(parseDelimited(serializeDelimited(rows, ","), ",")).toEqual(rows);
  });

  it("keeps leading zeros as text across a save", async () => {
    const file = path.join(await scratch(), "ids.csv");
    await writeFile(file, "id,name\n00734,ada\n", "utf8");

    const doc = await readOfficeDocument(file);
    if (doc.kind !== "sheet") throw new Error("expected sheet");
    expect(doc.rows[1]?.map((c) => c.v)).toEqual(["00734", "ada"]);

    await writeSheet(file, doc.sheet, [
      ["id", "name"],
      ["00734", "ada"],
    ]);
    const again = await readOfficeDocument(file);
    if (again.kind !== "sheet") throw new Error("expected sheet");
    expect(again.rows[1]?.map((c) => c.v)).toEqual(["00734", "ada"]);
  });
});

describe("displayValue", () => {
  it("applies the cell's number format", async () => {
    expect(await displayValue({ value: 0.1234, numFmt: "0.0%" })).toBe("12.3%");
    expect(await displayValue({ value: 1234.5, numFmt: "#,##0.00" })).toBe(
      "1,234.50",
    );
  });

  it("unwraps the shapes ExcelJS returns", async () => {
    expect(await displayValue({ value: null })).toBe("");
    expect(
      await displayValue({ value: { richText: [{ text: "a" }, { text: "b" }] } }),
    ).toBe("ab");
    expect(await displayValue({ value: { formula: "1+1", result: 2 } })).toBe("2");
    expect(
      await displayValue({ value: { text: "site", hyperlink: "https://x" } }),
    ).toBe("site");
    expect(await displayValue({ value: { error: "#DIV/0!" } })).toBe("#DIV/0!");
    expect(await displayValue({ value: true })).toBe("TRUE");
  });

  it("formats dates through the cell format, not the JS default", async () => {
    expect(
      await displayValue({ value: new Date(Date.UTC(2026, 7, 4)), numFmt: "yyyy-mm-dd" }),
    ).toBe("2026-08-04");
  });
});

describe("xlsx with formatting", () => {
  /** Build a workbook that carries every feature the grid renders. */
  async function makeWorkbook(dir: string): Promise<string> {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Parts");

    ws.getCell("A1").value = "Report";
    ws.mergeCells("A1:B1");
    ws.getCell("A1").font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
    ws.getCell("A1").fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1F4E79" },
    };
    ws.getCell("A1").alignment = { horizontal: "center" };

    ws.getCell("A2").value = "name";
    ws.getCell("B2").value = "qty";
    ws.getCell("A3").value = "bolt";
    ws.getCell("B3").value = 12;
    ws.getCell("B3").numFmt = "#,##0.00";
    ws.getCell("B3").border = { bottom: { style: "thin" } };
    ws.getColumn(1).width = 20;
    ws.views = [{ state: "frozen", xSplit: 1, ySplit: 2 }];

    const notes = wb.addWorksheet("Notes");
    notes.getCell("A1").value = "keep me";

    const file = path.join(dir, "book.xlsx");
    await wb.xlsx.writeFile(file);
    return file;
  }

  it("carries fills, fonts, alignment, and borders into the style table", async () => {
    const doc = await readOfficeDocument(await makeWorkbook(await scratch()));
    if (doc.kind !== "sheet") throw new Error("expected sheet");

    expect(doc.styled).toBe(true);
    const title = doc.rows[0]?.[0];
    expect(title?.v).toBe("Report");
    expect(doc.styles[title!.s!]).toMatchObject({
      bold: true,
      fontSize: 14,
      color: "#ffffff",
      fill: "#1f4e79",
      align: "center",
    });
    expect(doc.styles[doc.rows[2]![1]!.s!]).toMatchObject({
      border: { bottom: true },
    });
  });

  it("reports merges, column widths, and frozen panes", async () => {
    const doc = await readOfficeDocument(await makeWorkbook(await scratch()));
    if (doc.kind !== "sheet") throw new Error("expected sheet");

    expect(doc.merges).toContainEqual({ top: 0, left: 0, bottom: 0, right: 1 });
    expect(doc.columnWidths[0]).toBe(145);
    expect(doc.frozen).toEqual({ rows: 2, cols: 1 });
  });

  it("formats numbers the way the workbook asks", async () => {
    const doc = await readOfficeDocument(await makeWorkbook(await scratch()));
    if (doc.kind !== "sheet") throw new Error("expected sheet");
    expect(doc.rows[2]?.[1]?.v).toBe("12.00");
  });

  it("preserves formatting and other sheets when a cell is edited", async () => {
    const file = await makeWorkbook(await scratch());
    await writeSheet(file, "Parts", [
      ["Report", ""],
      ["name", "qty"],
      ["bolt", "13"],
    ]);

    const doc = await readOfficeDocument(file);
    if (doc.kind !== "sheet") throw new Error("expected sheet");

    expect(doc.rows[2]?.[1]?.v).toBe("13.00");
    // The edit must not have flattened the sheet around it.
    expect(doc.styles[doc.rows[0]![0]!.s!]).toMatchObject({ fill: "#1f4e79" });
    expect(doc.merges).toContainEqual({ top: 0, left: 0, bottom: 0, right: 1 });
    expect(doc.frozen).toEqual({ rows: 2, cols: 1 });
    expect(doc.sheetNames).toEqual(["Parts", "Notes"]);

    const notes = await readOfficeDocument(file, { sheet: "Notes" });
    if (notes.kind !== "sheet") throw new Error("expected sheet");
    expect(notes.rows[0]?.[0]?.v).toBe("keep me");
  });

  it("refuses to write formats it cannot serialize safely", async () => {
    const file = path.join(await scratch(), "legacy.ods");
    await writeFile(file, "");
    await expect(writeSheet(file, "Sheet1", [["a"]])).rejects.toThrow(
      /not supported/i,
    );
  });
});

describe("style helpers", () => {
  it("converts argb to css and ignores theme colours", () => {
    expect(toCssColor({ argb: "FF4472C4" })).toBe("#4472c4");
    expect(toCssColor({ argb: "4472C4" })).toBe("#4472c4");
    expect(toCssColor({ theme: 4 })).toBeUndefined();
    expect(toCssColor(undefined)).toBeUndefined();
  });

  it("converts excel column widths to pixels", () => {
    expect(columnWidthToPx(20)).toBe(145);
    expect(columnWidthToPx(undefined)).toBeNull();
    expect(columnWidthToPx(0)).toBeNull();
  });

  it("returns no style for an unformatted cell", () => {
    expect(cellStyleOf({})).toBeUndefined();
    // A non-solid fill has no clean CSS equivalent and is dropped.
    expect(
      cellStyleOf({ fill: { type: "pattern", pattern: "darkVertical" } }),
    ).toBeUndefined();
  });

  it("interns each distinct style once", () => {
    const table = new StyleTable();
    const a = table.intern({ bold: true });
    const b = table.intern({ bold: true });
    const c = table.intern({ italic: true });

    expect(a).toBe(b);
    expect(c).not.toBe(a);
    expect(table.styles).toHaveLength(2);
    expect(table.intern(undefined)).toBeUndefined();
  });

  it("parses a1 ranges into 0-based bounds", () => {
    expect(parseRange("A1:C3")).toEqual({
      top: 0,
      left: 0,
      bottom: 2,
      right: 2,
    });
    expect(parseRange("AA10:AB11")).toEqual({
      top: 9,
      left: 26,
      bottom: 10,
      right: 27,
    });
    expect(parseRange("nonsense")).toBeNull();
  });
});

describe("docx and pptx", () => {
  it("hands the container bytes to the renderer", async () => {
    const dir = await scratch();
    const file = path.join(dir, "letter.docx");
    await writeFile(file, Buffer.from("PKfake"));

    const doc = await readOfficeDocument(file);
    if (doc.kind !== "doc") throw new Error("expected doc");
    expect(Buffer.from(doc.base64, "base64").toString()).toBe("PKfake");
    expect(doc.bytes).toBe(8);
  });
});

describe("readOfficeDocument", () => {
  it("rejects paths it has no viewer for", async () => {
    const file = path.join(await scratch(), "notes.txt");
    await writeFile(file, "hi");
    await expect(readOfficeDocument(file)).rejects.toThrow(/unsupported/i);
  });
});
