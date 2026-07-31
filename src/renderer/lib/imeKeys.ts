/**
 * IME (Chinese / Japanese / Korean, etc.) key helpers.
 *
 * While composing, Enter confirms a candidate — it must not submit forms,
 * send chat, or select list items. Some engines fire `compositionend` before
 * the confirming Enter `keydown`, so a short post-end latch is needed.
 *
 * Important: most CJK users confirm with Space / number keys, then press Enter
 * to send. That post-send Enter must NOT be treated as IME, or the textarea
 * inserts a newline instead of submitting (especially if we skip preventDefault).
 */

const IME_KEY_CODE = 229;

export type ImeKeyLike = {
  key: string;
  code?: string;
  isComposing?: boolean;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean; keyCode?: number };
};

/** True when this key event is part of IME composition (incl. candidate confirm). */
export function isImeKeyEvent(e: {
  isComposing?: boolean;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean; keyCode?: number };
}): boolean {
  if (e.nativeEvent?.isComposing || e.nativeEvent?.keyCode === IME_KEY_CODE) {
    return true;
  }
  if (e.isComposing || e.keyCode === IME_KEY_CODE) return true;
  return false;
}

/**
 * Physical key that usually ends composition without needing a follow-up Enter.
 * Prefer `code` — during IME, `key` is often `"Process"`.
 */
function isConfirmWithoutEnterRace(code: string, key: string): boolean {
  if (
    code === "Enter" ||
    code === "NumpadEnter" ||
    code === "Space" ||
    code === "Escape" ||
    code.startsWith("Digit") ||
    // Numpad 0-9 only (not NumpadEnter / NumpadAdd / …)
    /^Numpad[0-9]$/.test(code)
  ) {
    return true;
  }
  // Fallback when `code` is missing (synthetic tests / odd hosts).
  if (key === "Enter" || key === " " || key === "Spacebar" || key === "Escape") {
    return true;
  }
  if (key.length === 1 && /[0-9]/.test(key)) return true;
  return false;
}

export type EnterImeDecision = "live-ime" | "swallow" | "pass";

/**
 * Tracks composition with a targeted post-end latch so only the rare
 * compositionend-before-Enter race swallows one Enter — not Space/digit confirm.
 */
export function createImeCompositionLatch(clearDelayMs = 50) {
  let composing = false;
  /** Swallow at most one Enter after compositionend (Enter-confirm race only). */
  let swallowEnter = false;
  let lastCode = "";
  let lastKey = "";
  let timer: ReturnType<typeof setTimeout> | undefined;

  function clearTimer() {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  function clearAll() {
    clearTimer();
    composing = false;
    swallowEnter = false;
  }

  return {
    onCompositionStart() {
      clearTimer();
      composing = true;
      swallowEnter = false;
      lastCode = "";
      lastKey = "";
    },

    onCompositionEnd() {
      clearTimer();
      const code = lastCode;
      const key = lastKey;
      composing = false;

      // Space / digit / Enter already finished the candidate during composition.
      // Do not block the user's next Enter (send / submit).
      if (isConfirmWithoutEnterRace(code, key)) {
        swallowEnter = false;
        return;
      }

      // Unknown end (often compositionend before confirming Enter keydown).
      // Swallow only the next Enter, briefly.
      swallowEnter = true;
      timer = setTimeout(() => {
        swallowEnter = false;
        timer = undefined;
      }, clearDelayMs);
    },

    /**
     * Record keys while composing so compositionend can tell Space vs Enter race.
     * Safe to call on every keydown.
     */
    observeKey(e: ImeKeyLike) {
      if (composing || isImeKeyEvent(e)) {
        lastKey = e.key;
        lastCode = e.code ?? "";
      }
    },

    isComposing() {
      return composing || swallowEnter;
    },

    /**
     * Skip app Arrow/Enter list actions while composing (not the post-end latch
     * alone — that only applies to Enter via decideEnter).
     */
    shouldIgnoreKey(e: ImeKeyLike) {
      this.observeKey(e);
      return isImeKeyEvent(e) || composing;
    },

    /**
     * How the composer/form should treat Enter:
     * - live-ime: let the engine handle (do not preventDefault)
     * - swallow: IME candidate confirm race — preventDefault, do not send
     * - pass: normal app Enter (send / submit)
     */
    decideEnter(e: ImeKeyLike): EnterImeDecision {
      this.observeKey(e);
      if (isImeKeyEvent(e) || composing) return "live-ime";
      if (swallowEnter) {
        swallowEnter = false;
        clearTimer();
        return "swallow";
      }
      return "pass";
    },

    /** Clear stuck state (blur, mic interrupt, unmount). */
    reset() {
      clearAll();
      lastCode = "";
      lastKey = "";
    },

    dispose() {
      this.reset();
    },
  };
}
