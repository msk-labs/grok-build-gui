/** Screen edge for the shared split panel chrome. */
export type SplitPlacement = "right" | "bottom";

/** Tools that can open as tabs (Codex-style). */
export type SplitTool =
  | "files"
  | "browser"
  | "terminal"
  | "side-task"
  /** Chat-driven file / diff viewer (not in the + create menu). */
  | "fileview";

/** First paint when the panel opens with no tabs yet. */
export type SplitEntry = "home" | "terminal";

/** Payload for a fileview tab (diff or full content). */
export type FileViewPayload = {
  path: string;
  mode: "diff" | "content";
  oldText?: string | null;
  newText?: string;
};

export type SplitTab = {
  id: string;
  tool: SplitTool;
  /** Browser only: first navigation URL for this slot. */
  startUrl?: string;
  /** fileview only */
  fileView?: FileViewPayload;
  /** side-task only: backing temporary Grok session id. */
  sessionId?: string;
};

/** Topbar / slash / chat: open (or focus) a tool in this panel. */
export type SplitFocusRequest = {
  tool: SplitTool;
  /** Change nonce so the same tool can be re-requested. */
  nonce: number;
  /** Browser only: open this URL in the focused panel's browser tab. */
  startUrl?: string;
  /** fileview: show this path as diff or full content. */
  fileView?: FileViewPayload;
  /**
   * Optional placement gate. When set, only that panel consumes the request
   * (prevents a sticky focus from re-opening browser on the wrong dock).
   */
  placement?: SplitPlacement;
};
