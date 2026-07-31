import type { SlashCommand } from "../../../electron/preload";

export type { SlashCommand };

/** First slash token being typed at the start of the composer value. */
export type SlashQuery = {
  /** Text after `/` (may be empty). */
  query: string;
  /** Full match length including leading `/` (replace range start→end). */
  matchLength: number;
};

/**
 * Detect an open slash-command query at the start of the input.
 * Active only for the first token: `/` or `/name` with no trailing space yet.
 * Once the user has `/name rest…`, autocomplete closes (command already chosen).
 */
export function parseSlashQuery(value: string): SlashQuery | null {
  if (!value.startsWith("/")) return null;
  // Allow optional leading whitespace only after we already have content? No —
  // slash must be at position 0 so forced skill invocation stays unambiguous.
  const rest = value.slice(1);
  // Space (or newline) after the command name ends autocomplete.
  const space = rest.search(/[\s\n]/);
  if (space === 0) return null; // "/ " — not a skill token
  if (space > 0) return null;
  return { query: rest, matchLength: value.length };
}

/** Case-insensitive filter: name prefix first, then description contains. */
export function filterSlashCommands(
  commands: SlashCommand[],
  query: string,
): SlashCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  const prefix: SlashCommand[] = [];
  const contains: SlashCommand[] = [];
  for (const cmd of commands) {
    const name = cmd.name.toLowerCase();
    if (name.startsWith(q)) {
      prefix.push(cmd);
      continue;
    }
    if (
      name.includes(q) ||
      cmd.description.toLowerCase().includes(q) ||
      (cmd.plugin?.toLowerCase().includes(q) ?? false)
    ) {
      contains.push(cmd);
    }
  }
  return [...prefix, ...contains];
}

/** Replace the leading `/query` with `/name ` (trailing space for args). */
export function applySlashCommand(value: string, name: string): string {
  const parsed = parseSlashQuery(value);
  if (!parsed) {
    const trimmed = value.trimStart();
    if (trimmed.startsWith("/")) {
      // Fallback: replace first token only.
      const m = trimmed.match(/^\/\S*/);
      if (m) {
        const lead = value.length - trimmed.length;
        return value.slice(0, lead) + `/${name} ` + trimmed.slice(m[0].length).replace(/^\s*/, "");
      }
    }
    return `/${name} ${value}`;
  }
  return `/${name} ${value.slice(parsed.matchLength).replace(/^\s*/, "")}`;
}

/** Short one-line description for the menu. */
export function shortDescription(text: string, max = 90): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  return `${one.slice(0, max - 1)}…`;
}
