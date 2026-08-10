import { describe, expect, it } from "vitest";
import { BRAND_LOGO_PATHS } from "./brandLogos";
import { BRANDS, type BrandId } from "./modelBrand";

describe("BRAND_LOGO_PATHS", () => {
  it("only carries ids the brand table knows", () => {
    for (const id of Object.keys(BRAND_LOGO_PATHS)) {
      expect(BRANDS[id as BrandId]).toBeDefined();
    }
  });

  it("has a logo for every vendor except the neutral fallback", () => {
    const missing = (Object.keys(BRANDS) as BrandId[]).filter(
      (id) => id !== "generic" && !BRAND_LOGO_PATHS[id],
    );
    expect(missing).toEqual([]);
  });

  it("holds non-empty path data drawn on the shared 24x24 grid", () => {
    for (const [id, paths] of Object.entries(BRAND_LOGO_PATHS)) {
      expect(paths, id).toBeTruthy();
      expect(paths!.length, id).toBeGreaterThan(0);
      for (const d of paths!) {
        // A path must start with a move command to render at all.
        expect(d.trim().charAt(0).toLowerCase(), id).toBe("m");
      }
    }
  });
});
