import type { ReactNode } from "react";
import type { MessageDisplayMode } from "../../lib/guiSettings";
import type { SessionWorktree } from "../../types/chat";
import { Topbar } from "./Topbar";

type Props = {
  sessionTitle: string | null;
  /** Set when the focused chat runs in an isolated git worktree. */
  worktree?: SessionWorktree | null;
  loadingHistory: boolean;
  connectionFault: string | null;
  /** Replace the session title with a back control for full-page views. */
  onBack?: () => void;
  /** Session sidebar collapsed — topbar hosts expand + traffic-light inset. */
  sidebarCollapsed?: boolean;
  onExpandSidebar?: () => void;
  /** Bottom terminal dock open state. */
  bottomTerminalOpen?: boolean;
  onToggleBottomTerminal?: () => void;
  /** Right-side panel open state. */
  rightPanelOpen?: boolean;
  /** Toggle right split panel. */
  onToggleRightPanel?: () => void;
  /** Show maximize when right panel has content. */
  rightMaximizeVisible?: boolean;
  rightMaximized?: boolean;
  onToggleRightMaximize?: () => void;
  messageDisplayMode?: MessageDisplayMode;
  onMessageDisplayModeChange?: (mode: MessageDisplayMode) => void;
  children: ReactNode;
};

/** Right-hand shell: topbar + chat/composer children. */
export function MainPanel({
  sessionTitle,
  worktree,
  loadingHistory,
  connectionFault,
  onBack,
  sidebarCollapsed,
  onExpandSidebar,
  bottomTerminalOpen,
  onToggleBottomTerminal,
  rightPanelOpen,
  onToggleRightPanel,
  rightMaximizeVisible,
  rightMaximized,
  onToggleRightMaximize,
  messageDisplayMode,
  onMessageDisplayModeChange,
  children,
}: Props) {
  return (
    <main className="main">
      <Topbar
        sessionTitle={sessionTitle}
        worktree={worktree}
        loadingHistory={loadingHistory}
        connectionFault={connectionFault}
        onBack={onBack}
        sidebarCollapsed={sidebarCollapsed}
        onExpandSidebar={onExpandSidebar}
        bottomTerminalOpen={bottomTerminalOpen}
        onToggleBottomTerminal={onToggleBottomTerminal}
        rightPanelOpen={rightPanelOpen}
        onToggleRightPanel={onToggleRightPanel}
        rightMaximizeVisible={rightMaximizeVisible}
        rightMaximized={rightMaximized}
        onToggleRightMaximize={onToggleRightMaximize}
        messageDisplayMode={messageDisplayMode}
        onMessageDisplayModeChange={onMessageDisplayModeChange}
      />
      {children}
    </main>
  );
}
