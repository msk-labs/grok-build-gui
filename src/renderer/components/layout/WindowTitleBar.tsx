import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";

/** Keep in sync with main-process `AppMenuId` / preload `popupAppMenu`. */
type AppMenuId = "file" | "edit" | "view" | "window" | "help";

type Props = {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
};

/** Lucide PanelLeft — collapse / expand the session sidebar. */
function PanelLeftIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
    </svg>
  );
}

const MENU_IDS: AppMenuId[] = ["file", "edit", "view", "window", "help"];

/**
 * Windows-only custom title bar (Codex / ChatGPT-style):
 * [collapse] [File] [Edit] [View] [Window] [Help] …… native min/max/close
 *
 * Mounted as a sibling of `.app` inside `.app-shell` so drag regions work.
 * Caption buttons come from Electron `titleBarOverlay`. Not rendered on macOS.
 */
export function WindowTitleBar({
  sidebarCollapsed,
  onToggleSidebar,
}: Props) {
  const { t } = useTranslation();

  function openMenu(
    menuId: AppMenuId,
    event: MouseEvent<HTMLButtonElement>,
  ) {
    const rect = event.currentTarget.getBoundingClientRect();
    // DIP coords relative to the window content — Electron submenu.popup uses these.
    void window.grok?.popupAppMenu?.({
      menuId,
      x: Math.round(rect.left),
      y: Math.round(rect.bottom),
    });
  }

  const toggleLabel = sidebarCollapsed
    ? t("nav.expandSidebar")
    : t("nav.collapseSidebar");

  return (
    <header className="window-titlebar" aria-label={t("chrome.titleBar")}>
      {/* Interactive chrome — must stay no-drag so clicks reach buttons. */}
      <div className="window-titlebar-chrome">
        <button
          type="button"
          className="window-titlebar-btn window-titlebar-toggle"
          onClick={onToggleSidebar}
          title={toggleLabel}
          aria-label={toggleLabel}
          aria-pressed={!sidebarCollapsed}
        >
          <PanelLeftIcon />
        </button>
        <nav className="window-titlebar-menus" aria-label={t("chrome.appMenu")}>
          {MENU_IDS.map((id) => (
            <button
              key={id}
              type="button"
              className="window-titlebar-menu-btn"
              onClick={(e) => openMenu(id, e)}
            >
              {t(`chrome.menu.${id}`)}
            </button>
          ))}
        </nav>
      </div>
      {/* Flex-grow drag strip; caption buttons are native titleBarOverlay on the right. */}
      <div className="window-titlebar-drag" aria-hidden />
    </header>
  );
}
