import { splitHighlightRuns } from "../../lib/chatSearch";

type Props = {
  text: string;
  /** When set, matching substrings are wrapped in <mark>. */
  query?: string | null;
  className?: string;
};

/** Plain text with optional case-insensitive search highlights. */
export function HighlightText({ text, query, className }: Props) {
  if (!query?.trim()) {
    return className ? (
      <span className={className}>{text}</span>
    ) : (
      <>{text}</>
    );
  }

  const runs = splitHighlightRuns(text, query);
  return (
    <span className={className}>
      {runs.map((r, i) =>
        r.hit ? (
          <mark key={i} className="search-hit">
            {r.text}
          </mark>
        ) : (
          <span key={i}>{r.text}</span>
        ),
      )}
    </span>
  );
}
