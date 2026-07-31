/** Host OS used for window-chrome layout (macOS traffic lights vs native title bar). */
export type HostPlatform = "darwin" | "win32" | "linux";

function platformFromUserAgent(): HostPlatform {
  const p = (navigator.platform || "").toLowerCase();
  const ua = (navigator.userAgent || "").toLowerCase();
  if (p.includes("mac") || ua.includes("mac os")) return "darwin";
  if (p.includes("win") || ua.includes("windows")) return "win32";
  return "linux";
}

/** Prefer preload `process.platform`; fall back to UA when preload is missing. */
export function detectHostPlatform(): HostPlatform {
  const fromApi = window.grok?.platform;
  if (fromApi === "darwin" || fromApi === "win32" || fromApi === "linux") {
    return fromApi;
  }
  return platformFromUserAgent();
}

/** Stamp `html[data-platform]` so CSS can adapt chrome without JS per-component. */
export function applyHostPlatformDataset(): HostPlatform {
  const platform = detectHostPlatform();
  document.documentElement.dataset.platform = platform;
  return platform;
}

/**
 * Windows only: keep `html[data-maximized]` in sync so restored windows can use
 * CSS border-radius while maximized fills the screen square.
 */
export function applyWindowMaximizedDataset(): (() => void) | undefined {
  if (detectHostPlatform() !== "win32") return undefined;
  const root = document.documentElement;
  const set = (maximized: boolean) => {
    root.dataset.maximized = maximized ? "true" : "false";
  };
  set(false);
  void window.grok?.getWindowMaximized?.().then(set);
  return window.grok?.onWindowMaximized?.(set);
}
