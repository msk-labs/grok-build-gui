import type { SplitPlacement } from "./types";

type SizeConfig = {
  key: string;
  legacyKeys?: readonly string[];
  defaultPx: number;
  min: number;
  max: number;
  /** Cap as fraction of viewport (height for bottom, width for right). */
  viewportFrac?: number;
};

const CONFIG: Record<SplitPlacement, SizeConfig> = {
  right: {
    key: "grok-gui.rightPanel.width",
    legacyKeys: ["grok-gui.browser.width"],
    defaultPx: 420,
    min: 280,
    max: 720,
  },
  bottom: {
    key: "grok-gui.bottomTerminal.height",
    defaultPx: 240,
    min: 120,
    max: 720,
    viewportFrac: 0.7,
  },
};

function viewportCap(placement: SplitPlacement, max: number): number {
  const frac = CONFIG[placement].viewportFrac;
  if (!frac || typeof window === "undefined") return max;
  const edge =
    placement === "bottom" ? window.innerHeight : window.innerWidth;
  if (edge <= 0) return max;
  return Math.min(max, Math.floor(edge * frac));
}

export function sizeLimits(placement: SplitPlacement): {
  min: number;
  max: number;
  defaultPx: number;
} {
  const c = CONFIG[placement];
  let max = viewportCap(placement, c.max);
  max = Math.max(max, c.min);
  return { min: c.min, max, defaultPx: c.defaultPx };
}

export function clampPanelSize(placement: SplitPlacement, px: number): number {
  const { min, max, defaultPx } = sizeLimits(placement);
  if (!Number.isFinite(px)) return defaultPx;
  return Math.min(max, Math.max(min, Math.round(px)));
}

export function loadPanelSize(placement: SplitPlacement): number {
  const c = CONFIG[placement];
  try {
    let raw = localStorage.getItem(c.key);
    if (!raw && c.legacyKeys) {
      for (const k of c.legacyKeys) {
        raw = localStorage.getItem(k);
        if (raw) break;
      }
    }
    if (!raw) return c.defaultPx;
    return clampPanelSize(placement, Number(raw));
  } catch {
    return c.defaultPx;
  }
}

export function savePanelSize(placement: SplitPlacement, px: number) {
  try {
    localStorage.setItem(
      CONFIG[placement].key,
      String(clampPanelSize(placement, px)),
    );
  } catch {
    // Quota / private mode — ignore.
  }
}
