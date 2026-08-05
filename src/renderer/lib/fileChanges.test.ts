import { describe, expect, it } from "vitest";
import { withTurnArtifacts, type FileChange } from "./fileChanges";

const edited: FileChange = {
  path: "/ws/src/app.ts",
  name: "app.ts",
  kind: "edit",
  stats: { added: 3, removed: 1 },
  oldText: "a",
  newText: "b",
  pathOnly: false,
};

describe("withTurnArtifacts", () => {
  it("leaves tool-reported changes alone when nothing was detected", () => {
    expect(withTurnArtifacts([edited], undefined)).toEqual([edited]);
    expect(withTurnArtifacts([edited], [])).toEqual([edited]);
  });

  it("appends detected files as path-only creates", () => {
    const result = withTurnArtifacts([edited], ["report.xlsx"]);

    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({
      path: "report.xlsx",
      name: "report.xlsx",
      kind: "create",
      stats: { added: 0, removed: 0 },
      pathOnly: true,
    });
  });

  it("does not duplicate a file the tools already reported", () => {
    // Tool paths are absolute; the scan reports workspace-relative ones.
    const change: FileChange = { ...edited, path: "/ws/docs/report.xlsx" };

    expect(withTurnArtifacts([change], ["docs/report.xlsx"])).toEqual([change]);
  });

  it("treats ./-prefixed and bare paths as the same file", () => {
    const result = withTurnArtifacts([], ["./a.xlsx", "a.xlsx"]);
    expect(result.map((c) => c.path)).toEqual(["./a.xlsx"]);
  });

  it("keeps a same-named file in a different directory", () => {
    const change: FileChange = { ...edited, path: "/ws/old/report.xlsx" };
    const result = withTurnArtifacts([change], ["new/report.xlsx"]);

    expect(result.map((c) => c.path)).toEqual([
      "/ws/old/report.xlsx",
      "new/report.xlsx",
    ]);
  });
});
