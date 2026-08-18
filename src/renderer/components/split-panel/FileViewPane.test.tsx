// @vitest-environment jsdom

import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GrokApi } from "../../../electron/preload";
import "../../lib/i18n";
import { FileViewPane } from "./FileViewPane";

type ApiWindow = Window & { grok?: GrokApi };

afterEach(() => {
  delete (window as ApiWindow).grok;
  vi.clearAllMocks();
});

describe("FileViewPane workspace ownership", () => {
  it("uses the root captured by the file tab instead of the live workspace", async () => {
    const readOfficeDoc = vi
      .fn()
      .mockResolvedValue({ ok: false, error: "fixture" });
    (window as ApiWindow).grok = {
      readOfficeDoc,
    } as unknown as GrokApi;

    render(
      <FileViewPane
        view={{
          path: "reports/weekly.xlsx",
          root: "/workspace/owning-session",
          mode: "content",
        }}
        workspaceRoot="/workspace/current-focus"
      />,
    );

    await waitFor(() => {
      expect(readOfficeDoc).toHaveBeenCalledWith({
        root: "/workspace/owning-session",
        path: "reports/weekly.xlsx",
        sheet: undefined,
      });
    });
  });
});
