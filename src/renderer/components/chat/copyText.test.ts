// @vitest-environment jsdom

import { expect, it, vi } from "vitest";
import { copyText } from "./copyText";

it("falls back to the copy command when Clipboard API is rejected", async () => {
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(
    navigator,
    "clipboard",
  );
  const execCommandDescriptor = Object.getOwnPropertyDescriptor(
    document,
    "execCommand",
  );
  const writeText = vi.fn().mockRejectedValue(new Error("Permission denied"));
  const execCommand = vi.fn().mockReturnValue(true);

  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: execCommand,
  });

  try {
    await copyText("npm run build");
    expect(writeText).toHaveBeenCalledWith("npm run build");
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
  } finally {
    if (clipboardDescriptor) {
      Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
    } else {
      Reflect.deleteProperty(navigator, "clipboard");
    }
    if (execCommandDescriptor) {
      Object.defineProperty(document, "execCommand", execCommandDescriptor);
    } else {
      Reflect.deleteProperty(document, "execCommand");
    }
  }
});
