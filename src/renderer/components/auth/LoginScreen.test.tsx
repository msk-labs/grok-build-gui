// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../lib/i18n";
import { LoginScreen } from "./LoginScreen";

void React;

describe("LoginScreen", () => {
  afterEach(cleanup);

  it("offers a non-blocking guest path", () => {
    const onSkip = vi.fn();
    render(
      <LoginScreen
        loading={false}
        signingIn={false}
        error={null}
        onLogin={vi.fn()}
        onSkip={onSkip}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Not now" }));

    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(
        "Continue without Grok and add a third-party model in Settings.",
      ),
    ).toBeTruthy();
  });

  it("shows cancel instead of skip while browser authorization is active", () => {
    render(
      <LoginScreen
        loading={false}
        signingIn
        error={null}
        onLogin={vi.fn()}
        onSkip={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Not now" })).toBeNull();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });
});
