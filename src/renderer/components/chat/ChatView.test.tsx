// @vitest-environment jsdom

import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../../types/chat";
import { ChatView } from "./ChatView";

function systemMessage(id: string, text: string): ChatMessage {
  return { id, role: "system", text, createdAt: 1 };
}

describe("ChatView auto-scroll", () => {
  it("lets an upward wheel gesture pause streaming auto-scroll immediately", () => {
    const first = systemMessage("one", "First");
    const view = render(<ChatView messages={[first]} />);
    const chat = view.container.querySelector(".chat") as HTMLDivElement;
    let scrollTop = 800;
    let scrollHeight = 1_000;
    const assignments: number[] = [];
    Object.defineProperties(chat, {
      clientHeight: { configurable: true, get: () => 200 },
      scrollHeight: { configurable: true, get: () => scrollHeight },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = value;
          assignments.push(value);
        },
      },
    });
    chat.scrollTo = vi.fn((options?: ScrollToOptions | number) => {
      if (typeof options === "object" && typeof options.top === "number") {
        scrollTop = options.top;
      }
    });

    fireEvent.wheel(chat, { deltaY: -120 });
    scrollTop = 650;
    fireEvent.scroll(chat);
    assignments.length = 0;
    scrollHeight = 1_200;

    view.rerender(
      <ChatView
        messages={[first, systemMessage("two", "Streaming update")]}
      />,
    );

    expect(assignments).not.toContain(1_200);
    expect(scrollTop).toBe(650);
  });
});
