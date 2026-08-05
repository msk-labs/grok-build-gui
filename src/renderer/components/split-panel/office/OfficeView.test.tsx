// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GrokApi } from "../../../../electron/preload";
import type {
  OfficeDocument,
  SheetDocument,
} from "../../../../electron/office/types";
import "../../../lib/i18n";
import { OfficeView } from "./OfficeView";

// The layout renderers need a real browser; here we only assert that the
// viewers mount and hand the container bytes over.
const renderAsync = vi.fn(async (_source: unknown) => undefined);
const preview = vi.fn(async (_source: unknown) => undefined);
vi.mock("docx-preview", () => ({ renderAsync: (source: unknown) => renderAsync(source) }));
vi.mock("pptx-preview", () => ({
  init: () => ({ preview, destroy: vi.fn() }),
}));

// jsdom has no layout engine and therefore no ResizeObserver.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

type Api = Window & { grok?: GrokApi };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete (window as Api).grok;
});

function installApi(doc: OfficeDocument | null) {
  const readOfficeDoc = vi.fn().mockResolvedValue(
    doc ? { ok: true, path: "/ws/f", doc } : { ok: false, error: "boom" },
  );
  const writeSheet = vi.fn().mockResolvedValue({ ok: true });
  const openWith = vi.fn().mockResolvedValue({ ok: true });
  (window as Api).grok = {
    readOfficeDoc,
    writeSheet,
    openWith,
  } as unknown as GrokApi;
  return { readOfficeDoc, writeSheet, openWith };
}

const sheet: SheetDocument = {
  kind: "sheet",
  sheetNames: ["Parts", "Owners"],
  sheet: "Parts",
  rows: [
    [{ v: "Report", s: 0 }, { v: "" }],
    [{ v: "name" }, { v: "qty" }],
    [{ v: "bolt" }, { v: "12" }],
  ],
  styles: [{ bold: true, fill: "#1f4e79", color: "#ffffff" }],
  merges: [{ top: 0, left: 0, bottom: 0, right: 1 }],
  columnWidths: [145, null],
  frozen: { rows: 2, cols: 1 },
  truncated: false,
  editable: true,
  styled: true,
};

describe("OfficeView", () => {
  it("renders the workbook's own formatting", async () => {
    installApi(sheet);
    render(<OfficeView root="/ws" path="book.xlsx" />);

    const title = await screen.findByText("Report");
    expect(title.style.background).toBe("rgb(31, 78, 121)");
    expect(title.style.color).toBe("rgb(255, 255, 255)");
    expect(title.style.fontWeight).toBe("600");
    // The merge spans both columns, so the covered cell renders no <td>.
    expect(title).toHaveProperty("colSpan", 2);
  });

  it("applies column widths and freezes the first column", async () => {
    installApi(sheet);
    render(<OfficeView root="/ws" path="book.xlsx" />);

    const cell = await screen.findByText("bolt");
    expect(cell.style.position).toBe("sticky");
    expect(screen.getByText("A").style.width).toBe("145px");
  });

  it("saves an edited cell back through the bridge", async () => {
    const api = installApi(sheet);
    render(<OfficeView root="/ws" path="book.xlsx" />);

    fireEvent.click(await screen.findByText("12"));
    fireEvent.change(screen.getByDisplayValue("12"), {
      target: { value: "13" },
    });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => {
      expect(api.writeSheet).toHaveBeenCalledWith({
        root: "/ws",
        path: "book.xlsx",
        sheet: "Parts",
        rows: [
          ["Report", ""],
          ["name", "qty"],
          ["bolt", "13"],
        ],
      });
    });
  });

  it("offers no save affordance for a read-only format", async () => {
    installApi({ ...sheet, editable: false, styled: false, styles: [] });
    render(<OfficeView root="/ws" path="book.ods" />);

    expect(await screen.findByText("Read-only format")).toBeTruthy();
    fireEvent.click(screen.getByText("bolt"));
    expect(screen.queryByDisplayValue("bolt")).toBeNull();
  });

  it("re-reads the workbook when another sheet is selected", async () => {
    const api = installApi(sheet);
    render(<OfficeView root="/ws" path="book.xlsx" />);

    fireEvent.click(await screen.findByRole("tab", { name: "Owners" }));

    await waitFor(() => {
      expect(api.readOfficeDoc).toHaveBeenLastCalledWith({
        root: "/ws",
        path: "book.xlsx",
        sheet: "Owners",
      });
    });
  });

  it("hands docx bytes to the layout renderer", async () => {
    installApi({ kind: "doc", base64: "UEsDBA==", bytes: 5 });
    render(<OfficeView root="/ws" path="letter.docx" />);

    await waitFor(() => expect(renderAsync).toHaveBeenCalled());
    expect(renderAsync.mock.calls[0]![0]).toBeInstanceOf(Blob);
  });

  it("hands pptx bytes to the layout renderer", async () => {
    installApi({ kind: "slides", base64: "UEsDBA==", bytes: 5 });
    render(<OfficeView root="/ws" path="deck.pptx" />);

    await waitFor(() => expect(preview).toHaveBeenCalled());
    expect(preview.mock.calls[0]![0]).toBeInstanceOf(ArrayBuffer);
  });

  it("falls back to open-externally for legacy containers", async () => {
    const api = installApi(null);
    render(<OfficeView root="/ws" path="old.doc" />);

    expect(api.readOfficeDoc).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Open externally"));
    expect(api.openWith).toHaveBeenCalledWith({
      root: "/ws",
      path: "old.doc",
    });
  });

  it("surfaces a parse failure", async () => {
    installApi(null);
    render(<OfficeView root="/ws" path="broken.xlsx" />);
    expect(await screen.findByText("boom")).toBeTruthy();
  });
});
