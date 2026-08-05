import { describe, expect, it } from "vitest";
import { buildMergeMap, cellCss, frozenOffsets, key } from "./sheetCss";

describe("cellCss", () => {
  it("maps text, colour, and alignment", () => {
    expect(cellCss({ bold: true, color: "#ff0000", align: "center" })).toEqual({
      fontWeight: 600,
      color: "#ff0000",
      textAlign: "center",
    });
  });

  it("combines underline and strike into one declaration", () => {
    expect(cellCss({ underline: true, strike: true }).textDecoration).toBe(
      "underline line-through",
    );
  });

  it("falls back to the app font stack behind a workbook font", () => {
    expect(cellCss({ fontName: "Calibri" }).fontFamily).toBe(
      '"Calibri", var(--font)',
    );
  });

  it("draws only the edges the cell declares", () => {
    const css = cellCss({ border: { top: true, bottom: true } });
    expect(css.borderTop).toBeTruthy();
    expect(css.borderBottom).toBeTruthy();
    expect(css.borderLeft).toBeUndefined();
  });

  it("returns nothing for an unstyled cell", () => {
    expect(cellCss(undefined)).toEqual({});
  });
});

describe("buildMergeMap", () => {
  it("spans the anchor and covers the rest of the region", () => {
    const map = buildMergeMap([{ top: 1, left: 2, bottom: 2, right: 4 }]);

    expect(map.spans.get(key(1, 2))).toEqual({ rowSpan: 2, colSpan: 3 });
    expect(map.covered.has(key(1, 2))).toBe(false);
    expect(map.covered.has(key(1, 3))).toBe(true);
    expect(map.covered.has(key(2, 4))).toBe(true);
    expect(map.covered.size).toBe(5);
  });

  it("ignores single-cell and inverted regions", () => {
    const map = buildMergeMap([
      { top: 0, left: 0, bottom: 0, right: 0 },
      { top: 3, left: 3, bottom: 1, right: 1 },
    ]);
    expect(map.spans.size).toBe(0);
    expect(map.covered.size).toBe(0);
  });
});

describe("frozenOffsets", () => {
  it("accumulates widths after the row-number gutter", () => {
    expect(frozenOffsets([100, 50, null], 2)).toEqual([0, 44, 144]);
  });

  it("uses the default width when the workbook omits one", () => {
    expect(frozenOffsets([null], 1)).toEqual([0, 44]);
  });

  it("is just the gutter when nothing is frozen", () => {
    expect(frozenOffsets([100], 0)).toEqual([0]);
  });
});
