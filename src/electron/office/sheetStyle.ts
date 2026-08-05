/**
 * Translate ExcelJS cell formatting into the flat `CellStyle` the grid renders.
 *
 * Only formatting with an unambiguous CSS equivalent is carried over. Theme and
 * indexed palette colours are dropped rather than guessed: an absent colour
 * renders as the default, while a wrong one is actively misleading.
 */
import type { CellStyle } from "./types.js";

type ExcelColor = { argb?: string; theme?: number; indexed?: number };

type ExcelCellLike = {
  font?: {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean | string;
    strike?: boolean;
    size?: number;
    name?: string;
    color?: ExcelColor;
  };
  fill?: {
    type?: string;
    pattern?: string;
    fgColor?: ExcelColor;
  };
  alignment?: {
    horizontal?: string;
    vertical?: string;
    wrapText?: boolean;
  };
  border?: Record<string, { style?: string } | undefined>;
};

/** `FF4472C4` (aarrggbb) → `#4472c4`. Alpha is dropped; the grid is opaque. */
export function toCssColor(color: ExcelColor | undefined): string | undefined {
  const argb = color?.argb;
  if (typeof argb !== "string") return undefined;
  const hex = argb.trim().toLowerCase();
  if (hex.length === 8) return `#${hex.slice(2)}`;
  if (hex.length === 6) return `#${hex}`;
  return undefined;
}

/**
 * Excel column widths count characters of the default font; Excel's own
 * conversion is `px = 7 * chars + 5`.
 */
export function columnWidthToPx(width: number | undefined): number | null {
  if (typeof width !== "number" || !Number.isFinite(width) || width <= 0) {
    return null;
  }
  return Math.round(width * 7 + 5);
}

function horizontal(value: string | undefined): CellStyle["align"] {
  if (value === "center" || value === "centerContinuous") return "center";
  if (value === "right") return "right";
  if (value === "left") return "left";
  return undefined;
}

function vertical(value: string | undefined): CellStyle["valign"] {
  if (value === "middle") return "middle";
  if (value === "bottom") return "bottom";
  if (value === "top") return "top";
  return undefined;
}

/** Any border style at all becomes a plain 1px line — weights are not modelled. */
function borders(cell: ExcelCellLike): CellStyle["border"] {
  const edges = { top: false, right: false, bottom: false, left: false };
  let any = false;
  for (const side of ["top", "right", "bottom", "left"] as const) {
    if (cell.border?.[side]?.style) {
      edges[side] = true;
      any = true;
    }
  }
  return any ? edges : undefined;
}

/** `undefined` when the cell carries no formatting worth sending. */
export function cellStyleOf(cell: ExcelCellLike): CellStyle | undefined {
  const style: CellStyle = {};

  if (cell.font?.bold) style.bold = true;
  if (cell.font?.italic) style.italic = true;
  if (cell.font?.underline) style.underline = true;
  if (cell.font?.strike) style.strike = true;
  if (typeof cell.font?.size === "number") style.fontSize = cell.font.size;
  if (cell.font?.name) style.fontName = cell.font.name;

  const color = toCssColor(cell.font?.color);
  if (color) style.color = color;

  // Only solid pattern fills map cleanly; gradients and hatches do not.
  if (cell.fill?.type === "pattern" && cell.fill.pattern === "solid") {
    const fill = toCssColor(cell.fill.fgColor);
    if (fill) style.fill = fill;
  }

  const align = horizontal(cell.alignment?.horizontal);
  if (align) style.align = align;
  const valign = vertical(cell.alignment?.vertical);
  if (valign) style.valign = valign;
  if (cell.alignment?.wrapText) style.wrap = true;

  const border = borders(cell);
  if (border) style.border = border;

  return Object.keys(style).length > 0 ? style : undefined;
}

/**
 * Interns styles so each distinct format is sent once. Sheets reuse a handful
 * of formats across thousands of cells.
 */
export class StyleTable {
  private readonly index = new Map<string, number>();
  readonly styles: CellStyle[] = [];

  intern(style: CellStyle | undefined): number | undefined {
    if (!style) return undefined;
    const key = JSON.stringify(style);
    const existing = this.index.get(key);
    if (existing !== undefined) return existing;
    const next = this.styles.length;
    this.styles.push(style);
    this.index.set(key, next);
    return next;
  }
}

/** `A1:C3` → 0-based inclusive bounds; `null` when the range is unparseable. */
export function parseRange(range: string): {
  top: number;
  left: number;
  bottom: number;
  right: number;
} | null {
  const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i.exec(range.trim());
  if (!match) return null;
  const [, c1, r1, c2, r2] = match;
  return {
    top: Number(r1) - 1,
    left: columnIndex(c1!),
    bottom: Number(r2) - 1,
    right: columnIndex(c2!),
  };
}

/** `A` → 0, `AA` → 26. */
function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}
