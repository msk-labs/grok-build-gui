/**
 * Last-click-wins tracking for sidebar session switching.
 *
 * Loading a session's history is a round trip: the main process answers with
 * `history-start` / `history-end` events plus a `loadSession` reply. Clicking a
 * second session before the first load finishes leaves two loads in flight,
 * and whichever finishes last would otherwise decide what the UI shows.
 *
 * The intent records the session the user asked for most recently. History
 * events for any other session still update *that session's* cached messages,
 * they just no longer drive focus or the loading spinner.
 *
 * The intent is never released, only superseded — a load left in flight when
 * the user switches away must stay superseded for as long as it runs, not just
 * until the newer selection finishes. `null` (no click yet this run) accepts
 * everything, which matters only for loads the user did not initiate.
 */
export type SelectionIntent = {
  /** Record a click. Supersedes any earlier one still in flight. */
  claim: (sessionId: string) => void;
  /**
   * Supersede every in-flight load without electing a new session — for
   * leaving chat entirely (new-chat draft, deleting the focused session).
   * Without this, a load still in flight would drag focus back on arrival.
   */
  claimNone: () => void;
  /**
   * True when history events for `sessionId` may drive focus: either nothing
   * has been clicked yet, or this is the session clicked last.
   */
  isCurrent: (sessionId: string) => boolean;
};

/** Distinct from `null`: "the user chose no session", not "no click yet". */
const NONE = Symbol("no-session");

export function createSelectionIntent(): SelectionIntent {
  let current: string | typeof NONE | null = null;
  return {
    claim: (sessionId) => {
      current = sessionId;
    },
    claimNone: () => {
      current = NONE;
    },
    isCurrent: (sessionId) => current === null || current === sessionId,
  };
}
