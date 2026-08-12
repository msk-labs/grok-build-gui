import { describe, expect, it } from "vitest";
import type { ChatImage } from "../types/chat";
import {
  draftKey,
  emptyComposerDraft,
  forgetComposerDraft,
  isEmptyComposerDraft,
  NEW_CHAT_DRAFT_KEY,
  switchComposerDraft,
  type ComposerDraft,
} from "./composerDrafts";

function img(id: string): ChatImage {
  return {
    id,
    mimeType: "image/png",
    dataUrl: "data:image/png;base64,abc",
  };
}

function draft(
  input: string,
  images: ChatImage[] = [],
  files: ComposerDraft["pendingFiles"] = [],
): ComposerDraft {
  return { input, pendingImages: images, pendingFiles: files };
}

describe("composerDrafts", () => {
  it("maps null session to the new-chat key", () => {
    expect(draftKey(null)).toBe(NEW_CHAT_DRAFT_KEY);
    expect(draftKey(undefined)).toBe(NEW_CHAT_DRAFT_KEY);
    expect(draftKey("s1")).toBe("s1");
  });

  it("treats blank drafts as empty", () => {
    expect(isEmptyComposerDraft(emptyComposerDraft())).toBe(true);
    expect(isEmptyComposerDraft(draft("  "))).toBe(false);
    expect(isEmptyComposerDraft(draft("", [img("i1")]))).toBe(false);
  });

  it("saves the left session and restores the target", () => {
    const a = draft("hello A", [img("a")]);
    const b = draft("hello B");
    const store = { sB: b };

    const first = switchComposerDraft(store, "sA", "sB", a);
    expect(first.draft).toEqual(b);
    expect(first.store.sA).toEqual(a);
    expect(first.store.sB).toEqual(b);

    // Leave B empty, return to A — A draft comes back.
    const second = switchComposerDraft(
      first.store,
      "sB",
      "sA",
      emptyComposerDraft(),
    );
    expect(second.draft).toEqual(a);
    expect(second.store.sB).toBeUndefined();
  });

  it("is a no-op when from and to keys match", () => {
    const current = draft("same");
    const store = { sA: draft("stale") };
    const result = switchComposerDraft(store, "sA", "sA", current);
    expect(result.store).toBe(store);
    expect(result.draft).toBe(current);
  });

  it("returns an empty draft when the target has none", () => {
    const result = switchComposerDraft({}, "sA", "sB", draft("x"));
    expect(result.draft).toEqual(emptyComposerDraft());
    expect(result.store.sA).toEqual(draft("x"));
  });

  it("forgets a single key without touching others", () => {
    const store = { sA: draft("a"), sB: draft("b") };
    expect(forgetComposerDraft(store, "sA")).toEqual({ sB: draft("b") });
    expect(forgetComposerDraft(store, "missing")).toBe(store);
  });
});
