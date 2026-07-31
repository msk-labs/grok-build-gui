import { describe, expect, it } from "vitest";
import { HistoryMessageAccumulator } from "./sessionUpdate";

function replayChunk(sessionUpdate: string, text: string) {
  return {
    sessionId: "session-1",
    _meta: { isReplay: true },
    update: {
      sessionUpdate,
      content: { type: "text", text },
    },
  };
}

describe("HistoryMessageAccumulator", () => {
  it("keeps message ids stable across progressive snapshots", () => {
    const history = new HistoryMessageAccumulator();
    history.push(replayChunk("user_message_chunk", "Question"));
    history.push(replayChunk("agent_message_chunk", "First"));

    const first = history.finish();
    history.push(replayChunk("agent_message_chunk", " second"));
    const second = history.finish();

    expect(second.map((message) => message.id)).toEqual(
      first.map((message) => message.id),
    );
    const assistant = second[1];
    expect(assistant?.role).toBe("assistant");
    if (assistant?.role === "assistant") {
      expect(assistant.blocks).toMatchObject([
        { type: "text", text: "First second" },
      ]);
    }
  });
});
