import { describe, expect, it } from "vitest";
import {
  computerUseMcpEnvironment,
  computerUsePermissionsRequired,
} from "./computerUsePlatform";

describe("computerUsePermissionsRequired", () => {
  it("requires OS permission checks on macOS", () => {
    expect(computerUsePermissionsRequired("darwin")).toBe(true);
  });

  it("does not require extra OS permissions on Windows", () => {
    expect(computerUsePermissionsRequired("win32")).toBe(false);
  });
});

describe("computerUseMcpEnvironment", () => {
  it("enables Windows UI Automation text fallback for desktop control", () => {
    expect(computerUseMcpEnvironment("win32")).toEqual([
      {
        name: "OPEN_COMPUTER_USE_WINDOWS_ALLOW_UIA_TEXT_FALLBACK",
        value: "1",
      },
    ]);
  });

  it("does not add Windows runtime flags on other platforms", () => {
    expect(computerUseMcpEnvironment("darwin")).toEqual([]);
    expect(computerUseMcpEnvironment("linux")).toEqual([]);
  });
});
