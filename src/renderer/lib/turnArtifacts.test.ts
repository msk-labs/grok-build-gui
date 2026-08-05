// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import type { ChatMessage } from "../types/chat";
import {
  forgetSessionArtifacts,
  lastAssistantOrdinal,
  restoreTurnArtifacts,
  saveTurnArtifacts,
} from "./turnArtifacts";

const user = (id: string): ChatMessage => ({
  id,
  role: "user",
  text: "hi",
  createdAt: 0,
});

const assistant = (id: string): ChatMessage => ({
  id,
  role: "assistant",
  blocks: [],
  streaming: false,
  createdAt: 0,
});

/** Two full exchanges: assistant ordinals 0 and 1. */
const transcript: ChatMessage[] = [
  user("u0"),
  assistant("a0"),
  user("u1"),
  assistant("a1"),
];

beforeEach(() => {
  localStorage.clear();
});

describe("lastAssistantOrdinal", () => {
  it("counts assistant messages only", () => {
    expect(lastAssistantOrdinal(transcript)).toBe(1);
    expect(lastAssistantOrdinal([user("u0")])).toBe(-1);
    expect(lastAssistantOrdinal([])).toBe(-1);
  });
});

describe("save / restore", () => {
  it("re-attaches artifacts to the same turn after a replay", () => {
    saveTurnArtifacts("s1", 1, ["report.xlsx"]);

    // A replay produces fresh message objects with new ids.
    const replayed = restoreTurnArtifacts("s1", [
      user("x0"),
      assistant("x1"),
      user("x2"),
      assistant("x3"),
    ]);

    expect(replayed[1]).not.toHaveProperty("artifacts");
    expect(replayed[3]).toMatchObject({ artifacts: ["report.xlsx"] });
  });

  it("keeps separate turns and separate sessions apart", () => {
    saveTurnArtifacts("s1", 0, ["a.xlsx"]);
    saveTurnArtifacts("s1", 1, ["b.docx"]);
    saveTurnArtifacts("s2", 0, ["other.pptx"]);

    const restored = restoreTurnArtifacts("s1", transcript);
    expect(restored[1]).toMatchObject({ artifacts: ["a.xlsx"] });
    expect(restored[3]).toMatchObject({ artifacts: ["b.docx"] });

    expect(restoreTurnArtifacts("s2", transcript)[1]).toMatchObject({
      artifacts: ["other.pptx"],
    });
  });

  it("returns the original list untouched when nothing is stored", () => {
    expect(restoreTurnArtifacts("unknown", transcript)).toBe(transcript);
  });

  it("ignores empty or invalid writes", () => {
    saveTurnArtifacts("s1", 1, []);
    saveTurnArtifacts("s1", -1, ["x.xlsx"]);
    saveTurnArtifacts("", 1, ["x.xlsx"]);

    expect(restoreTurnArtifacts("s1", transcript)).toBe(transcript);
  });

  it("drops a session's entries when it is deleted", () => {
    saveTurnArtifacts("s1", 1, ["report.xlsx"]);
    forgetSessionArtifacts("s1");

    expect(restoreTurnArtifacts("s1", transcript)).toBe(transcript);
  });

  it("survives corrupt storage", () => {
    localStorage.setItem("grok.turnArtifacts.v1", "{not json");
    expect(restoreTurnArtifacts("s1", transcript)).toBe(transcript);
    expect(() => saveTurnArtifacts("s1", 0, ["a.xlsx"])).not.toThrow();
  });

  it("evicts the oldest sessions past the cap", () => {
    for (let i = 0; i < 55; i += 1) {
      saveTurnArtifacts(`s${i}`, 0, [`f${i}.xlsx`]);
    }
    // s0..s4 evicted; the newest 50 remain.
    expect(restoreTurnArtifacts("s0", transcript)).toBe(transcript);
    expect(restoreTurnArtifacts("s54", transcript)[1]).toMatchObject({
      artifacts: ["f54.xlsx"],
    });
  });
});
