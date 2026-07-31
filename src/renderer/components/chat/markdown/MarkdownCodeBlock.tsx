import {
  Children,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { copyText } from "../copyText";
import type { HighlightedCode } from "./highlightCode";

const STREAM_HIGHLIGHT_INTERVAL_MS = 120;

type Props = {
  children?: ReactNode;
  streaming: boolean;
};

type CodeChildProps = {
  className?: string;
  children?: ReactNode;
};

type HighlightState = HighlightedCode & {
  requestedLanguage: string;
};

function CopyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function MarkdownCodeBlock({ children, streaming }: Props) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [highlighted, setHighlighted] = useState<HighlightState | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const lastStartedAtRef = useRef(0);
  const [visible, setVisible] = useState(
    () => typeof IntersectionObserver === "undefined",
  );

  const child = Children.only(children) as ReactElement<CodeChildProps>;
  const raw = isValidElement(child) ? String(child.props.children ?? "") : "";
  const code = raw.replace(/\n$/, "");
  const language = languageFromClassName(child.props.className);
  const latestRef = useRef({ code, language });
  latestRef.current = { code, language };

  useEffect(() => {
    if (visible) return;
    const node = containerRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;

    async function runHighlight() {
      timerRef.current = null;
      const input = latestRef.current;
      lastStartedAtRef.current = performance.now();
      const { highlightCode } = await import("./highlightCode");
      const result = highlightCode(input.code, input.language);
      if (!mountedRef.current) return;
      setHighlighted(
        result ? { ...result, requestedLanguage: input.language } : null,
      );
    }

    if (!streaming) {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      void runHighlight();
      return;
    }

    if (timerRef.current != null) return;
    const elapsed = performance.now() - lastStartedAtRef.current;
    const delay = Math.max(0, STREAM_HIGHLIGHT_INTERVAL_MS - elapsed);
    timerRef.current = window.setTimeout(() => {
      void runHighlight();
    }, delay);
  }, [code, language, streaming, visible]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const reusable =
    highlighted?.requestedLanguage === language &&
    code.startsWith(highlighted.code)
      ? highlighted
      : null;
  const unhighlightedTail = reusable
    ? code.slice(reusable.code.length)
    : code;
  const tailClass =
    reusable &&
    unhighlightedTail &&
    !unhighlightedTail.startsWith("\n")
      ? trailingHighlightClass(reusable.html)
      : null;

  async function copy() {
    try {
      await copyText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Leave the copy icon unchanged when both clipboard methods are unavailable.
    }
  }

  return (
    <div className="markdown-code-block" ref={containerRef}>
      <div className="markdown-code-header">
        <span>{language || "text"}</span>
        <button
          type="button"
          className={copied ? "markdown-code-copy is-copied" : "markdown-code-copy"}
          onClick={() => void copy()}
          title={copied ? t("chat.copied") : t("chat.copy")}
          aria-label={copied ? t("chat.copied") : t("chat.copy")}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>
      </div>
      <pre>
        <code className={child.props.className}>
          {reusable?.html ? (
            // highlight.js escapes source text before producing token markup.
            <span dangerouslySetInnerHTML={{ __html: reusable.html }} />
          ) : null}
          {tailClass ? (
            <span className={tailClass}>{unhighlightedTail}</span>
          ) : (
            unhighlightedTail
          )}
        </code>
      </pre>
    </div>
  );
}

export function languageFromClassName(className?: string): string {
  const token = className
    ?.split(/\s+/)
    .find((name) => name.startsWith("language-"));
  return token?.slice("language-".length).toLowerCase() ?? "";
}

/**
 * Preserve the style of a token that is still growing between throttled
 * highlight passes (most visibly a line comment changing italic/plain).
 * highlight.js always escapes source text, so the final flat token is safe to
 * recognize from its generated markup.
 */
export function trailingHighlightClass(html: string): string | null {
  const match = /<span class="([^"]+)">[^<]*<\/span>$/.exec(html);
  return match?.[1] ?? null;
}
