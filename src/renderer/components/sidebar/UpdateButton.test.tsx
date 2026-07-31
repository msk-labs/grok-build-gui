// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../lib/i18n";
import type { UpdateStatus } from "../../../electron/preload";
import type { AppUpdate } from "../../hooks/useAppUpdate";
import { UpdateButton } from "./UpdateButton";

function show(status: UpdateStatus | null) {
  const actions = {
    check: vi.fn(async () => {}),
    download: vi.fn(async () => {}),
    install: vi.fn(async () => {}),
  };
  const update: AppUpdate = {
    status,
    actionable:
      status?.state === "available" ||
      status?.state === "downloading" ||
      status?.state === "downloaded",
    percent: status?.state === "downloading" ? status.percent : null,
    checking: status?.state === "checking",
    ...actions,
  };
  const { container } = render(<UpdateButton update={update} />);
  return { ...actions, container };
}

describe("UpdateButton", () => {
  afterEach(cleanup);

  it.each([
    ["no status yet", null],
    ["up to date", { state: "none", version: "1.0.0", checkedAt: 1 }],
    ["checking", { state: "checking", version: "1.0.0" }],
    [
      "no release feed",
      { state: "unsupported", version: "1.0.0", reason: "dev" },
    ],
  ] as const)("stays out of the footer when %s", (_label, status) => {
    const { container } = show(status as UpdateStatus | null);
    expect(container.firstChild).toBeNull();
  });

  it("offers the download once an update is available", () => {
    const { download } = show({
      state: "available",
      version: "1.0.0",
      nextVersion: "1.1.0",
    });

    fireEvent.click(screen.getByRole("button"));
    expect(download).toHaveBeenCalledTimes(1);
  });

  it("shows progress as a ring and is not clickable mid-download", () => {
    const { container, download } = show({
      state: "downloading",
      version: "1.0.0",
      nextVersion: "1.1.0",
      percent: 40,
      transferred: 4,
      total: 10,
      bytesPerSecond: 1,
    });

    expect(screen.getByText("40%")).toBeTruthy();
    const fill = container.querySelector(".update-btn-ring-fill");
    const circumference = 2 * Math.PI * 9;
    // 40% done → 60% of the ring still hidden.
    expect(Number(fill?.getAttribute("stroke-dashoffset"))).toBeCloseTo(
      circumference * 0.6,
      5,
    );

    fireEvent.click(screen.getByRole("button"));
    expect(download).not.toHaveBeenCalled();
  });

  it("falls back to a restart button if the auto-install has not fired", () => {
    const { install } = show({
      state: "downloaded",
      version: "1.0.0",
      nextVersion: "1.1.0",
    });

    fireEvent.click(screen.getByRole("button"));
    expect(install).toHaveBeenCalledTimes(1);
  });
});
