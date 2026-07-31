import { BrowserPane } from "../browser";
import { FileViewPane } from "./FileViewPane";
import { FilesPane } from "./files";
import { PlaceholderToolPane } from "./PlaceholderToolPane";
import { SideTaskPane, type SideTaskSubmit } from "./SideTaskPane";
import { SplitHome } from "./SplitHome";
import { TerminalPane } from "./TerminalPane";
import type { OpenFileViewRequest } from "../chat/FileChangeBar";
import type { ModelState, PermissionMode } from "../../../electron/preload";
import type { LocalSession } from "../../types/chat";
import type { QueuedPrompt } from "../../types/promptQueue";
import type { SplitTab, SplitTool } from "./types";
import { useTranslation } from "react-i18next";

type Props = {
  showHome: boolean;
  activeTab: SplitTab | null;
  open: boolean;
  onOpenTool: (tool: SplitTool) => void;
  sideTaskEnabled?: boolean;
  /** Workspace root for fileview disk fallback. */
  workspaceRoot?: string;
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
  onOpenFile?: (req: OpenFileViewRequest) => void;
};

/**
 * Active tool body. Only the active tab mounts heavy panes (xterm / browser).
 * Inactive tabs keep their PTY/session alive in main; re-mount re-attaches.
 */
export function SplitPanelBody({
  showHome,
  activeTab,
  open,
  onOpenTool,
  sideTaskEnabled,
  workspaceRoot,
  sideTaskSessions = [],
  sideTaskDisabled,
  sideTaskPromptQueue = [],
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
  onOpenFile,
}: Props) {
  const { t } = useTranslation();
  if (showHome || !activeTab) {
    return (
      <SplitHome
        onOpenTool={onOpenTool}
        sideTaskEnabled={sideTaskEnabled}
      />
    );
  }

  switch (activeTab.tool) {
    case "files":
      return open ? (
        <FilesPane key={activeTab.id} workspaceRoot={workspaceRoot} />
      ) : null;
    case "browser":
      return open ? (
        <BrowserPane
          key={activeTab.id}
          browserId={activeTab.id}
          open
          startUrl={activeTab.startUrl}
        />
      ) : null;
    case "terminal":
      return open ? (
        <TerminalPane key={activeTab.id} terminalId={activeTab.id} />
      ) : null;
    case "side-task":
      return open ? (
        <SideTaskPane
          key={activeTab.id}
          session={
            sideTaskSessions.find((s) => s.id === activeTab.sessionId) ?? null
          }
          workspaceRoot={workspaceRoot}
          disabled={sideTaskDisabled}
          promptQueue={sideTaskPromptQueue.filter(
            (item) => item.sessionId === activeTab.sessionId,
          )}
          models={models}
          permissionMode={permissionMode}
          slashRefreshKey={slashRefreshKey}
          voiceSttLanguage={voiceSttLanguage}
          onSubmit={onSubmitSideTask ?? (() => undefined)}
          onCancel={onCancelSideTask ?? (() => undefined)}
          onSendNowQueued={onSendNowSideTask}
          onRemoveQueued={onRemoveQueuedSideTask}
          onPermissionModeChange={onPermissionModeChange}
          onModelChange={onModelChange}
          onOpenFile={onOpenFile}
        />
      ) : null;
    case "fileview":
      return open && activeTab.fileView ? (
        <FileViewPane
          key={`${activeTab.id}-${activeTab.fileView.path}-${activeTab.fileView.mode}`}
          view={activeTab.fileView}
          workspaceRoot={workspaceRoot}
        />
      ) : (
        <PlaceholderToolPane
          title={t("tools.file")}
          description={t("tools.fileDesc")}
        />
      );
    default:
      return null;
  }
}
