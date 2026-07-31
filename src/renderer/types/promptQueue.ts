import type { ChatFile, ChatImage } from "./chat";

/** One follow-up waiting while a turn runs (TUI prompt-queue analogue). */
export type QueuedPrompt = {
  id: string;
  /** Session this item belongs to (drain only for that session). */
  sessionId: string;
  text: string;
  images: ChatImage[];
  files: ChatFile[];
  createdAt: number;
};
