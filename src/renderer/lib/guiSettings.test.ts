// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { loadGuiSettings, saveGuiSettings } from "./guiSettings";

const STORAGE_KEY = "grok-gui.settings";

describe("terminalTheme preference", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to light so the pane matches the light app chrome", () => {
    expect(loadGuiSettings().terminalTheme).toBe("light");
  });

  it("drops the dark default that pre-v2 blobs persisted implicitly", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ uiLanguage: "zh-CN", terminalTheme: "dark" }),
    );
    const loaded = loadGuiSettings();
    expect(loaded.terminalTheme).toBe("light");
    // Migration is scoped to the theme — other prefs survive.
    expect(loaded.uiLanguage).toBe("zh-CN");
  });

  it("keeps dark once it is picked after the upgrade", () => {
    saveGuiSettings({ ...loadGuiSettings(), terminalTheme: "dark" });
    expect(loadGuiSettings().terminalTheme).toBe("dark");
  });

  it("honours light chosen before the upgrade", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ terminalTheme: "light" }));
    expect(loadGuiSettings().terminalTheme).toBe("light");
  });
});
