/** Persist browser pane width between reloads. */
const BROWSER_WIDTH_KEY = "grok-gui.browser.width";

export const BROWSER_WIDTH_DEFAULT = 420;
export const BROWSER_WIDTH_MIN = 280;
export const BROWSER_WIDTH_MAX = 720;

export function clampBrowserWidth(px: number): number {
  if (!Number.isFinite(px)) return BROWSER_WIDTH_DEFAULT;
  return Math.min(BROWSER_WIDTH_MAX, Math.max(BROWSER_WIDTH_MIN, Math.round(px)));
}

export function loadBrowserWidth(): number {
  try {
    const raw = localStorage.getItem(BROWSER_WIDTH_KEY);
    if (!raw) return BROWSER_WIDTH_DEFAULT;
    return clampBrowserWidth(Number(raw));
  } catch {
    return BROWSER_WIDTH_DEFAULT;
  }
}

export function saveBrowserWidth(px: number) {
  try {
    localStorage.setItem(BROWSER_WIDTH_KEY, String(clampBrowserWidth(px)));
  } catch {
    // Quota / private mode — ignore; in-session state still works.
  }
}
