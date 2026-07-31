import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createImeCompositionLatch,
  isImeKeyEvent,
} from "./imeKeys";

function keyEvent(
  partial: Partial<{
    key: string;
    code: string;
    isComposing: boolean;
    keyCode: number;
  }>,
) {
  return {
    key: partial.key ?? "",
    code: partial.code,
    isComposing: partial.isComposing,
    keyCode: partial.keyCode,
  };
}

describe("isImeKeyEvent", () => {
  it("detects isComposing and keyCode 229", () => {
    expect(isImeKeyEvent({ isComposing: true })).toBe(true);
    expect(isImeKeyEvent({ keyCode: 229 })).toBe(true);
    expect(isImeKeyEvent({ keyCode: 13 })).toBe(false);
    expect(
      isImeKeyEvent({ nativeEvent: { isComposing: true } }),
    ).toBe(true);
    expect(
      isImeKeyEvent({ nativeEvent: { keyCode: 229 } }),
    ).toBe(true);
  });
});

describe("createImeCompositionLatch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("blocks Enter only while actively composing (live IME)", () => {
    const latch = createImeCompositionLatch(50);
    latch.onCompositionStart();
    expect(
      latch.decideEnter(
        keyEvent({ key: "Enter", code: "Enter", isComposing: true, keyCode: 229 }),
      ),
    ).toBe("live-ime");
    latch.dispose();
  });

  it("after Space confirm, Enter is pass (send) — no false newline path", () => {
    const latch = createImeCompositionLatch(50);
    latch.onCompositionStart();
    // CJK IME often reports key as Process; code identifies Space.
    latch.observeKey(
      keyEvent({ key: "Process", code: "Space", isComposing: true, keyCode: 229 }),
    );
    latch.onCompositionEnd();
    expect(latch.isComposing()).toBe(false);
    expect(
      latch.decideEnter(keyEvent({ key: "Enter", code: "Enter", keyCode: 13 })),
    ).toBe("pass");
    latch.dispose();
  });

  it("after digit confirm, Enter is pass", () => {
    const latch = createImeCompositionLatch(50);
    latch.onCompositionStart();
    latch.observeKey(
      keyEvent({ key: "Process", code: "Digit1", isComposing: true, keyCode: 229 }),
    );
    latch.onCompositionEnd();
    expect(
      latch.decideEnter(keyEvent({ key: "Enter", code: "Enter", keyCode: 13 })),
    ).toBe("pass");
    latch.dispose();
  });

  it("after Enter confirm during composition, next Enter is pass (no double-swallow)", () => {
    const latch = createImeCompositionLatch(50);
    latch.onCompositionStart();
    latch.observeKey(
      keyEvent({
        key: "Enter",
        code: "Enter",
        isComposing: true,
        keyCode: 229,
      }),
    );
    // Confirming Enter already handled as live-ime; composition ends.
    latch.onCompositionEnd();
    expect(
      latch.decideEnter(keyEvent({ key: "Enter", code: "Enter", keyCode: 13 })),
    ).toBe("pass");
    latch.dispose();
  });

  it("compositionend-before-Enter race: swallows one Enter then passes", () => {
    const latch = createImeCompositionLatch(50);
    latch.onCompositionStart();
    // Last key is pinyin letter — engine will fire compositionend then Enter.
    latch.observeKey(
      keyEvent({ key: "Process", code: "KeyN", isComposing: true, keyCode: 229 }),
    );
    latch.onCompositionEnd();
    expect(latch.isComposing()).toBe(true);
    expect(
      latch.decideEnter(keyEvent({ key: "Enter", code: "Enter", keyCode: 13 })),
    ).toBe("swallow");
    // One-shot: second Enter sends.
    expect(
      latch.decideEnter(keyEvent({ key: "Enter", code: "Enter", keyCode: 13 })),
    ).toBe("pass");
    latch.dispose();
  });

  it("race latch expires after timeout without consuming Enter", () => {
    const latch = createImeCompositionLatch(50);
    latch.onCompositionStart();
    latch.observeKey(
      keyEvent({ key: "Process", code: "KeyA", isComposing: true, keyCode: 229 }),
    );
    latch.onCompositionEnd();
    vi.advanceTimersByTime(50);
    expect(latch.isComposing()).toBe(false);
    expect(
      latch.decideEnter(keyEvent({ key: "Enter", code: "Enter", keyCode: 13 })),
    ).toBe("pass");
    latch.dispose();
  });

  it("reset clears stuck composing state", () => {
    const latch = createImeCompositionLatch(50);
    latch.onCompositionStart();
    expect(latch.shouldIgnoreKey(keyEvent({ key: "a", isComposing: true }))).toBe(
      true,
    );
    latch.reset();
    expect(latch.isComposing()).toBe(false);
    expect(
      latch.decideEnter(keyEvent({ key: "Enter", code: "Enter", keyCode: 13 })),
    ).toBe("pass");
    latch.dispose();
  });
});
