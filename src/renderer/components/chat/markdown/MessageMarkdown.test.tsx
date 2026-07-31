// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MessageMarkdown } from "./MessageMarkdown";

describe("MessageMarkdown", () => {
  it("renders GFM tables and fenced code as dedicated UI", () => {
    const { container } = render(
      <MessageMarkdown
        text={"| A | B |\n|---|---|\n| 1 | 2 |\n\n```ts\nconst n = 1;\n```"}
      />,
    );

    expect(screen.getByRole("table")).toBeTruthy();
    expect(container.querySelector(".markdown-code-block")).toBeTruthy();
    expect(screen.getByText("ts")).toBeTruthy();
  });

  it("uses an icon-only copy control for command-line code blocks", () => {
    const { container } = render(
      <MessageMarkdown text={"```bash\nnpm run build\n```"} />,
    );

    const copyButton = container.querySelector(".markdown-code-copy");
    expect(copyButton?.getAttribute("aria-label")).toBeTruthy();
    expect(copyButton?.textContent).toBe("");
    expect(copyButton?.querySelector("svg")).toBeTruthy();
  });

  it("loads token highlighting for a known fenced language", async () => {
    const { container } = render(
      <MessageMarkdown text={"```ts\nconst answer: number = 42;\n```"} />,
    );

    await waitFor(() => {
      expect(container.querySelector(".hljs-keyword")?.textContent).toBe(
        "const",
      );
    });
  });

  it("keeps the highlighted prefix while a streaming tail grows", async () => {
    const { container, rerender } = render(
      <MessageMarkdown text={"```ts\nconst first = 1;"} streaming />,
    );
    await waitFor(() => {
      expect(container.querySelector(".hljs-keyword")).toBeTruthy();
    });

    rerender(
      <MessageMarkdown
        text={"```ts\nconst first = 1;\nconst second = 2;"}
        streaming
      />,
    );

    expect(container.querySelector(".hljs-keyword")?.textContent).toBe("const");
    expect(container.querySelector("pre")?.textContent).toContain(
      "const second = 2;",
    );
  });

  it("keeps a growing streaming comment italic between highlight passes", async () => {
    const { container, rerender } = render(
      <MessageMarkdown text={"```ts\n// comm"} streaming />,
    );
    await waitFor(() => {
      expect(container.querySelector(".hljs-comment")).toBeTruthy();
    });

    rerender(<MessageMarkdown text={"```ts\n// comment"} streaming />);

    const commentRuns = [...container.querySelectorAll(".hljs-comment")]
      .map((node) => node.textContent)
      .join("");
    expect(commentRuns).toBe("// comment");
    expect(container.querySelector("code")?.childNodes).toHaveLength(2);
  });

  it("routes relative Markdown links to the file viewer", () => {
    const onOpenFile = vi.fn();
    render(
      <MessageMarkdown
        text={"Open [the component](src/App.tsx)."}
        onOpenFile={onOpenFile}
      />,
    );

    fireEvent.click(screen.getByRole("link", { name: "the component" }));
    expect(onOpenFile).toHaveBeenCalledWith({
      path: "src/App.tsx",
      mode: "content",
    });
  });

  it("routes file URLs through the same controlled file action", () => {
    const onOpenFile = vi.fn();
    render(
      <MessageMarkdown
        text={"[local file](file:///tmp/a%20b.ts)"}
        onOpenFile={onOpenFile}
      />,
    );

    fireEvent.click(screen.getByRole("link", { name: "local file" }));
    expect(onOpenFile).toHaveBeenCalledWith({
      path: "/tmp/a b.ts",
      mode: "content",
    });
  });

  it("does not create a link for dangerous protocols", () => {
    render(<MessageMarkdown text={"[unsafe](javascript:alert(1))"} />);
    expect(screen.queryByRole("link", { name: "unsafe" })).toBeNull();
    expect(screen.getByText("unsafe").className).toContain("markdown-link-blocked");
  });
});
