// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSplitTabs } from "./useSplitTabs";
import type { SplitEntry } from "./types";

function setup(entry: SplitEntry = "home") {
  const onCollapse = vi.fn();
  const view = renderHook(
    ({ closeFileViewsKey }: { closeFileViewsKey: number }) =>
      useSplitTabs({
        placement: "right",
        entry,
        open: true,
        size: 320,
        focusTool: null,
        closeFileViewsKey,
        onCollapse,
      }),
    { initialProps: { closeFileViewsKey: 0 } },
  );
  return { ...view, onCollapse };
}

function openFileView(
  result: { current: ReturnType<typeof useSplitTabs> },
  path: string,
) {
  act(() => {
    result.current.openTool("fileview", {
      fileView: { path, mode: "diff", oldText: "ONE.", newText: "TWO." },
    });
  });
}

describe("useSplitTabs file views on session switch", () => {
  it("closes file views and collapses the panel when they were the only tabs", () => {
    const { result, rerender, onCollapse } = setup();
    openFileView(result, "/tmp/alpha.txt");
    expect(result.current.tabs).toHaveLength(1);

    rerender({ closeFileViewsKey: 1 });

    expect(result.current.tabs).toHaveLength(0);
    expect(result.current.activeId).toBeNull();
    expect(onCollapse).toHaveBeenCalled();
  });

  it("closes every file view, not just the active one", () => {
    const { result, rerender } = setup();
    openFileView(result, "/tmp/alpha.txt");
    openFileView(result, "/tmp/beta.txt");
    expect(result.current.tabs).toHaveLength(2);

    rerender({ closeFileViewsKey: 1 });

    expect(result.current.tabs).toHaveLength(0);
  });

  it("keeps tabs that own a live process and focuses one of them", () => {
    const { result, rerender, onCollapse } = setup();
    act(() => result.current.openTool("terminal"));
    openFileView(result, "/tmp/alpha.txt");
    const terminalId = result.current.tabs.find(
      (t) => t.tool === "terminal",
    )!.id;
    // The file view is active — closing it must hand focus to the terminal.
    expect(result.current.activeId).not.toBe(terminalId);

    rerender({ closeFileViewsKey: 1 });

    expect(result.current.tabs.map((t) => t.tool)).toEqual(["terminal"]);
    expect(result.current.activeId).toBe(terminalId);
    expect(onCollapse).not.toHaveBeenCalled();
  });

  it("leaves tabs alone on the first render", () => {
    const { result, rerender, onCollapse } = setup();
    openFileView(result, "/tmp/alpha.txt");

    // Same key — an unrelated re-render must not retire the view.
    rerender({ closeFileViewsKey: 0 });

    expect(result.current.tabs).toHaveLength(1);
    expect(onCollapse).not.toHaveBeenCalled();
  });
});
