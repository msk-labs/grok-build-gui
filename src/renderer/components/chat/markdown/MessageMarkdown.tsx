import {
  useMemo,
  type MouseEvent,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components, type Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import { classifyChatLink } from "../../../lib/chatLink";
import { splitHighlightRuns } from "../../../lib/chatSearch";
import type { OpenFileViewRequest } from "../FileChangeBar";
import { MarkdownCodeBlock } from "./MarkdownCodeBlock";
import "./markdown.css";

type Props = {
  text: string;
  streaming?: boolean;
  highlightQuery?: string | null;
  onOpenFile?: (request: OpenFileViewRequest) => void;
};

type HastNode = {
  type?: string;
  tagName?: string;
  value?: string;
  children?: HastNode[];
  properties?: Record<string, unknown>;
};

/** GFM renderer shared by intermediate and final assistant text. */
export function MessageMarkdown({
  text,
  streaming = false,
  highlightQuery,
  onOpenFile,
}: Props) {
  const components = useMemo<Components>(
    () => ({
      a: ({ href = "", children }) => (
        <MarkdownLink href={href} onOpenFile={onOpenFile}>
          {children}
        </MarkdownLink>
      ),
      pre: ({ children }) => (
        <MarkdownCodeBlock streaming={streaming}>{children}</MarkdownCodeBlock>
      ),
      table: ({ children }) => (
        <div className="markdown-table-wrap">
          <table>{children}</table>
        </div>
      ),
      img: ({ src = "", alt = "" }) => <MarkdownImage src={src} alt={alt} />,
    }),
    [onOpenFile, streaming],
  );

  const rehypePlugins = useMemo<NonNullable<Options["rehypePlugins"]>>(() => {
    const query = highlightQuery?.trim();
    return query ? [[rehypeSearchHighlight, { query }]] : [];
  }, [highlightQuery]);

  return (
    <div className={`message-markdown${streaming ? " is-streaming" : ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={rehypePlugins}
        components={components}
        skipHtml
        urlTransform={(url) => url}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function MarkdownLink({
  href,
  onOpenFile,
  children,
}: {
  href: string;
  onOpenFile?: (request: OpenFileViewRequest) => void;
  children: ReactNode;
}) {
  const target = classifyChatLink(href);

  function openFile(event: MouseEvent<HTMLAnchorElement>) {
    if (target.kind !== "file" || !onOpenFile) return;
    event.preventDefault();
    onOpenFile({ path: target.path, mode: "content" });
  }

  if (target.kind === "blocked") {
    return <span className="markdown-link-blocked">{children}</span>;
  }
  if (target.kind === "file") {
    return onOpenFile ? (
      <a href={href} className="markdown-file-link" onClick={openFile}>
        {children}
      </a>
    ) : (
      <code>{children}</code>
    );
  }
  if (target.kind === "anchor") {
    return <a href={target.href}>{children}</a>;
  }
  return (
    <a href={target.href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

function MarkdownImage({ src, alt }: { src: string; alt: string }) {
  const allowed = /^(https?:|data:image\/)/i.test(src);
  return allowed ? (
    <img className="markdown-image" src={src} alt={alt} loading="lazy" />
  ) : (
    <span className="markdown-link-blocked">{alt || src}</span>
  );
}

function rehypeSearchHighlight(options: { query: string }) {
  return (tree: HastNode) => {
    highlightChildren(tree, options.query.toLowerCase(), false);
  };
}

function highlightChildren(node: HastNode, query: string, skipped: boolean) {
  const nextSkipped =
    skipped ||
    node.tagName === "code" ||
    node.tagName === "pre" ||
    node.tagName === "script";
  if (!node.children || nextSkipped) return;

  const next: HastNode[] = [];
  for (const child of node.children) {
    if (child.type === "text" && typeof child.value === "string") {
      for (const run of splitHighlightRuns(child.value, query)) {
        next.push(
          run.hit
            ? {
                type: "element",
                tagName: "mark",
                properties: { className: ["search-hit"] },
                children: [{ type: "text", value: run.text }],
              }
            : { type: "text", value: run.text },
        );
      }
    } else {
      highlightChildren(child, query, nextSkipped);
      next.push(child);
    }
  }
  node.children = next;
}
