/**
 * Built-in terminal color schemes for xterm.js.
 * "dark" approximates macOS Terminal Pro: soft charcoal, not pure black.
 */

import type { ITheme } from "@xterm/xterm";
import type { TerminalThemePreference } from "../../lib/guiSettings";

export type TerminalThemeDef = {
  /** Pane chrome / padding fill behind xterm. */
  paneBackground: string;
  xterm: ITheme;
};

/** macOS Terminal–style dark: charcoal window, light text, classic ANSI. */
const DARK: TerminalThemeDef = {
  paneBackground: "#1c1c1e",
  xterm: {
    background: "#1c1c1e",
    foreground: "#f5f5f5",
    cursor: "#f5f5f5",
    cursorAccent: "#1c1c1e",
    selectionBackground: "rgba(90, 150, 255, 0.35)",
    selectionForeground: "#ffffff",
    black: "#000000",
    red: "#c23621",
    green: "#25bc24",
    yellow: "#adad27",
    blue: "#492ee1",
    magenta: "#d338d3",
    cyan: "#33bbc8",
    white: "#cbcccd",
    brightBlack: "#818383",
    brightRed: "#fc391f",
    brightGreen: "#31e722",
    brightYellow: "#eaec23",
    brightBlue: "#5833ff",
    brightMagenta: "#f935f8",
    brightCyan: "#14f0f0",
    brightWhite: "#e9ebeb",
  },
};

/**
 * Light scheme built from the app's own tokens (app.css `:root`) so the pane
 * reads as part of the window rather than an embedded foreign terminal:
 * background `--bg`, text `--text`, selection/cyan `--accent`, red `--danger`.
 * xterm needs literals — it cannot resolve `var()`.
 */
const LIGHT: TerminalThemeDef = {
  paneBackground: "#ffffff",
  xterm: {
    background: "#ffffff",
    foreground: "#2a2c2f",
    cursor: "#2a2c2f",
    cursorAccent: "#ffffff",
    selectionBackground: "rgba(15, 118, 110, 0.22)",
    selectionForeground: "#2a2c2f",
    black: "#2a2c2f",
    red: "#c42b2b",
    green: "#2d7a3a",
    yellow: "#8a6d00",
    blue: "#0b6bcb",
    magenta: "#9b3d8a",
    cyan: "#0f766e",
    white: "#6b6d72",
    brightBlack: "#95979c",
    brightRed: "#dc2626",
    brightGreen: "#3d9a4a",
    brightYellow: "#b45309",
    brightBlue: "#1a7fd4",
    brightMagenta: "#c44eaf",
    brightCyan: "#0d9488",
    brightWhite: "#2a2c2f",
  },
};

export function getTerminalTheme(
  preference: TerminalThemePreference,
): TerminalThemeDef {
  return preference === "dark" ? DARK : LIGHT;
}
