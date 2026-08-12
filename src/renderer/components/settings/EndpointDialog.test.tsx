// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CustomEndpoint,
  CustomEndpointInput,
  EndpointPreset,
  GrokApi,
} from "../../../electron/preload";
import "../../lib/i18n";
import { EndpointDialog } from "./EndpointDialog";

const presets: EndpointPreset[] = [
  {
    id: "custom",
    label: "Custom / relay gateway",
    baseUrl: "",
    apiBackend: "chat_completions",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    apiBackend: "chat_completions",
  },
];

function mockDiscovery(
  discoverEndpointModels: NonNullable<GrokApi["discoverEndpointModels"]>,
) {
  Object.defineProperty(window, "grok", {
    configurable: true,
    value: { discoverEndpointModels } as Partial<GrokApi>,
  });
}

function renderDialog(endpoint: CustomEndpoint | null = null) {
  const onSave = vi.fn(async (_input: CustomEndpointInput) => true);
  const onClose = vi.fn();
  render(
    <EndpointDialog
      presets={presets}
      endpoint={endpoint}
      busy={false}
      onSave={onSave}
      onClose={onClose}
    />,
  );
  return { onSave, onClose };
}

function reasoningCheckbox(): HTMLInputElement {
  return screen.getByRole("checkbox", {
    name: /Supports reasoning effort/,
  }) as HTMLInputElement;
}

describe("EndpointDialog reasoning detection", () => {
  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, "grok");
  });

  it("automatically checks verified reasoning support and saves exact levels", async () => {
    const discoverEndpointModels = vi.fn(async () => ({
      ok: true as const,
      models: [
        {
          id: "deepseek-v4-flash",
          contextWindow: 128_000,
          supportsReasoningEffort: true,
          reasoningEfforts: ["low", "high", "max"],
          defaultReasoningEffort: "high",
        },
      ],
    }));
    mockDiscovery(discoverEndpointModels);
    const { onSave } = renderDialog({
      id: "endpoint-1",
      label: "DeepSeek",
      baseUrl: "https://api.deepseek.com/v1",
      apiBackend: "chat_completions",
      presetId: "deepseek",
      models: [
        {
          id: "deepseek-v4-flash",
          label: "deepseek-v4-flash",
          contextWindow: 128_000,
        },
      ],
      hasApiKey: true,
      supportsReasoningEffort: false,
    });

    fireEvent.click(screen.getByRole("button", { name: "Fetch models" }));
    await waitFor(() =>
      expect(discoverEndpointModels).toHaveBeenCalledTimes(1),
    );
    await screen.findByRole("checkbox", { name: /deepseek-v4-flash/ });
    await waitFor(() => expect(reasoningCheckbox().checked).toBe(true));
    expect(reasoningCheckbox().disabled).toBe(true);
    expect(
      screen.getByText(
        "Automatically enabled for the selected model based on provider documentation.",
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]![0]).toMatchObject({
      presetId: "deepseek",
      supportsReasoningEffort: false,
      models: [
        {
          id: "deepseek-v4-flash",
          supportsReasoningEffort: true,
          reasoningEfforts: ["low", "high", "max"],
          defaultReasoningEffort: "high",
        },
      ],
    });
  });

  it("keeps the manual fallback editable for an unknown relay model", async () => {
    mockDiscovery(
      vi.fn(async () => ({
        ok: true as const,
        models: [{ id: "vendor/new-model", contextWindow: null }],
      })),
    );
    const { onSave } = renderDialog();

    fireEvent.change(screen.getByLabelText("Endpoint URL"), {
      target: { value: "https://relay.example.com/v1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Fetch models" }));
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "vendor/new-model" }),
    );

    expect(reasoningCheckbox().disabled).toBe(false);
    fireEvent.click(reasoningCheckbox());
    expect(reasoningCheckbox().checked).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]![0]).toMatchObject({
      supportsReasoningEffort: true,
      models: [{ id: "vendor/new-model" }],
    });
  });
});
