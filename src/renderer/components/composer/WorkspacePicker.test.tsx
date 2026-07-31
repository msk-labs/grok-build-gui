// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../lib/i18n";
import { WorkspacePicker, type WorkspaceProps } from "./WorkspacePicker";

const RECENTS = [
  { cwd: "/work/alpha", at: 2 },
  { cwd: "/work/beta", at: 1 },
];

function setup(overrides?: Partial<WorkspaceProps>) {
  const props = {
    cwd: "",
    canChange: true,
    isTaskMode: true,
    onPick: vi.fn(),
    onSelectRecent: vi.fn(),
    onForgetRecent: vi.fn(),
    recents: RECENTS,
    ...overrides,
  } satisfies WorkspaceProps;
  render(<WorkspacePicker workspace={props} disabled={false} />);
  return props;
}

describe("WorkspacePicker history", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("opens the OS dialog directly when there is no history", () => {
    const props = setup({ recents: [] });

    fireEvent.click(screen.getByRole("button", { name: /Select folder/ }));

    expect(screen.queryByRole("menu")).toBeNull();
    // Deferred so the menu can unmount before the dialog takes focus.
    return waitFor(() => expect(props.onPick).toHaveBeenCalledTimes(1));
  });

  it("lists recent folders and adopts the picked one", async () => {
    vi.stubGlobal("grok", { listDir: vi.fn().mockResolvedValue({ ok: true }) });
    const props = setup();

    fireEvent.click(screen.getByRole("button", { name: /Select folder/ }));
    expect(screen.getByRole("menu")).toBeTruthy();

    fireEvent.click(screen.getByRole("menuitem", { name: /\/work\/alpha/ }));

    await waitFor(() =>
      expect(props.onSelectRecent).toHaveBeenCalledWith("/work/alpha"),
    );
    expect(props.onPick).not.toHaveBeenCalled();
  });

  it("drops a folder that no longer exists instead of adopting it", async () => {
    vi.stubGlobal("grok", {
      listDir: vi.fn().mockResolvedValue({ ok: false, error: "ENOENT" }),
    });
    const props = setup();

    fireEvent.click(screen.getByRole("button", { name: /Select folder/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /\/work\/alpha/ }));

    await waitFor(() =>
      expect(props.onForgetRecent).toHaveBeenCalledWith("/work/alpha"),
    );
    expect(props.onSelectRecent).not.toHaveBeenCalled();
    expect(screen.getByText("Folder no longer exists")).toBeTruthy();
  });

  it("still offers the OS dialog below the history", async () => {
    const props = setup();

    fireEvent.click(screen.getByRole("button", { name: /Select folder/ }));
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Choose another folder…" }),
    );

    await waitFor(() => expect(props.onPick).toHaveBeenCalledTimes(1));
  });

  it("shows no picker menu once the session locks the workspace", () => {
    setup({ canChange: false, cwd: "/work/alpha", isTaskMode: false });

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Locked")).toBeTruthy();
  });
});
