/**
 * Local `/browser` command parsing (GUI-owned, not a Grok marketplace skill).
 */

export type BrowserSlashAction =
  | { kind: "open"; url?: string; agentText?: string }
  | { kind: "close" }
  | { kind: "none" };

/**
 * Detect `/browser` at the start of a submitted message.
 * - `/browser` / `/browser on` → open pane
 * - `/browser off` / `/browser close` → close pane
 * - `/browser https://… rest` → open, navigate, optional agent prompt
 * - `/browser do something` → open + send the remainder unchanged to the agent
 */
export function parseBrowserSlash(raw: string): BrowserSlashAction {
  const text = raw.trim();
  if (!text.startsWith("/browser")) return { kind: "none" };
  // Must be exact command token: /browser or /browser …
  if (text !== "/browser" && !text.startsWith("/browser ") && !text.startsWith("/browser\n")) {
    return { kind: "none" };
  }

  const rest = text.slice("/browser".length).trim();
  if (!rest) return { kind: "open" };

  const lower = rest.toLowerCase();
  if (lower === "off" || lower === "close" || lower === "hide") {
    return { kind: "close" };
  }
  if (lower === "on" || lower === "open" || lower === "show") {
    return { kind: "open" };
  }

  // URL as first token?
  const firstSpace = rest.search(/\s/);
  const first = firstSpace < 0 ? rest : rest.slice(0, firstSpace);
  const after = firstSpace < 0 ? "" : rest.slice(firstSpace).trim();
  const looksLikeUrl =
    /^(https?:\/\/|www\.)/i.test(first) ||
    (/^[a-z0-9.-]+\.[a-z]{2,}([/:?#].*)?$/i.test(first) && !first.includes(" "));

  if (looksLikeUrl) {
    const url = first.startsWith("www.") ? `https://${first}` : first;
    return {
      kind: "open",
      url,
      agentText: after || undefined,
    };
  }

  return { kind: "open", agentText: rest };
}

export const BROWSER_SLASH_COMMAND = {
  name: "browser",
  description:
    "Open the built-in live browser pane with agent automation. /browser off to close.",
  source: "builtin",
  plugin: null as string | null,
};
