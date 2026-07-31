import { describe, expect, it } from "vitest";
import { createSelectionIntent } from "./selectionIntent";

describe("createSelectionIntent", () => {
  it("accepts every session before the first click", () => {
    const sel = createSelectionIntent();
    expect(sel.isCurrent("a")).toBe(true);
    expect(sel.isCurrent("b")).toBe(true);
  });

  it("lets the newest click supersede an in-flight one", () => {
    const sel = createSelectionIntent();
    sel.claim("a");
    expect(sel.isCurrent("a")).toBe(true);
    sel.claim("b");
    expect(sel.isCurrent("a")).toBe(false);
    expect(sel.isCurrent("b")).toBe(true);
  });

  it("keeps a superseded load suppressed for its whole lifetime", () => {
    const sel = createSelectionIntent();
    sel.claim("slow");
    sel.claim("fast");
    // "fast" is a cached session that resolves immediately; "slow" is still
    // replaying and must not reclaim focus when its events finally arrive.
    expect(sel.isCurrent("slow")).toBe(false);
    expect(sel.isCurrent("fast")).toBe(true);
  });

  it("survives a burst of rapid clicks, keeping only the last", () => {
    const sel = createSelectionIntent();
    for (const id of ["a", "b", "c", "d"]) sel.claim(id);
    expect(["a", "b", "c"].every((id) => !sel.isCurrent(id))).toBe(true);
    expect(sel.isCurrent("d")).toBe(true);
  });

  it("treats re-clicking the same session as still current", () => {
    const sel = createSelectionIntent();
    sel.claim("a");
    sel.claim("a");
    expect(sel.isCurrent("a")).toBe(true);
  });

  it("suppresses everything after leaving chat for a new-chat draft", () => {
    const sel = createSelectionIntent();
    sel.claim("a");
    sel.claimNone();
    // The in-flight load for "a" must not drag focus back onto the draft.
    expect(sel.isCurrent("a")).toBe(false);
    expect(sel.isCurrent("b")).toBe(false);
  });

  it("distinguishes 'chose no session' from 'no click yet'", () => {
    const fresh = createSelectionIntent();
    const left = createSelectionIntent();
    left.claimNone();
    expect(fresh.isCurrent("a")).toBe(true);
    expect(left.isCurrent("a")).toBe(false);
  });

  it("elects a session again after a new-chat draft", () => {
    const sel = createSelectionIntent();
    sel.claimNone();
    sel.claim("a");
    expect(sel.isCurrent("a")).toBe(true);
  });
});
