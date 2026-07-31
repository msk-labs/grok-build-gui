import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  CloseIcon,
  panelToolIcon,
  PlusIcon,
  TerminalTabIcon,
} from "./panelIcons";
import {
  PANEL_TOOLS,
  SIDE_TASK_ACTION,
  toolLabel,
  toolTranslationKeys,
} from "./tools";
import type { SplitTab, SplitTool } from "./types";
import { useTranslation } from "react-i18next";

type Props = {
  tabs: SplitTab[];
  activeId: string | null;
  tabTitle: (tab: SplitTab) => string;
  tabSubtitle: (tab: SplitTab) => string | undefined;
  onSelect: (id: string) => void;
  onCloseTab: (id: string) => void;
  onCloseOtherTabs: (id: string) => void;
  onCloseTabsToLeft: (id: string) => void;
  onCloseTabsToRight: (id: string) => void;
  onCloseAllTabs: () => void;
  /** Create/focus a tool tab (Files, Browser, Terminal). */
  onOpenTool: (tool: SplitTool) => void;
  sideTaskEnabled?: boolean;
};

type MenuPos = { top: number; left: number; openUp: boolean };

type CtxMenu = {
  tabId: string;
  x: number;
  y: number;
};

function keepFocus(e: MouseEvent) {
  e.preventDefault();
}

const MENU_MIN_WIDTH = 220;
/** Approximate menu height for flip-above layout (4 items). */
const MENU_EST_HEIGHT = 220;
const CTX_MENU_WIDTH = 200;
const CTX_MENU_EST_HEIGHT = 200;

/** Codex-style pill tabs + create menu + right-click tab management. */
export function SplitTabBar({
  tabs,
  activeId,
  tabTitle,
  tabSubtitle,
  onSelect,
  onCloseTab,
  onCloseOtherTabs,
  onCloseTabsToLeft,
  onCloseTabsToRight,
  onCloseAllTabs,
  onOpenTool,
  sideTaskEnabled,
}: Props) {
  const { t } = useTranslation();
  const baseId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null);
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);

  const placeMenu = () => {
    const btn = addBtnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < MENU_EST_HEIGHT && rect.top > MENU_EST_HEIGHT;
    let left = rect.left;
    // Keep menu inside the viewport horizontally.
    left = Math.max(
      8,
      Math.min(left, window.innerWidth - MENU_MIN_WIDTH - 8),
    );
    const top = openUp ? rect.top - 4 : rect.bottom + 4;
    setMenuPos({ top, left, openUp });
  };

  useLayoutEffect(() => {
    if (!menuOpen) {
      setMenuPos(null);
      return;
    }
    placeMenu();
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;

    const onDocDown = (e: globalThis.MouseEvent) => {
      const t = e.target as Node;
      if (addBtnRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    const onReposition = () => placeMenu();

    // Capture phase so we close before other handlers; button click still toggles.
    document.addEventListener("mousedown", onDocDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("mousedown", onDocDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!ctxMenu) return;

    const onDocDown = (e: globalThis.MouseEvent) => {
      const t = e.target as Node;
      if (ctxMenuRef.current?.contains(t)) return;
      setCtxMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCtxMenu(null);
    };
    const onDismiss = () => setCtxMenu(null);

    document.addEventListener("mousedown", onDocDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onDismiss);
    window.addEventListener("scroll", onDismiss, true);
    return () => {
      document.removeEventListener("mousedown", onDocDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onDismiss);
      window.removeEventListener("scroll", onDismiss, true);
    };
  }, [ctxMenu]);

  const openTabContextMenu = (tabId: string, e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuOpen(false);
    onSelect(tabId);
    // Keep inside viewport.
    const x = Math.max(
      8,
      Math.min(e.clientX, window.innerWidth - CTX_MENU_WIDTH - 8),
    );
    const y = Math.max(
      8,
      Math.min(e.clientY, window.innerHeight - CTX_MENU_EST_HEIGHT - 8),
    );
    setCtxMenu({ tabId, x, y });
  };

  const runCtx = (fn: () => void) => {
    setCtxMenu(null);
    fn();
  };

  const ctxTabIdx = ctxMenu
    ? tabs.findIndex((t) => t.id === ctxMenu.tabId)
    : -1;
  const canCloseOthers = tabs.length > 1 && ctxTabIdx >= 0;
  const canCloseLeft = ctxTabIdx > 0;
  const canCloseRight = ctxTabIdx >= 0 && ctxTabIdx < tabs.length - 1;
  const canCloseAll = tabs.length > 0;

  const menu =
    menuOpen && menuPos
      ? createPortal(
          <div
            ref={menuRef}
            className="split-panel-add-menu"
            role="menu"
            style={{
              position: "fixed",
              top: menuPos.openUp ? undefined : menuPos.top,
              bottom: menuPos.openUp
                ? window.innerHeight - menuPos.top
                : undefined,
              left: menuPos.left,
              zIndex: 10000,
            }}
          >
            {PANEL_TOOLS.map((tool) => {
              const keys = toolTranslationKeys(tool.id);
              return (
                <button
                  key={tool.id}
                  type="button"
                  role="menuitem"
                  className="split-panel-add-menu-item"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(false);
                    // Only this panel's openTool — right and bottom never share tab state.
                    onOpenTool(tool.id);
                  }}
                >
                  <span className="split-panel-add-menu-item-icon" aria-hidden>
                    {panelToolIcon(tool.id, 16)}
                  </span>
                  <span className="split-panel-add-menu-item-text">
                    <span className="split-panel-add-menu-item-label">
                      {t(keys.label)}
                    </span>
                    <span className="split-panel-add-menu-item-desc">
                      {keys.description ? t(keys.description) : ""}
                    </span>
                  </span>
                </button>
              );
            })}
            {sideTaskEnabled ? (
              <button
                type="button"
                role="menuitem"
                className="split-panel-add-menu-item"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  onOpenTool(SIDE_TASK_ACTION.id);
                }}
              >
                <span className="split-panel-add-menu-item-icon" aria-hidden>
                  {panelToolIcon(SIDE_TASK_ACTION.id, 16)}
                </span>
                <span className="split-panel-add-menu-item-text">
                  <span className="split-panel-add-menu-item-label">
                    {t("tools.sideTask")}
                  </span>
                  <span className="split-panel-add-menu-item-desc">
                    {t("tools.sideTaskDesc")}
                  </span>
                </span>
              </button>
            ) : null}
          </div>,
          document.body,
        )
      : null;

  const contextMenu =
    ctxMenu && ctxTabIdx >= 0
      ? createPortal(
          <div
            ref={ctxMenuRef}
            className="split-panel-tab-ctx-menu"
            role="menu"
            aria-label={t("tools.tabOptions")}
            style={{
              position: "fixed",
              top: ctxMenu.y,
              left: ctxMenu.x,
              zIndex: 10001,
            }}
          >
            <button
              type="button"
              role="menuitem"
              className="split-panel-tab-ctx-item"
              onClick={() => runCtx(() => onCloseTab(ctxMenu.tabId))}
            >
              {t("common.close")}
            </button>
            <button
              type="button"
              role="menuitem"
              className="split-panel-tab-ctx-item"
              disabled={!canCloseOthers}
              onClick={() =>
                canCloseOthers &&
                runCtx(() => onCloseOtherTabs(ctxMenu.tabId))
              }
            >
              {t("tools.closeOthers")}
            </button>
            <button
              type="button"
              role="menuitem"
              className="split-panel-tab-ctx-item"
              disabled={!canCloseLeft}
              onClick={() =>
                canCloseLeft &&
                runCtx(() => onCloseTabsToLeft(ctxMenu.tabId))
              }
            >
              {t("tools.closeLeft")}
            </button>
            <button
              type="button"
              role="menuitem"
              className="split-panel-tab-ctx-item"
              disabled={!canCloseRight}
              onClick={() =>
                canCloseRight &&
                runCtx(() => onCloseTabsToRight(ctxMenu.tabId))
              }
            >
              {t("tools.closeRight")}
            </button>
            <div className="split-panel-tab-ctx-sep" role="separator" />
            <button
              type="button"
              role="menuitem"
              className="split-panel-tab-ctx-item"
              disabled={!canCloseAll}
              onClick={() => canCloseAll && runCtx(() => onCloseAllTabs())}
            >
              {t("tools.closeAll")}
            </button>
          </div>,
          document.body,
        )
      : null;

  return (
    <div
      className="split-panel-tabs"
      role="tablist"
      aria-label={t("tools.panelTabs")}
    >
      <div className="split-panel-tabs-scroll">
        {tabs.map((tab) => {
          const selected = tab.id === activeId;
          const rawTitle = tabTitle(tab);
          const title =
            rawTitle === toolLabel(tab.tool)
              ? t(toolTranslationKeys(tab.tool).label)
              : rawTitle;
          const sub = tabSubtitle(tab);
          return (
            <div
              key={tab.id}
              className={
                selected
                  ? "split-panel-tab split-panel-tab-active"
                  : "split-panel-tab"
              }
              role="tab"
              aria-selected={selected}
              aria-label={sub ? `${title} (${sub})` : title}
              id={`${baseId}-tab-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              title={sub || title}
              onClick={() => onSelect(tab.id)}
              onContextMenu={(e) => openTabContextMenu(tab.id, e)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(tab.id);
                }
              }}
            >
              <span className="split-panel-tab-icon" aria-hidden>
                {tab.tool === "terminal" ? (
                  <TerminalTabIcon />
                ) : (
                  panelToolIcon(tab.tool, 14)
                )}
              </span>
              <span className="split-panel-tab-label">{title}</span>
              <button
                type="button"
                className="split-panel-tab-close"
                onMouseDown={keepFocus}
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }}
                title={t("tools.closeTab")}
                aria-label={t("tools.closeNamed", { name: title })}
              >
                <CloseIcon />
              </button>
            </div>
          );
        })}
        {/* Keep + flush against the last tab (not pinned to the collapse control). */}
        <button
          ref={addBtnRef}
          type="button"
          className={
            menuOpen ? "split-panel-tab-add open" : "split-panel-tab-add"
          }
          onMouseDown={keepFocus}
          onClick={() => {
            setCtxMenu(null);
            setMenuOpen((v) => !v);
          }}
          aria-label={t("tools.addPanel")}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <PlusIcon />
        </button>
      </div>
      {menu}
      {contextMenu}
    </div>
  );
}
