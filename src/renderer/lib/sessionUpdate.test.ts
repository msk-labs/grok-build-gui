import { describe, expect, it } from "vitest";
import {
  attachTurnArtifacts,
  HistoryMessageAccumulator,
} from "./sessionUpdate";

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

describe("attachTurnArtifacts", () => {
  const assistant = {
    id: "a1",
    role: "assistant" as const,
    blocks: [],
    streaming: false,
    createdAt: 1,
  };
  const user = { id: "u1", role: "user" as const, text: "hi", createdAt: 0 };

  it("attaches to the newest assistant message", () => {
    const result = attachTurnArtifacts(
      [user, { ...assistant, id: "a0" }, assistant],
      ["report.xlsx"],
    );

    expect(result[1]).toEqual({ ...assistant, id: "a0" });
    expect(result[2]).toMatchObject({ id: "a1", artifacts: ["report.xlsx"] });
  });

  it("is a no-op with no paths or no assistant turn", () => {
    const messages = [user, assistant];
    expect(attachTurnArtifacts(messages, [])).toBe(messages);
    expect(attachTurnArtifacts([user], ["a.xlsx"])).toEqual([user]);
  });
});
