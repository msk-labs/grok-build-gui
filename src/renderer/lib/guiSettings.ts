/**
 * GUI-local settings (persisted in localStorage).
 * Not agent/session config — only control-plane UX prefs.
 */

import {
  STT_LANGUAGE_AUTO,
  STT_LANGUAGE_CHINESE,
  canonicalizeSttLanguage,
} from "./sttLanguage";
import type { UiLanguagePreference } from "./uiLanguage";
import type { TerminalShellPreference } from "../../electron/terminalShell";

/** Built-in terminal window color scheme. */
export type TerminalThemePreference = "dark" | "light";

/**
 * How assistant message bodies are shown in chat.
 * - `rendered` — optimized markdown UI (default)
 * - `raw` — original markdown source text
 */
export type MessageDisplayMode = "rendered" | "raw";

export type GuiSettings = {
  /** App chrome language. `system` resolves against navigator.languages. */
  uiLanguage: UiLanguagePreference;
  /**
   * STT language preference.
   * - `auto` → OS/browser locale; Chinese locales omit wire `language` (free-detect)
   * - `zh` → Chinese free-detect (omit wire language; no English ITN bias)
   * - catalog code (`en`, `ja`, …) → sent on the wire for ITN formatting
   */
  voiceSttLanguage: string;
  /** Embedded terminal pane: dark (macOS-style charcoal) or light. */
  terminalTheme: TerminalThemePreference;
  /** Shell used for newly created embedded terminal sessions. */
  terminalShell: TerminalShellPreference;
  /** Assistant message body: formatted markdown vs raw source. */
  messageDisplayMode: MessageDisplayMode;
};

export const DEFAULT_GUI_SETTINGS: GuiSettings = {
  uiLanguage: "system",
  // System locale: Chinese → free-detect (omit language=en bias); others → catalog/en.
  voiceSttLanguage: STT_LANGUAGE_AUTO,
  // App chrome is light-only (`color-scheme: light`), so a dark terminal reads
  // as a foreign window pasted into the app.
  terminalTheme: "light",
  terminalShell: "system",
  messageDisplayMode: "rendered",
};

const STORAGE_KEY = "grok-gui.settings";

/**
 * Bumped when a default changes in a way stored blobs would otherwise pin.
 * 1 → 2: terminalTheme default dark → light.
 */
const SCHEMA_VERSION = 2;

type GuiSettingsListener = (settings: GuiSettings) => void;
const listeners = new Set<GuiSettingsListener>();

function parseUiLanguage(v: unknown): UiLanguagePreference {
  if (typeof v !== "string") return DEFAULT_GUI_SETTINGS.uiLanguage;
  const normalized = v.trim().replace(/_/g, "-").toLowerCase();
  if (normalized === "system" || normalized === "auto") return "system";
  if (normalized === "en" || normalized.startsWith("en-")) return "en";
  if (
    normalized === "zh" ||
    normalized === "zh-cn" ||
    normalized === "zh-sg" ||
    normalized === "zh-hans" ||
    normalized.startsWith("zh-hans-")
  ) {
    return "zh-CN";
  }
  return DEFAULT_GUI_SETTINGS.uiLanguage;
}

function parseSttLanguagePref(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) {
    return DEFAULT_GUI_SETTINGS.voiceSttLanguage;
  }
  const trimmed = raw.trim();
  if (trimmed.toLowerCase() === STT_LANGUAGE_AUTO) return STT_LANGUAGE_AUTO;
  if (trimmed.toLowerCase() === STT_LANGUAGE_CHINESE || trimmed.toLowerCase().startsWith("zh")) {
    return STT_LANGUAGE_CHINESE;
  }
  return canonicalizeSttLanguage(trimmed);
}

function parseTerminalTheme(
  raw: unknown,
  version: number,
): TerminalThemePreference {
  // Pre-v2 blobs persisted the old `dark` default on every unrelated settings
  // write, so a stored `dark` there is not a deliberate choice — take the new
  // default once. An explicit re-pick after the upgrade writes v2 and sticks.
  if (version < 2 && raw !== "light" && raw !== "white") {
    return DEFAULT_GUI_SETTINGS.terminalTheme;
  }
  if (raw === "light" || raw === "white") return "light";
  if (raw === "dark" || raw === "black") return "dark";
  return DEFAULT_GUI_SETTINGS.terminalTheme;
}

function parseMessageDisplayMode(raw: unknown): MessageDisplayMode {
  if (raw === "raw" || raw === "source" || raw === "markdown") return "raw";
  if (raw === "rendered" || raw === "formatted" || raw === "rich") {
    return "rendered";
  }
  return DEFAULT_GUI_SETTINGS.messageDisplayMode;
}

export function loadGuiSettings(): GuiSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_GUI_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<GuiSettings> & {
      version?: unknown;
      language?: unknown;
      locale?: unknown;
    };
    const version =
      typeof parsed.version === "number" && Number.isFinite(parsed.version)
        ? parsed.version
        : 1;
    return {
      // Accept earlier preference names and locale-shaped values so upgrades
      // do not silently reset an existing Chinese UI to English.
      uiLanguage: parseUiLanguage(
        parsed.uiLanguage ?? parsed.language ?? parsed.locale,
      ),
      voiceSttLanguage: parseSttLanguagePref(parsed.voiceSttLanguage),
      terminalTheme: parseTerminalTheme(parsed.terminalTheme, version),
      terminalShell:
        typeof parsed.terminalShell === "string"
          ? (parsed.terminalShell as TerminalShellPreference)
          : DEFAULT_GUI_SETTINGS.terminalShell,
      messageDisplayMode: parseMessageDisplayMode(parsed.messageDisplayMode),
    };
  } catch {
    return { ...DEFAULT_GUI_SETTINGS };
  }
}

export function saveGuiSettings(settings: GuiSettings): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...settings, version: SCHEMA_VERSION }),
    );
  } catch {
    // Quota / private mode — ignore; in-session state still works.
  }
  for (const listener of listeners) {
    try {
      listener(settings);
    } catch {
      // Subscriber errors must not break save.
    }
  }
}

/** Subscribe to settings writes (same-tab). Returns unsubscribe. */
export function subscribeGuiSettings(listener: GuiSettingsListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
