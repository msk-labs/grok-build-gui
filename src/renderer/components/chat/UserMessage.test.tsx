// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "../../lib/i18n";
import type { ChatImage, ChatMessage } from "../../types/chat";
import { UserMessage } from "./MessageBubble";

function image(id: string): ChatImage {
  return {
    id,
    mimeType: "image/png",
    dataUrl: "data:image/png;base64,cG5n",
  };
}

function message(images: ChatImage[]): Extract<ChatMessage, { role: "user" }> {
  return {
    id: "user-message",
    role: "user",
    text: "Compare these images",
    images,
    createdAt: 1,
  };
}

describe("UserMessage image layout", () => {
  it("uses the compact gallery for multiple images", () => {
    const view = render(
      <UserMessage message={message([image("one"), image("two")])} />,
    );

    expect(view.container.querySelector(".message-images.is-gallery")).toBeTruthy();
  });

  it("keeps a single image in the large preview layout", () => {
    const view = render(<UserMessage message={message([image("one")])} />);

    expect(view.container.querySelector(".message-images")).toBeTruthy();
    expect(view.container.querySelector(".message-images.is-gallery")).toBeNull();
  });
});
