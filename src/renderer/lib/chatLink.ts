export type ChatLinkTarget =
  | { kind: "external"; href: string }
  | { kind: "file"; path: string }
  | { kind: "anchor"; href: string }
  | { kind: "blocked" };

const EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/**
 * Classify Markdown links without granting arbitrary URL schemes access to
 * Electron. Relative links are treated as workspace file references.
 */
export function classifyChatLink(href: string): ChatLinkTarget {
  const value = href.trim();
  if (!value) return { kind: "blocked" };
  if (value.startsWith("#")) return { kind: "anchor", href: value };

  if (value.startsWith("file://")) {
    const path = decodePath(value.slice("file://".length));
    return path ? { kind: "file", path } : { kind: "blocked" };
  }

  const scheme = value.match(/^([a-z][a-z0-9+.-]*):/i)?.[1];
  if (scheme) {
    const protocol = `${scheme.toLowerCase()}:`;
    return EXTERNAL_PROTOCOLS.has(protocol)
      ? { kind: "external", href: value }
      : { kind: "blocked" };
  }

  const path = decodePath(value.replace(/[?#].*$/, ""));
  return path ? { kind: "file", path } : { kind: "blocked" };
}

export function isSafeExternalUrl(value: string): boolean {
  try {
    return EXTERNAL_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

function decodePath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
