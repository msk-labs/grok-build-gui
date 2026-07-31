/**
 * Windows application menu + per-label popup helpers.
 * macOS keeps Electron’s default menu; this module is only wired on win32.
 *
 * The custom title bar renders File/Edit/View/Window/Help labels; clicking one
 * pops the matching submenu (Codex-style simulated system menu bar).
 */
import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from "electron";

export type AppMenuId = "file" | "edit" | "view" | "window" | "help";

const MENU_ORDER: AppMenuId[] = ["file", "edit", "view", "window", "help"];

const MENU_LABELS: Record<AppMenuId, string> = {
  file: "File",
  edit: "Edit",
  view: "View",
  window: "Window",
  help: "Help",
};

function buildTemplate(): MenuItemConstructorOptions[] {
  const isMac = process.platform === "darwin";
  return [
    {
      label: MENU_LABELS.file,
      id: "file",
      submenu: [
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: MENU_LABELS.edit,
      id: "edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: MENU_LABELS.view,
      id: "view",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: MENU_LABELS.window,
      id: "window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { role: "close" },
      ],
    },
    {
      label: MENU_LABELS.help,
      id: "help",
      submenu: [
        {
          label: "Grok Build GUI",
          enabled: false,
        },
        {
          label: `Version ${app.getVersion()}`,
          enabled: false,
        },
      ],
    },
  ];
}

/** Install the app menu (accelerators). On Windows the bar itself stays hidden. */
export function installWindowsAppMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildTemplate()));
}

/**
 * Popup a top-level submenu under a custom title-bar label.
 * Prefer rebuilding the submenu from the template so we never depend on
 * ApplicationMenu retaining custom `id`s across platforms/Electron versions.
 */
export function popupAppMenu(
  win: BrowserWindow,
  menuId: AppMenuId,
  x: number,
  y: number,
): void {
  const template = buildTemplate();
  const entry = template.find(
    (item) =>
      item.id === menuId ||
      (typeof item.label === "string" &&
        item.label.toLowerCase() === MENU_LABELS[menuId].toLowerCase()),
  );
  const submenuTemplate = entry?.submenu;
  if (!submenuTemplate || !Array.isArray(submenuTemplate)) {
    // Fallback: ApplicationMenu items (roles already resolved).
    const appMenu = Menu.getApplicationMenu();
    const item = appMenu?.items.find(
      (m) =>
        m.id === menuId ||
        m.label.toLowerCase() === MENU_LABELS[menuId].toLowerCase(),
    );
    const submenu = item?.submenu;
    if (!submenu) return;
    submenu.popup({
      window: win,
      x: Math.round(x),
      y: Math.round(y),
    });
    return;
  }

  const menu = Menu.buildFromTemplate(submenuTemplate);
  menu.popup({
    window: win,
    x: Math.round(x),
    y: Math.round(y),
  });
}

export function isAppMenuId(value: unknown): value is AppMenuId {
  return typeof value === "string" && (MENU_ORDER as string[]).includes(value);
}
