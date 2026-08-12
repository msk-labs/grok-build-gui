import { useCallback, useEffect, useRef, useState } from "react";
import { loadPanelSize } from "./size";
import { SplitPanelBody } from "./SplitPanelBody";
import { SplitResizer } from "./SplitResizer";
import { SplitTabBar } from "./SplitTabBar";
import type { OpenFileViewRequest } from "../chat/FileChangeBar";
import type { ModelState, PermissionMode } from "../../../electron/preload";
import type { LocalSession } from "../../types/chat";
import type { QueuedPrompt } from "../../types/promptQueue";
import type { SideTaskSubmit } from "./SideTaskPane";
import type {
  SplitEntry,
  SplitFocusRequest,
  SplitPlacement,
} from "./types";
import { useSplitTabs } from "./useSplitTabs";
import { useTranslation } from "react-i18next";

type Props = {
  placement: SplitPlacement;
  open: boolean;
  /** Collapse only — tabs / PTYs stay alive. */
  onCollapse: () => void;
  /**
   * First paint when empty:
   * - `home` → tool picker (right split)
   * - `terminal` → one terminal tab (bottom split)
   */
  entry: SplitEntry;
  /** Topbar / slash / chat: open or focus a tool. */
  focusTool?: SplitFocusRequest | null;
  /**
   * Bump on session switch to close file views, which show a snapshot of the
   * session being left. Terminals and browsers own live processes and stay.
   */
  closeFileViewsKey?: number;
  /** Workspace root for fileview disk reads. */
  workspaceRoot?: string;
  /**
   * Right panel fills the upper row (chat column hidden). Codex maximize.
   * Only meaningful for placement="right".
   */
  maximized?: boolean;
  /** True when the panel has a real tool tab (not empty home). */
  onHasContentChange?: (hasContent: boolean) => void;
  /** Create a temporary chat session for a side-task tab. */
  onCreateSideTask?: () => Promise<string | null>;
  /** Side tasks are available only while a main session is open. */
  sideTaskEnabled?: boolean;
  /** Delete the temporary chat session owned by a closing side-task tab. */
  onCloseSideTask?: (sessionId: string) => void;
  sideTaskSessions?: LocalSession[];
  sideTaskDisabled?: boolean;
  sideTaskPromptQueue?: QueuedPrompt[];
  models: ModelState;
  permissionMode: PermissionMode;
  slashRefreshKey?: number;
  voiceSttLanguage?: string;
  onSubmitSideTask?: SideTaskSubmit;
  onCancelSideTask?: (sessionId: string) => void;
  onSendNowSideTask?: (id: string) => void;
  onRemoveQueuedSideTask?: (id: string) => void;
  onPermissionModeChange: (mode: PermissionMode) => void;
  onModelChange: (modelId: string, reasoningEffort?: string | null) => void;
  onConfigureModels?: () => void;
  onOpenFile?: (req: OpenFileViewRequest) => void;
};

/**
 * Shared split chrome for right and bottom panels.
 * Size, tabs, and tool bodies live here — App only owns open/collapse.
 */
export function SplitPanel({
  placement,
  open,
  onCollapse,
  entry,
  focusTool = null,
  closeFileViewsKey,
  workspaceRoot,
  maximized = false,
  onHasContentChange,
  onCreateSideTask,
  sideTaskEnabled = false,
  onCloseSideTask,
  sideTaskSessions,
  sideTaskDisabled,
  sideTaskPromptQueue,
  models,
  permissionMode,
  slashRefreshKey,
  voiceSttLanguage,
  onSubmitSideTask,
  onCancelSideTask,
  onSendNowSideTask,
  onRemoveQueuedSideTask,
  onPermissionModeChange,
  onModelChange,
  onConfigureModels,
  onOpenFile,
}: Props) {
  const { t } = useTranslation();
  const [size, setSize] = useState(() => loadPanelSize(placement));
  const panelRef = useRef<HTMLElement | null>(null);
  const previewSize = useCallback(
    (next: number) => {
      const panel = panelRef.current;
      if (!panel) return;
      if (placement === "right") {
        panel.style.width = `${next}px`;
      } else {
        panel.style.height = `${next}px`;
      }
    },
    [placement],
  );
  const tabs = useSplitTabs({
    placement,
    entry,
    open,
    size,
    focusTool,
    closeFileViewsKey,
    onCollapse,
    onCreateSideTask,
    onCloseSideTask,
  });

  // Report content for topbar maximize affordance (files / browser / etc.).
  useEffect(() => {
    if (!onHasContentChange) return;
    const has = open && tabs.tabs.length > 0 && !tabs.showHome;
    onHasContentChange(has);
  }, [open, tabs.tabs.length, tabs.showHome, onHasContentChange]);

  // Only apply size while open — collapsed chrome is fully hidden via CSS.
  // Maximized right panel grows via flex (no fixed width).
  const style =
    placement === "right"
      ? open && !maximized
        ? { width: `${size}px` }
        : undefined
      : open
        ? { height: `${size}px` }
        : undefined;

  const openClass = open
    ? `split-panel split-panel-${placement}`
    : `split-panel split-panel-${placement} split-panel-collapsed`;
  const maxClass =
    open && maximized && placement === "right"
      ? " split-panel-maximized"
      : "";

  return (
    <aside
      ref={panelRef}
      className={openClass + maxClass}
      style={style}
      hidden={!open}
      aria-hidden={!open}
      aria-label={
        placement === "right" ? t("tools.rightPanel") : t("tools.bottomPanel")
      }
    >
      {open && !maximized ? (
        <SplitResizer
          placement={placement}
          size={size}
          onSizePreview={previewSize}
          onSizeCommit={setSize}
        />
      ) : null}

      <SplitTabBar
        tabs={tabs.tabs}
        activeId={tabs.activeId}
        tabTitle={tabs.tabTitle}
        tabSubtitle={tabs.tabSubtitle}
        onSelect={tabs.selectTab}
        onCloseTab={tabs.closeTab}
        onCloseOtherTabs={tabs.closeOtherTabs}
        onCloseTabsToLeft={tabs.closeTabsToLeft}
        onCloseTabsToRight={tabs.closeTabsToRight}
        onCloseAllTabs={tabs.closeAllTabs}
        onOpenTool={tabs.openTool}
        sideTaskEnabled={sideTaskEnabled}
      />

      <div className="split-panel-body">
        <SplitPanelBody
          showHome={tabs.showHome}
          activeTab={tabs.activeTab}
          open={open}
          onOpenTool={tabs.openTool}
          sideTaskEnabled={sideTaskEnabled}
          workspaceRoot={workspaceRoot}
          sideTaskSessions={sideTaskSessions}
          sideTaskDisabled={sideTaskDisabled}
          sideTaskPromptQueue={sideTaskPromptQueue}
          models={models}
          permissionMode={permissionMode}
          slashRefreshKey={slashRefreshKey}
          voiceSttLanguage={voiceSttLanguage}
          onSubmitSideTask={onSubmitSideTask}
          onCancelSideTask={onCancelSideTask}
          onSendNowSideTask={onSendNowSideTask}
          onRemoveQueuedSideTask={onRemoveQueuedSideTask}
          onPermissionModeChange={onPermissionModeChange}
          onModelChange={onModelChange}
          onConfigureModels={onConfigureModels}
          onOpenFile={onOpenFile}
        />
      </div>
    </aside>
  );
}
