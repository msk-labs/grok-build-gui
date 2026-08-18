// @vitest-environment jsdom

import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "../../lib/i18n";
import type { LocalSession } from "../../types/chat";
import { SessionItem } from "./SessionItem";

const session: LocalSession = {
  id: "session-1",
  title: "Original title",
  cwd: "/workspace",
  createdAt: 1,
  messages: [],
  historyReady: true,
};

function props() {
  return {
    session,
    active: false,
    menuOpen: false,
    renaming: false,
    disabled: false,
    onSelect: vi.fn(),
    onOpenMenu: vi.fn(),
    onRename: vi.fn(),
    onRenameCommit: vi.fn(),
    onRenameCancel: vi.fn(),
    onDelete: vi.fn(),
  };
}

describe("SessionItem rename", () => {
  it("offers rename alongside delete in the session menu", () => {
    const itemProps = { ...props(), menuOpen: true };
    const view = render(<SessionItem {...itemProps} />);

    fireEvent.click(view.getByRole("button", { name: "Rename session" }));

    expect(itemProps.onRename).toHaveBeenCalledWith("session-1");
    expect(
      view.getByRole("button", { name: "Delete session" }),
    ).toBeTruthy();
  });

  it("commits an inline title with Enter", () => {
    const itemProps = { ...props(), renaming: true };
    const view = render(<SessionItem {...itemProps} />);
    const input = view.getByRole("textbox", { name: "Rename session" });

    fireEvent.change(input, { target: { value: "  New title  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(itemProps.onRenameCommit).toHaveBeenCalledWith(
      "session-1",
      "New title",
    );
  });
});
