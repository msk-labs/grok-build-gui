import { describe, expect, it } from "vitest";
import {
  createWindowState,
  parseWindowState,
  resolveWindowPlacement,
  type WindowDisplay,
} from "./windowState";

const primary: WindowDisplay = {
  id: 1,
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
};
const secondary: WindowDisplay = {
  id: 2,
  workArea: { x: 1920, y: 0, width: 2560, height: 1400 },
};

describe("resolveWindowPlacement", () => {
  it("centers the default size on first launch", () => {
    expect(
      resolveWindowPlacement(null, [primary], primary, {
        width: 1280,
        height: 840,
      }),
    ).toEqual({
      bounds: { x: 320, y: 100, width: 1280, height: 840 },
      isMaximized: false,
    });
  });

  it("restores normal bounds and maximized state on the saved display", () => {
    const state = createWindowState(
      { x: 2100, y: 100, width: 1400, height: 900 },
      secondary,
      true,
    );

    expect(
      resolveWindowPlacement(state, [primary, secondary], primary, {
        width: 1280,
        height: 840,
      }),
    ).toEqual({
      bounds: { x: 2100, y: 100, width: 1400, height: 900 },
      isMaximized: true,
    });
  });

  it("preserves the display-relative position after displays are rearranged", () => {
    const state = createWindowState(
      { x: 2100, y: 100, width: 1200, height: 800 },
      secondary,
      false,
    );
    const movedSecondary: WindowDisplay = {
      id: 2,
      workArea: { x: -2560, y: 200, width: 2560, height: 1400 },
    };

    expect(
      resolveWindowPlacement(state, [primary, movedSecondary], primary, {
        width: 1280,
        height: 840,
      }).bounds,
    ).toEqual({ x: -2380, y: 300, width: 1200, height: 800 });
  });

  it("keeps the saved size but centers it on primary when a display is gone", () => {
    const state = createWindowState(
      { x: 2100, y: 100, width: 1400, height: 900 },
      secondary,
      false,
    );

    expect(
      resolveWindowPlacement(state, [primary], primary, {
        width: 1280,
        height: 840,
      }).bounds,
    ).toEqual({ x: 260, y: 70, width: 1400, height: 900 });
  });

  it("shrinks and clamps bounds after the work area becomes smaller", () => {
    const state = createWindowState(
      { x: 2100, y: 100, width: 2000, height: 1200 },
      secondary,
      false,
    );
    const smallerSecondary: WindowDisplay = {
      id: 2,
      workArea: { x: 1920, y: 0, width: 1280, height: 720 },
    };

    expect(
      resolveWindowPlacement(state, [primary, smallerSecondary], primary, {
        width: 1280,
        height: 840,
      }).bounds,
    ).toEqual({ x: 1920, y: 0, width: 1280, height: 720 });
  });
});

describe("parseWindowState", () => {
  it("rejects malformed or non-finite bounds", () => {
    expect(parseWindowState({ version: 1 })).toBeNull();
    expect(
      parseWindowState({
        version: 1,
        normalBounds: { x: 0, y: 0, width: Number.NaN, height: 800 },
        displayId: "1",
        displayWorkArea: primary.workArea,
        isMaximized: false,
      }),
    ).toBeNull();
  });
});
