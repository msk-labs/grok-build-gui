import { describe, expect, it } from "vitest";
import { scaleSelectionToImage } from "./screenshotGeometry";

describe("scaleSelectionToImage", () => {
  it("converts DIP selection coordinates to image pixels", () => {
    expect(
      scaleSelectionToImage(
        { x: 100, y: 50, width: 400, height: 200 },
        { width: 1000, height: 500 },
        { width: 2000, height: 1000 },
      ),
    ).toEqual({ x: 200, y: 100, width: 800, height: 400 });
  });

  it("keeps the crop inside the captured image", () => {
    expect(
      scaleSelectionToImage(
        { x: 90, y: 90, width: 50, height: 50 },
        { width: 100, height: 100 },
        { width: 1000, height: 1000 },
      ),
    ).toEqual({ x: 900, y: 900, width: 100, height: 100 });
  });

  it("rejects invalid dimensions", () => {
    expect(() =>
      scaleSelectionToImage(
        { x: 0, y: 0, width: 10, height: 10 },
        { width: 0, height: 100 },
        { width: 100, height: 100 },
      ),
    ).toThrow("positive");
  });
});
