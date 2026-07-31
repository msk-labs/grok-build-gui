// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GrokApi } from "../../../electron/preload";
import { ComposerImageAttachment } from "./ComposerImageAttachment";

const image = {
  id: "image-1",
  mimeType: "image/png",
  dataUrl: "data:image/png;base64,cG5n",
  name: "capture.png",
};

afterEach(() => {
  cleanup();
  delete (window as Window & { grok?: GrokApi }).grok;
});

function installApi(action: "copy" | "save" | "remove" | null) {
  const popupImageAttachmentMenu = vi.fn().mockResolvedValue(action);
  const copyImage = vi.fn().mockResolvedValue({ ok: true });
  const saveImage = vi.fn().mockResolvedValue({
    ok: true,
    path: "capture.png",
  });
  (window as Window & { grok?: GrokApi }).grok = {
    popupImageAttachmentMenu,
    copyImage,
    saveImage,
  } as unknown as GrokApi;
  return { popupImageAttachmentMenu, copyImage, saveImage };
}

describe("ComposerImageAttachment", () => {
  it("copies the image selected from its context menu", async () => {
    const api = installApi("copy");
    render(<ComposerImageAttachment image={image} />);

    fireEvent.contextMenu(screen.getByRole("img"));

    await waitFor(() => {
      expect(api.copyImage).toHaveBeenCalledWith(image.dataUrl);
    });
  });

  it("saves the image selected from its context menu", async () => {
    const api = installApi("save");
    render(<ComposerImageAttachment image={image} />);

    fireEvent.contextMenu(screen.getByRole("img"));

    await waitFor(() => {
      expect(api.saveImage).toHaveBeenCalledWith({
        dataUrl: image.dataUrl,
        defaultName: image.name,
      });
    });
  });

  it("removes the image selected from its context menu", async () => {
    installApi("remove");
    const onRemove = vi.fn();
    render(
      <ComposerImageAttachment image={image} onRemove={onRemove} />,
    );

    fireEvent.contextMenu(screen.getByRole("img"));

    await waitFor(() => {
      expect(onRemove).toHaveBeenCalledWith(image.id);
    });
  });
});
