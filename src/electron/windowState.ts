export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowDisplay {
  id: string | number;
  workArea: WindowBounds;
}

export interface PersistedWindowState {
  version: 1;
  normalBounds: WindowBounds;
  displayId: string;
  displayWorkArea: WindowBounds;
  isMaximized: boolean;
}

export interface WindowPlacement {
  bounds: WindowBounds;
  isMaximized: boolean;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isBounds(value: unknown): value is WindowBounds {
  if (!value || typeof value !== "object") return false;
  const bounds = value as Partial<WindowBounds>;
  return (
    isFiniteNumber(bounds.x) &&
    isFiniteNumber(bounds.y) &&
    isFiniteNumber(bounds.width) &&
    bounds.width > 0 &&
    isFiniteNumber(bounds.height) &&
    bounds.height > 0
  );
}

export function parseWindowState(value: unknown): PersistedWindowState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Partial<PersistedWindowState>;
  if (
    state.version !== 1 ||
    !isBounds(state.normalBounds) ||
    typeof state.displayId !== "string" ||
    !isBounds(state.displayWorkArea) ||
    typeof state.isMaximized !== "boolean"
  ) {
    return null;
  }
  return state as PersistedWindowState;
}

function fitInsideWorkArea(
  bounds: WindowBounds,
  workArea: WindowBounds,
): WindowBounds {
  const width = Math.min(Math.round(bounds.width), workArea.width);
  const height = Math.min(Math.round(bounds.height), workArea.height);
  const maxX = workArea.x + workArea.width - width;
  const maxY = workArea.y + workArea.height - height;
  return {
    x: Math.min(Math.max(Math.round(bounds.x), workArea.x), maxX),
    y: Math.min(Math.max(Math.round(bounds.y), workArea.y), maxY),
    width,
    height,
  };
}

function centeredBounds(
  size: Pick<WindowBounds, "width" | "height">,
  workArea: WindowBounds,
): WindowBounds {
  const width = Math.min(Math.round(size.width), workArea.width);
  const height = Math.min(Math.round(size.height), workArea.height);
  return {
    x: workArea.x + Math.floor((workArea.width - width) / 2),
    y: workArea.y + Math.floor((workArea.height - height) / 2),
    width,
    height,
  };
}

export function resolveWindowPlacement(
  state: PersistedWindowState | null,
  displays: readonly WindowDisplay[],
  primaryDisplay: WindowDisplay,
  defaultSize: Pick<WindowBounds, "width" | "height">,
): WindowPlacement {
  if (!state) {
    return {
      bounds: centeredBounds(defaultSize, primaryDisplay.workArea),
      isMaximized: false,
    };
  }

  const savedDisplay = displays.find(
    (display) => String(display.id) === state.displayId,
  );
  if (!savedDisplay) {
    return {
      bounds: centeredBounds(state.normalBounds, primaryDisplay.workArea),
      isMaximized: state.isMaximized,
    };
  }

  const translatedBounds = {
    ...state.normalBounds,
    x:
      savedDisplay.workArea.x +
      (state.normalBounds.x - state.displayWorkArea.x),
    y:
      savedDisplay.workArea.y +
      (state.normalBounds.y - state.displayWorkArea.y),
  };
  return {
    bounds: fitInsideWorkArea(translatedBounds, savedDisplay.workArea),
    isMaximized: state.isMaximized,
  };
}

export function createWindowState(
  normalBounds: WindowBounds,
  display: WindowDisplay,
  isMaximized: boolean,
): PersistedWindowState {
  return {
    version: 1,
    normalBounds: { ...normalBounds },
    displayId: String(display.id),
    displayWorkArea: { ...display.workArea },
    isMaximized,
  };
}
