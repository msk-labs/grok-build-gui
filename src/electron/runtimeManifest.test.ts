import { describe, expect, it } from "vitest";
import grokManifest from "../../config/runtime/grok-build.json";

describe("Grok Build runtime manifest", () => {
  it("pins verified Windows artifacts while preserving macOS", () => {
    expect(Object.keys(grokManifest.platforms).sort()).toEqual([
      "darwin-arm64",
      "win32-arm64",
      "win32-x64",
    ]);

    for (const platform of Object.values(grokManifest.platforms)) {
      expect(platform.url).toMatch(/^https:\/\/x\.ai\/cli\/grok-/);
      expect(platform.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(platform.size).toBeGreaterThan(0);
    }
  });

  it("reserves Linux platform names without claiming verified support", () => {
    expect(grokManifest.plannedPlatforms).toEqual({
      "linux-x64": {
        artifactPlatform: "linux-x86_64",
        executable: "grok",
        status: "artifact-metadata-required",
      },
      "linux-arm64": {
        artifactPlatform: "linux-aarch64",
        executable: "grok",
        status: "artifact-metadata-required",
      },
    });
  });
});
