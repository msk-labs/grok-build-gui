// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../lib/i18n";
import type { ContextUsage, ModelState } from "../../../electron/preload";
import { ContextMeter, type ContextMeterProps } from "./ContextMeter";

const models: ModelState = {
  currentModelId: "grok-4.5",
  currentReasoningEffort: "high",
  availableModels: [
    { modelId: "grok-4.5", name: "Grok 4.5", contextWindowTokens: 500_000 },
  ],
};

const usage: ContextUsage = {
  sessionId: "s1",
  usedTokens: 50_000,
  modelId: "grok-4.5",
  lastTurn: {
    inputTokens: 49_000,
    outputTokens: 1_000,
    cachedReadTokens: 40_000,
    reasoningTokens: 400,
  },
  session: { totalTokens: 90_000, modelCalls: 3, numTurns: 2 },
};

function setup(overrides: Partial<ContextMeterProps> = {}) {
  const props: ContextMeterProps = {
    menu: "context",
    toggleMenu: vi.fn(),
    disabled: false,
    usage,
    models,
    ...overrides,
  };
  render(<ContextMeter {...props} />);
  return props;
}

describe("ContextMeter", () => {
  afterEach(cleanup);

  it("labels the chip with used / size / percent", () => {
    setup({ menu: null });

    expect(
      screen.getByRole("button", {
        name: "Context window: 50k of 500k used (10%)",
      }),
    ).toBeTruthy();
  });

  it("breaks the last turn down without double counting the cache", () => {
    setup();

    // 49k input = 40k cached + 9k new; 1k reply.
    expect(screen.getByText("40k")).toBeTruthy();
    expect(screen.getByText("9k")).toBeTruthy();
    expect(screen.getByText(/^1k/)).toBeTruthy();
    expect(screen.getByText("450k")).toBeTruthy();
    // Headline splits the size into its own span for the type hierarchy.
    expect(screen.getByText("50k")).toBeTruthy();
    expect(screen.getByText("/ 500k")).toBeTruthy();
  });

  it("says so when the session has not reported usage yet", () => {
    setup({ usage: null });

    expect(
      screen.getByText("No context usage yet — send a message first."),
    ).toBeTruthy();
  });

  it("shows the session rollup once a turn has completed", () => {
    setup();

    expect(
      screen.getByText("Session total 90k · 2 turns · 3 model calls"),
    ).toBeTruthy();
  });
});
