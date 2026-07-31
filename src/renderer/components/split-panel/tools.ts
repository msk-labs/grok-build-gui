import type { SplitTool } from "./types";
import type { TranslationKey } from "../../locales/en";

export type PanelToolDef = {
  id: SplitTool;
  label: string;
  description: string;
};

export type PanelActionDef = {
  id: SplitTool;
  label: string;
  description: string;
};

/** Create-menu order matches current Codex: Files, Browser, Terminal. */
export const PANEL_TOOLS: readonly PanelToolDef[] = [
  {
    id: "files",
    label: "Files",
    description: "Browse and preview workspace files",
  },
  {
    id: "browser",
    label: "Browser",
    description: "In-app browser pane",
  },
  {
    id: "terminal",
    label: "Terminal",
    description: "Shell session",
  },
] as const;

export const SIDE_TASK_ACTION: PanelActionDef = {
  id: "side-task",
  label: "Side task",
  description: "Start a scratch chat hidden from Projects",
};

export function toolLabel(tool: SplitTool): string {
  if (tool === "fileview") return "File";
  if (tool === "side-task") return "Side task";
  return PANEL_TOOLS.find((t) => t.id === tool)?.label ?? tool;
}

export function toolTranslationKeys(tool: SplitTool): {
  label: TranslationKey;
  description?: TranslationKey;
} {
  switch (tool) {
    case "files":
      return { label: "tools.files", description: "tools.filesDesc" };
    case "browser":
      return { label: "tools.browser", description: "tools.browserDesc" };
    case "terminal":
      return { label: "tools.terminal", description: "tools.terminalDesc" };
    case "side-task":
      return { label: "tools.sideTask", description: "tools.sideTaskDesc" };
    case "fileview":
      return { label: "tools.file", description: "tools.fileDesc" };
  }
}
