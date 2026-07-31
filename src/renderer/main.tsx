import { createRoot } from "react-dom/client";
import { App } from "./App";
import { loadGuiSettings } from "./lib/guiSettings";
import i18n from "./lib/i18n";
import {
  applyHostPlatformDataset,
  applyWindowMaximizedDataset,
} from "./lib/platform";
import { resolveUiLanguage } from "./lib/uiLanguage";
import "./styles/app.css";

// Before paint: adapt chrome for macOS traffic lights vs Windows/Linux title bar.
applyHostPlatformDataset();
// Windows: track maximize for restored-only window corner radius.
applyWindowMaximizedDataset();

const initialLanguage = resolveUiLanguage(loadGuiSettings().uiLanguage);
void i18n.changeLanguage(initialLanguage);
document.documentElement.lang = initialLanguage;

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Missing #root element");
}

// Visible fallback if React never mounts (helps debug pure black screens).
const loadingFallback = document.createElement("div");
loadingFallback.style.cssText =
  "color:#6b6b76;font:14px system-ui;padding:24px";
loadingFallback.textContent = i18n.t("common.loading");
rootEl.replaceChildren(loadingFallback);

// No StrictMode: it double-invokes effects and races Electron agent connect
// (spawn/kill), which left the session list empty until a manual "New chat".
createRoot(rootEl).render(<App />);
