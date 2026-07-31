// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../lib/i18n";
import { DEFAULT_GUI_SETTINGS } from "../../lib/guiSettings";
import { SettingsDialog } from "./SettingsDialog";
import type { AppUpdate } from "../../hooks/useAppUpdate";

const NO_UPDATE: AppUpdate = {
  status: null,
  actionable: false,
  percent: null,
  checking: false,
  check: async () => {},
  download: async () => {},
  install: async () => {},
};

function renderDialog(overrides?: { onClose?: () => void }) {
  const onChange = vi.fn();
  const onClose = overrides?.onClose ?? vi.fn();
  render(
    <SettingsDialog
      open
      settings={DEFAULT_GUI_SETTINGS}
      onChange={onChange}
      onClose={onClose}
      update={NO_UPDATE}
    />,
  );
  return { onChange, onClose };
}

describe("SettingsDialog", () => {
  // No `globals: true` in this project, so auto-cleanup is not registered and
  // dialogs from earlier cases would collide on `getByRole("dialog")`.
  afterEach(cleanup);

  it("renders nothing while closed", () => {
    render(
      <SettingsDialog
        open={false}
        settings={DEFAULT_GUI_SETTINGS}
        onChange={vi.fn()}
        onClose={vi.fn()}
        update={NO_UPDATE}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens on the first category and swaps the body when another is picked", () => {
    renderDialog();

    // Interface category: language row, and nothing from the other categories.
    expect(screen.getByLabelText("Language")).toBeTruthy();
    expect(screen.queryByLabelText("Terminal theme")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));

    expect(screen.getByLabelText("Terminal theme")).toBeTruthy();
    expect(screen.queryByLabelText("Language")).toBeNull();
  });

  it("reports edits without mutating the passed settings", () => {
    const { onChange } = renderDialog();

    fireEvent.change(screen.getByLabelText("Language"), {
      target: { value: "zh-CN" },
    });

    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_GUI_SETTINGS,
      uiLanguage: "zh-CN",
    });
    expect(DEFAULT_GUI_SETTINGS.uiLanguage).toBe("system");
  });

  it("closes on Escape and on a backdrop click, but not from inside", () => {
    const onClose = vi.fn();
    renderDialog({ onClose });

    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.mouseDown(document.querySelector(".modal-backdrop")!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
