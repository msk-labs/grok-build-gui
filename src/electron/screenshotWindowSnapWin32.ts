import { screen } from "electron";
import koffi from "koffi";

export type SnapWindowRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
};

/** EXPERIMENTAL — set false to disable hover-to-window snap. */
export const EXPERIMENTAL_WINDOW_SNAP = true;

type PhysicalRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW = 0x00000080;
const WS_EX_NOACTIVATE = 0x08000000;
const DWMWA_EXTENDED_FRAME_BOUNDS = 9;

const SKIP_CLASSES = new Set([
  "Progman",
  "WorkerW",
  "Shell_TrayWnd",
  "Shell_SecondaryTrayWnd",
  "DV2ControlHost",
  "Windows.UI.Core.CoreWindow",
]);

type Win32Api = {
  EnumWindows: (cb: unknown, lParam: null) => boolean;
  IsWindowVisible: (hwnd: unknown) => boolean;
  IsIconic: (hwnd: unknown) => boolean;
  GetWindowRect: (hwnd: unknown, rect: Buffer) => boolean;
  GetWindowLongW: (hwnd: unknown, index: number) => number;
  GetClassNameW: (hwnd: unknown, buf: Buffer, maxCount: number) => number;
  GetShellWindow: () => unknown;
  DwmGetWindowAttribute: (
    hwnd: unknown,
    attr: number,
    rect: Buffer,
    cbSize: number,
  ) => number;
  EnumWindowsProc: ReturnType<typeof koffi.proto>;
};

let api: Win32Api | null = null;

function loadWin32Api(): Win32Api {
  if (api) return api;

  const user32 = koffi.load("user32.dll");
  const dwmapi = koffi.load("dwmapi.dll");
  const EnumWindowsProc = koffi.proto(
    "bool __stdcall EnumWindowsProc(void *hwnd, void *lParam)",
  );

  api = {
    EnumWindowsProc: EnumWindowsProc as ReturnType<typeof koffi.proto>,
    EnumWindows: user32.func(
      "bool __stdcall EnumWindows(EnumWindowsProc *lpEnumFunc, void *lParam)",
    ) as Win32Api["EnumWindows"],
    IsWindowVisible: user32.func(
      "bool __stdcall IsWindowVisible(void *hWnd)",
    ) as Win32Api["IsWindowVisible"],
    IsIconic: user32.func(
      "bool __stdcall IsIconic(void *hWnd)",
    ) as Win32Api["IsIconic"],
    GetWindowRect: user32.func(
      "bool __stdcall GetWindowRect(void *hWnd, void *lpRect)",
    ) as Win32Api["GetWindowRect"],
    GetWindowLongW: user32.func(
      "int __stdcall GetWindowLongW(void *hWnd, int nIndex)",
    ) as Win32Api["GetWindowLongW"],
    GetClassNameW: user32.func(
      "int __stdcall GetClassNameW(void *hWnd, void *lpClassName, int nMaxCount)",
    ) as Win32Api["GetClassNameW"],
    GetShellWindow: user32.func(
      "void *__stdcall GetShellWindow()",
    ) as Win32Api["GetShellWindow"],
    DwmGetWindowAttribute: dwmapi.func(
      "long __stdcall DwmGetWindowAttribute(void *hwnd, unsigned int dwAttribute, void *pvAttribute, unsigned int cbAttribute)",
    ) as Win32Api["DwmGetWindowAttribute"],
  };
  return api;
}

function readRect(buf: Buffer): PhysicalRect {
  const left = buf.readInt32LE(0);
  const top = buf.readInt32LE(4);
  const right = buf.readInt32LE(8);
  const bottom = buf.readInt32LE(12);
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

function tryVisibleFrame(winapi: Win32Api, hwnd: unknown): PhysicalRect | null {
  const buf = Buffer.alloc(16);
  if (
    winapi.DwmGetWindowAttribute(
      hwnd,
      DWMWA_EXTENDED_FRAME_BOUNDS,
      buf,
      16,
    ) === 0
  ) {
    return readRect(buf);
  }
  if (!winapi.GetWindowRect(hwnd, buf)) return null;
  return readRect(buf);
}

function classNameOf(winapi: Win32Api, hwnd: unknown): string {
  const buf = Buffer.alloc(512);
  const n = winapi.GetClassNameW(hwnd, buf, 256);
  if (n <= 0) return "";
  return buf.toString("utf16le", 0, n * 2);
}

/** In-process enum; Electron is DPI-aware → physical pixels. */
function listWindowsPhysical(): PhysicalRect[] {
  const winapi = loadWin32Api();
  const shell = winapi.GetShellWindow();
  const items: PhysicalRect[] = [];

  const callback = koffi.register((hwnd: unknown, _lParam: unknown) => {
    try {
      if (hwnd === shell) return true;
      if (!winapi.IsWindowVisible(hwnd) || winapi.IsIconic(hwnd)) return true;
      const ex = winapi.GetWindowLongW(hwnd, GWL_EXSTYLE);
      if ((ex & WS_EX_TOOLWINDOW) !== 0) return true;
      if ((ex & WS_EX_NOACTIVATE) !== 0) return true;
      const cls = classNameOf(winapi, hwnd);
      if (SKIP_CLASSES.has(cls)) return true;
      const frame = tryVisibleFrame(winapi, hwnd);
      if (!frame || frame.width < 48 || frame.height < 48) return true;
      items.push(frame);
    } catch {
      // keep enumerating
    }
    return true;
  }, koffi.pointer(loadWin32Api().EnumWindowsProc));

  try {
    winapi.EnumWindows(callback, null);
  } finally {
    koffi.unregister(callback);
  }
  return items;
}

function physicalRectToDip(rect: PhysicalRect): SnapWindowRect {
  const tl = screen.screenToDipPoint({ x: rect.x, y: rect.y });
  const br = screen.screenToDipPoint({
    x: rect.x + rect.width,
    y: rect.y + rect.height,
  });
  return {
    x: Math.round(tl.x),
    y: Math.round(tl.y),
    width: Math.max(1, Math.round(br.x - tl.x)),
    height: Math.max(1, Math.round(br.y - tl.y)),
    title: "",
  };
}

/**
 * Snapshot visible top-level windows in DIP screen coordinates (Z-order top first).
 * Fast in-process Win32 via koffi; runs async-friendly (sync work, Promise wrapper).
 */
export async function listSnapWindowRectsDip(): Promise<SnapWindowRect[]> {
  if (process.platform !== "win32" || !EXPERIMENTAL_WINDOW_SNAP) {
    return [];
  }
  try {
    const t0 = performance.now();
    const physical = listWindowsPhysical();
    const result = physical.map(physicalRectToDip);
    console.info(
      `[grok-gui] window snap Win32: count=${result.length} elapsed=${Math.round(performance.now() - t0)}ms sample=${JSON.stringify(result.slice(0, 2))}`,
    );
    return result;
  } catch (error) {
    console.warn(
      "[grok-gui] window snap Win32 failed:",
      error instanceof Error ? error.message : error,
    );
    return [];
  }
}
