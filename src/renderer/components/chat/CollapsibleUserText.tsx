import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useTranslation } from "react-i18next";
import { HighlightText } from "./HighlightText";

const COLLAPSED_LINE_COUNT = 20;

export function CollapsibleUserText({
  text,
  query,
}: {
  text: string;
  query?: string | null;
}) {
  const { t } = useTranslation();
  const textRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [collapsible, setCollapsible] = useState(false);

  const measure = useCallback(() => {
    if (expanded) return;
    const element = textRef.current;
    if (!element) return;
    setCollapsible(element.scrollHeight > element.clientHeight + 1);
  }, [expanded]);

  useLayoutEffect(() => {
    measure();
    const element = textRef.current;
    if (!element || expanded || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, measure, text]);

  useEffect(() => {
    setExpanded(false);
  }, [text]);

  useEffect(() => {
    const normalizedQuery = query?.trim().toLowerCase();
    if (normalizedQuery && text.toLowerCase().includes(normalizedQuery)) {
      setExpanded(true);
    }
  }, [query, text]);

  return (
    <div className="user-message-content">
      <div
        ref={textRef}
        className={
          expanded ? "user-message-text" : "user-message-text user-message-text-collapsed"
        }
        style={
          expanded
            ? undefined
            : { "--collapsed-lines": COLLAPSED_LINE_COUNT } as CSSProperties
        }
      >
        <HighlightText text={text} query={query} />
      </div>
      {collapsible ? (
        <button
          type="button"
          className="user-message-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? t("tools.showLess") : t("tools.showMore")}
          <span
            className={
              expanded
                ? "user-message-toggle-chevron expanded"
                : "user-message-toggle-chevron"
            }
            aria-hidden="true"
          >
            ⌄
          </span>
        </button>
      ) : null}
    </div>
  );
}
