// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelState } from "../../../electron/preload";
import "../../lib/i18n";
import { ModelMenu } from "./ComposerMenus";

const MODELS: ModelState = {
  currentModelId: "grok-4",
  currentReasoningEffort: null,
  availableModels: [{ modelId: "grok-4", name: "Grok 4" }],
};

describe("ModelMenu", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("closes the picker and opens custom-model settings", () => {
    const closeMenu = vi.fn();
    const onConfigureModels = vi.fn();

    render(
      <ModelMenu
        menu="model"
        toggleMenu={vi.fn()}
        closeMenu={closeMenu}
        disabled={false}
        models={MODELS}
        onModelChange={vi.fn()}
        onConfigureModels={onConfigureModels}
      />,
    );

    fireEvent.click(
      screen.getByRole("menuitem", { name: "Configure custom model" }),
    );

    expect(closeMenu).toHaveBeenCalledTimes(1);
    expect(onConfigureModels).toHaveBeenCalledTimes(1);
  });

  it("moves the reasoning flyout above the root menu near the viewport bottom", async () => {
    vi.stubGlobal("innerHeight", 240);

    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.classList.contains("composer-model-detail")) {
          return DOMRect.fromRect({ x: 376, y: 104, width: 214, height: 180 });
        }
        if (this.classList.contains("composer-menu-model")) {
          return DOMRect.fromRect({ x: 90, y: 100, width: 278, height: 90 });
        }
        if (this.classList.contains("composer-model-row")) {
          return DOMRect.fromRect({ x: 96, y: 104, width: 266, height: 32 });
        }
        return DOMRect.fromRect();
      },
    );

    const { container } = render(
      <ModelMenu
        menu="model"
        toggleMenu={vi.fn()}
        closeMenu={vi.fn()}
        disabled={false}
        models={{
          currentModelId: "grok-4.5",
          currentReasoningEffort: "high",
          availableModels: [
            {
              modelId: "grok-4.5",
              name: "Grok 4.5",
              supportsReasoningEffort: true,
              reasoningEfforts: [
                { id: "low", value: "low", label: "low" },
                { id: "medium", value: "medium", label: "medium" },
                { id: "high", value: "high", label: "high" },
                { id: "max", value: "max", label: "max" },
              ],
            },
          ],
        }}
        onModelChange={vi.fn()}
      />,
    );

    fireEvent.mouseEnter(
      screen.getByRole("menuitemradio", { name: /Grok 4\.5/ }),
    );

    await waitFor(() => {
      const flyout = container.querySelector<HTMLElement>(
        ".composer-model-detail",
      );
      expect(flyout?.style.top).toBe("-48px");
    });

  });

});
