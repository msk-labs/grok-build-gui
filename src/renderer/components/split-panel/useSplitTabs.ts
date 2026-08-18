import { useCallback, useEffect, useRef, useState } from "react";
import { basename } from "../../lib/lineDiff";
import { folderName, makeTab } from "./tabFactory";
import type {
  FileViewPayload,
  SplitEntry,
  SplitFocusRequest,
  SplitPlacement,
  SplitTab,
  SplitTool,
} from "./types";
import { toolLabel } from "./tools";

type Options = {
  placement: SplitPlacement;
  entry: SplitEntry;
  open: boolean;
  /** Panel size (width/height) — re-fit xterm when it changes. */
  size: number;
  focusTool: SplitFocusRequest | null | undefined;
  /**
   * Bump to drop every file view. A file view is a snapshot of one session's
   * tool output, so switching sessions makes it stale — unlike terminals and
   * browsers, which own live processes and must survive the switch.
   */
  closeFileViewsKey?: number;
  onCollapse: () => void;
  onCreateSideTask?: () => Promise<string | null>;
  onCloseSideTask?: (sessionId: string) => void;
};

/** Normalize paths for same-file tab matching. */
function pathKey(p: string): string {
  return p.replace(/\\/g, "/");
}

function fileViewKey(view: FileViewPayload): string {
  return `${pathKey(view.root ?? "")}\0${pathKey(view.path)}`;
}

/**
 * Tab model for one split panel instance.
 * Terminals and fileviews are multi-tab; other tools are singletons (focus existing).
 */
export function useSplitTabs({
  placement,
  entry,
  open,
  size,
  focusTool,
  closeFileViewsKey,
  onCollapse,
  onCreateSideTask,
  onCloseSideTask,
}: Options) {
  const [tabs, setTabs] = useState<SplitTab[]>(() =>
    entry === "terminal" ? [makeTab(placement, "terminal")] : [],
  );
  const [activeId, setActiveId] = useState<string | null>(
    () => (entry === "terminal" ? tabs[0]?.id ?? null : null),
  );
  /** Right entry: empty body is home until a tool is opened. */
  const [showHome, setShowHome] = useState(() => entry === "home");
  const [cwdById, setCwdById] = useState<Record<string, string>>({});
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const focusNonceRef = useRef<number | null>(null);
  const seededRef = useRef(entry === "terminal");
  const pendingSideTaskTabsRef = useRef(new Set<string>());

  // First open with terminal entry: ensure a live tab exists.
  useEffect(() => {
    if (!open || entry !== "terminal" || seededRef.current) return;
    if (tabs.length > 0) {
      seededRef.current = true;
      return;
    }
    const tab = makeTab(placement, "terminal");
    setTabs([tab]);
    setActiveId(tab.id);
    setShowHome(false);
    seededRef.current = true;
  }, [entry, open, placement, tabs.length]);

  // Re-fit xterm after layout settles.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 50);
    return () => window.clearTimeout(t);
  }, [open, activeId, size]);

  // Terminal cwd labels.
  useEffect(() => {
    if (!window.grok?.onTerminalState) return;

    const remember = (id: string, cwd: string) => {
      if (!id || !cwd) return;
      setCwdById((prev) => (prev[id] === cwd ? prev : { ...prev, [id]: cwd }));
    };

    const unsub = window.grok.onTerminalState((s) => {
      if (s?.id && typeof s.cwd === "string" && s.cwd.length > 0) {
        remember(s.id, s.cwd);
      }
    });

    for (const tab of tabs) {
      if (tab.tool !== "terminal") continue;
      void window.grok.getTerminalState?.(tab.id).then((s) => {
        if (s?.cwd) remember(s.id, s.cwd);
      });
    }

    return unsub;
  }, [tabs]);

  const tearDownTab = useCallback(
    (tab: SplitTab) => {
      if (tab.tool === "terminal") {
        void window.grok?.terminalKill?.(tab.id);
        setCwdById((prev) => {
          if (!(tab.id in prev)) return prev;
          const next = { ...prev };
          delete next[tab.id];
          return next;
        });
        return;
      }
      // Each browser tab owns its Chrome slot (right-N / bottom-N stay independent).
      if (tab.tool === "browser") {
        void window.grok?.browserClose?.(tab.id);
      }
      if (tab.tool === "side-task") {
        pendingSideTaskTabsRef.current.delete(tab.id);
        if (tab.sessionId) onCloseSideTask?.(tab.sessionId);
      }
    },
    [onCloseSideTask],
  );

  const openTool = useCallback(
    (
      tool: SplitTool,
      opts?: { startUrl?: string; fileView?: FileViewPayload },
    ) => {
      setShowHome(false);
      if (tool === "side-task") {
        // Match the TUI's perceived startup: paint a usable draft immediately
        // while the agent persists session/new in the background.
        const pendingTab = makeTab(placement, "side-task");
        pendingSideTaskTabsRef.current.add(pendingTab.id);
        setTabs((prev) => [...prev, pendingTab]);
        setActiveId(pendingTab.id);
        void (async () => {
          const sessionId = await onCreateSideTask?.();
          if (
            sessionId &&
            pendingSideTaskTabsRef.current.delete(pendingTab.id)
          ) {
            setTabs((prev) =>
              prev.map((tab) =>
                tab.id === pendingTab.id ? { ...tab, sessionId } : tab,
              ),
            );
            return;
          }

          // The user closed the placeholder before session/new completed.
          // Delete the now-orphaned scratch session instead of leaking it.
          if (sessionId) {
            onCloseSideTask?.(sessionId);
            return;
          }

          pendingSideTaskTabsRef.current.delete(pendingTab.id);
          setTabs((prev) => {
            const idx = prev.findIndex((tab) => tab.id === pendingTab.id);
            if (idx < 0) return prev;
            const next = prev.filter((tab) => tab.id !== pendingTab.id);
            if (next.length > 0) {
              if (activeIdRef.current === pendingTab.id) {
                setActiveId(next[Math.min(idx, next.length - 1)]!.id);
              }
              return next;
            }
            // Same empty policy as finishEmptyTabs (defined below).
            if (entry === "home") {
              setActiveId(null);
              setShowHome(true);
              onCollapse();
              return [];
            }
            const fresh = makeTab(placement, "terminal");
            setActiveId(fresh.id);
            setShowHome(false);
            onCollapse();
            return [fresh];
          });
        })();
        return;
      }
      // Browser lifecycle is owned by BrowserPane (open on mount with this panel's tab id).
      setTabs((prev) => {
        // fileview: one tab per path (click A then B → two tabs); same path re-focuses.
        if (tool === "fileview" && opts?.fileView) {
          const key = fileViewKey(opts.fileView);
          const existing = prev.find(
            (t) =>
              t.tool === "fileview" &&
              t.fileView != null &&
              fileViewKey(t.fileView) === key,
          );
          if (existing) {
            setActiveId(existing.id);
            // Refresh payload (mode / content may have changed on re-open).
            return prev.map((t) =>
              t.id === existing.id
                ? { ...t, fileView: opts.fileView }
                : t,
            );
          }
          const tab: SplitTab = {
            ...makeTab(placement, "fileview"),
            fileView: opts.fileView,
          };
          setActiveId(tab.id);
          return [...prev, tab];
        }

        // Per-panel singleton for non-terminal tools; the other placement has its own tabs.
        // fileview is multi-tab (handled above); terminal is always multi-tab.
        if (tool !== "terminal" && tool !== "fileview") {
          const existing = prev.find((t) => t.tool === tool);
          if (existing) {
            setActiveId(existing.id);
            // Refresh startUrl only when caller supplies a new one (e.g. slash).
            if (opts?.startUrl && existing.startUrl !== opts.startUrl) {
              return prev.map((t) =>
                t.id === existing.id
                  ? { ...t, startUrl: opts.startUrl }
                  : t,
              );
            }
            return prev;
          }
        }
        const tab: SplitTab = {
          ...makeTab(placement, tool),
          ...(opts?.startUrl ? { startUrl: opts.startUrl } : {}),
          ...(opts?.fileView ? { fileView: opts.fileView } : {}),
        };
        setActiveId(tab.id);
        return [...prev, tab];
      });
    },
    [entry, onCollapse, onCloseSideTask, onCreateSideTask, placement],
  );

  // External focus (topbar /browser slash / chat file open) — this panel only.
  useEffect(() => {
    if (!focusTool) return;
    if (focusTool.placement && focusTool.placement !== placement) return;
    if (focusNonceRef.current === focusTool.nonce) return;
    focusNonceRef.current = focusTool.nonce;
    openTool(focusTool.tool, {
      startUrl: focusTool.startUrl,
      fileView: focusTool.fileView,
    });
  }, [focusTool, openTool, placement]);

  /**
   * Empty-panel policy shared by single / bulk close.
   * Right (`home`): clear tabs, arm home for the next intentional topbar open,
   * and collapse — never leave the home picker visible after closing the last tool.
   * Bottom (`terminal`): collapse and keep a fresh terminal ready.
   */
  const finishEmptyTabs = useCallback((): SplitTab[] => {
    if (entry === "home") {
      setActiveId(null);
      setShowHome(true);
      onCollapse();
      return [];
    }
    // Bottom-style: collapse and keep a fresh terminal ready.
    const fresh = makeTab(placement, "terminal");
    setActiveId(fresh.id);
    setShowHome(false);
    onCollapse();
    return [fresh];
  }, [entry, onCollapse, placement]);

  const closeTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === id);
        if (idx < 0) return prev;
        tearDownTab(prev[idx]!);
        const next = prev.filter((t) => t.id !== id);
        if (next.length === 0) return finishEmptyTabs();
        if (activeIdRef.current === id) {
          setActiveId(next[Math.min(idx, next.length - 1)]!.id);
        }
        return next;
      });
    },
    [finishEmptyTabs, tearDownTab],
  );

  /** Drop stale file views, keeping tabs that own a live process. */
  const closeFileViewTabs = useCallback(() => {
    setTabs((prev) => {
      if (!prev.some((t) => t.tool === "fileview")) return prev;
      for (const t of prev) {
        if (t.tool === "fileview") tearDownTab(t);
      }
      const next = prev.filter((t) => t.tool !== "fileview");
      if (next.length === 0) return finishEmptyTabs();
      if (!next.some((t) => t.id === activeIdRef.current)) {
        setActiveId(next[next.length - 1]!.id);
      }
      return next;
    });
  }, [finishEmptyTabs, tearDownTab]);

  // Session switch: retire file views belonging to the session left behind.
  const closeFileViewsKeyRef = useRef(closeFileViewsKey);
  useEffect(() => {
    if (closeFileViewsKeyRef.current === closeFileViewsKey) return;
    closeFileViewsKeyRef.current = closeFileViewsKey;
    closeFileViewTabs();
  }, [closeFileViewTabs, closeFileViewsKey]);

  /** Close every tab except `id` (context menu: Close Others). */
  const closeOtherTabs = useCallback(
    (id: string) => {
      setTabs((prev) => {
        const keep = prev.find((t) => t.id === id);
        if (!keep) return prev;
        for (const t of prev) {
          if (t.id !== id) tearDownTab(t);
        }
        setActiveId(id);
        setShowHome(false);
        return [keep];
      });
    },
    [tearDownTab],
  );

  /** Close tabs to the left of `id` (context menu). */
  const closeTabsToLeft = useCallback(
    (id: string) => {
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === id);
        if (idx <= 0) return prev;
        const doomed = prev.slice(0, idx);
        for (const t of doomed) tearDownTab(t);
        const next = prev.slice(idx);
        if (!next.some((t) => t.id === activeIdRef.current)) {
          setActiveId(next[0]!.id);
        }
        setShowHome(false);
        return next;
      });
    },
    [tearDownTab],
  );

  /** Close tabs to the right of `id` (context menu). */
  const closeTabsToRight = useCallback(
    (id: string) => {
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === id);
        if (idx < 0 || idx >= prev.length - 1) return prev;
        const doomed = prev.slice(idx + 1);
        for (const t of doomed) tearDownTab(t);
        const next = prev.slice(0, idx + 1);
        if (!next.some((t) => t.id === activeIdRef.current)) {
          setActiveId(next[next.length - 1]!.id);
        }
        setShowHome(false);
        return next;
      });
    },
    [tearDownTab],
  );

  /** Close every tab (context menu: Close All). */
  const closeAllTabs = useCallback(() => {
    setTabs((prev) => {
      for (const t of prev) tearDownTab(t);
      return finishEmptyTabs();
    });
  }, [finishEmptyTabs, tearDownTab]);

  const selectTab = useCallback((id: string) => {
    setShowHome(false);
    setActiveId(id);
  }, []);

  const activeTab = tabs.find((t) => t.id === activeId) ?? null;

  const tabTitle = useCallback(
    (tab: SplitTab): string => {
      if (tab.tool === "terminal") {
        return folderName(cwdById[tab.id]);
      }
      if (tab.tool === "fileview" && tab.fileView?.path) {
        return basename(tab.fileView.path);
      }
      if (tab.tool === "side-task") {
        return "Side task";
      }
      return toolLabel(tab.tool);
    },
    [cwdById],
  );

  const tabSubtitle = useCallback(
    (tab: SplitTab): string | undefined => {
      if (tab.tool === "terminal") return cwdById[tab.id];
      if (tab.tool === "fileview") return tab.fileView?.path;
      if (tab.tool === "side-task") return tab.sessionId;
      return undefined;
    },
    [cwdById],
  );

  return {
    tabs,
    activeId,
    activeTab,
    showHome,
    openTool,
    closeTab,
    closeOtherTabs,
    closeTabsToLeft,
    closeTabsToRight,
    closeAllTabs,
    selectTab,
    tabTitle,
    tabSubtitle,
  };
}
