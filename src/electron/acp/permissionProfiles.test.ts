import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PERMISSION_PROFILE,
  PermissionProfileStore,
  profileForMode,
} from "./permissionProfiles";

function testFile(): string {
  return join(mkdtempSync(join(tmpdir(), "grok-permissions-")), "profiles.json");
}

describe("permission profiles", () => {
  it("uses workspace plus auto by default", () => {
    const store = new PermissionProfileStore(testFile());
    expect(store.getDefault()).toEqual(DEFAULT_PERMISSION_PROFILE);
    expect(profileForMode("auto")).toEqual({
      sandbox: "workspace",
      approval: "auto",
    });
  });

  it("maps full access to an explicit off sandbox", () => {
    expect(profileForMode("always-approve")).toEqual({
      sandbox: "off",
      approval: "always-approve",
    });
  });

  it("persists defaults and session-scoped profiles", () => {
    const file = testFile();
    const store = new PermissionProfileStore(file);
    store.setDefault({ sandbox: "off", approval: "always-approve" });
    store.setSession("session-1", { sandbox: "strict", approval: "ask" });

    const reloaded = new PermissionProfileStore(file);
    expect(reloaded.getDefault()).toEqual({
      sandbox: "off",
      approval: "always-approve",
    });
    expect(reloaded.getSession("session-1")).toEqual({
      sandbox: "strict",
      approval: "ask",
    });
    expect(JSON.parse(readFileSync(file, "utf8")).version).toBe(1);
  });

  it("drops invalid persisted entries instead of widening access", () => {
    const file = testFile();
    const store = new PermissionProfileStore(file);
    store.setSession("valid", { sandbox: "workspace", approval: "ask" });
    const data = JSON.parse(readFileSync(file, "utf8"));
    data.defaultProfile = { sandbox: "unknown", approval: "auto" };
    data.sessions.invalid = { sandbox: "off", approval: "anything" };
    writeFileSync(file, JSON.stringify(data), "utf8");

    const reloaded = new PermissionProfileStore(file);
    expect(reloaded.getDefault()).toEqual(DEFAULT_PERMISSION_PROFILE);
    expect(reloaded.getSession("valid")).toEqual({
      sandbox: "workspace",
      approval: "ask",
    });
    expect(reloaded.getSession("invalid")).toBeNull();
  });
});
