import type { ChatFile, ChatImage } from "../types/chat";

/** Unsent composer content for one chat (session or new-chat draft). */
export type ComposerDraft = {
  input: string;
  pendingImages: ChatImage[];
  pendingFiles: ChatFile[];
};

/** Map key while `activeId` is null (new-chat / no session focused). */
export const NEW_CHAT_DRAFT_KEY = "__new__";

export function draftKey(sessionId: string | null | undefined): string {
  return sessionId ?? NEW_CHAT_DRAFT_KEY;
}

export function emptyComposerDraft(): ComposerDraft {
  return { input: "", pendingImages: [], pendingFiles: [] };
}

export function isEmptyComposerDraft(d: ComposerDraft): boolean {
  return (
    !d.input &&
    d.pendingImages.length === 0 &&
    d.pendingFiles.length === 0
  );
}

/**
 * Persist the draft the user is leaving, then return the draft for the target.
 * Empty drafts are dropped from the store so the map stays small.
 */
export function switchComposerDraft(
  store: Record<string, ComposerDraft>,
  fromKey: string,
  toKey: string,
  current: ComposerDraft,
): { store: Record<string, ComposerDraft>; draft: ComposerDraft } {
  if (fromKey === toKey) {
    return { store, draft: current };
  }
  const next: Record<string, ComposerDraft> = { ...store };
  if (isEmptyComposerDraft(current)) {
    delete next[fromKey];
  } else {
    next[fromKey] = current;
  }
  const draft = next[toKey] ?? emptyComposerDraft();
  return { store: next, draft };
}

/** Remove one session's saved draft (delete session, after send, etc.). */
export function forgetComposerDraft(
  store: Record<string, ComposerDraft>,
  key: string,
): Record<string, ComposerDraft> {
  if (!(key in store)) return store;
  const next = { ...store };
  delete next[key];
  return next;
}
