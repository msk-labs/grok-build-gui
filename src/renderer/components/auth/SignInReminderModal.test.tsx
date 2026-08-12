// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../lib/i18n";
import { SignInReminderModal } from "./SignInReminderModal";

void React;

describe("SignInReminderModal", () => {
  afterEach(cleanup);

  it("offers login or cancel for a selected Grok model", () => {
    const onLogin = vi.fn();
    render(
      <SignInReminderModal
        open
        signingIn={false}
        error={null}
        onCancel={vi.fn()}
        onLogin={onLogin}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Sign in with Grok" }));
    expect(onLogin).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });
});
