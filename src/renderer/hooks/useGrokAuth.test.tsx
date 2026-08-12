// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../lib/i18n";
import type { GrokAccount } from "../../electron/preload";
import { useGrokAuth } from "./useGrokAuth";

const guestAccount: GrokAccount = {
  loggedIn: false,
  email: null,
  name: null,
  firstName: null,
  lastName: null,
  userId: null,
  teamId: null,
  tier: null,
  planLabel: "Not signed in",
  profileImageUrl: null,
  authMode: null,
  expiresAt: null,
};

describe("useGrokAuth guest mode", () => {
  beforeEach(() => {
    window.localStorage.clear();
    Object.defineProperty(window, "grok", {
      configurable: true,
      value: {
        getGrokAccount: vi.fn().mockResolvedValue(guestAccount),
      },
    });
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("persists an explicit decision to continue without Grok", async () => {
    const first = renderHook(() => useGrokAuth());
    await waitFor(() => expect(first.result.current.loading).toBe(false));

    act(() => first.result.current.skipLogin());
    expect(first.result.current.skippedLogin).toBe(true);
    first.unmount();

    const second = renderHook(() => useGrokAuth());
    expect(second.result.current.skippedLogin).toBe(true);
    second.unmount();
  });
});
