import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { findGrok } from "./findGrok.js";
import { buildSystemProxyEnvironment } from "./systemProxy.js";

const execFileAsync = promisify(execFile);

/** One user-invocable skill shown as a `/name` slash command. */
export type SlashCommand = {
  name: string;
  description: string;
  /** ACP unstructured input hint, when the command accepts arguments. */
  inputHint?: string;
  /** Origin label for the menu (bundled / user / project / plugin / …). */
  source: string;
  /** Plugin name when the skill comes from a plugin, else null. */
  plugin: string | null;
};

/** GUI-local slash commands (always available; not from `grok inspect`). */
export const BUILTIN_SLASH_COMMANDS: SlashCommand[] = [
  {
    name: "browser",
    description:
      "Open built-in browser pane for form fill / click automation. /browser off to close.",
    source: "builtin",
    plugin: null,
  },
  {
    name: "computer",
    description:
      "Control native desktop apps with Open Computer Use. Example: /computer open TextEdit.",
    source: "builtin",
    plugin: null,
  },
  {
    // First-turn fallback: ACP publishes the authoritative command list once
    // a real session exists. The pinned 0.2.111 runtime supports /goal.
    name: "goal",
    description: "Set, manage, or check an autonomous goal.",
    inputHint:
      "<objective> [--budget <tokens>] | status | pause | resume | clear",
    source: "agent-core",
    plugin: null,
  },
];

type AgentAvailableCommand = {
  name?: unknown;
  description?: unknown;
  input?: { hint?: unknown } | null;
};

/** Normalize ACP `available_commands_update` into the composer model. */
export function normalizeAgentSlashCommands(raw: unknown): SlashCommand[] {
  if (!Array.isArray(raw)) return [];
  const commands: SlashCommand[] = [];
  const seen = new Set<string>();
  for (const item of raw as AgentAvailableCommand[]) {
    const name =
      typeof item?.name === "string" ? item.name.trim().toLowerCase() : "";
    if (!name || seen.has(name) || !/^[a-z0-9][a-z0-9_:-]{0,63}$/i.test(name)) {
      continue;
    }
    seen.add(name);
    const description =
      typeof item.description === "string" ? item.description.trim() : "";
    const inputHint =
      typeof item.input?.hint === "string" && item.input.hint.trim()
        ? item.input.hint.trim()
        : undefined;
    commands.push({
      name,
      description,
      inputHint,
      source: "agent",
      plugin: null,
    });
  }
  return commands.sort((a, b) => a.name.localeCompare(b.name));
}

type InspectSkill = {
  name?: unknown;
  description?: unknown;
  userInvocable?: unknown;
  source?: {
    type?: unknown;
    path?: unknown;
    plugin?: unknown;
    name?: unknown;
  };
};

type InspectPayload = {
  skills?: InspectSkill[];
};

function sourceLabel(skill: InspectSkill): { source: string; plugin: string | null } {
  const src = skill.source;
  if (!src || typeof src !== "object") {
    return { source: "skill", plugin: null };
  }
  const type =
    typeof src.type === "string" && src.type.trim() ? src.type.trim() : "skill";
  const plugin =
    typeof src.plugin === "string" && src.plugin.trim()
      ? src.plugin.trim()
      : typeof src.name === "string" && type === "plugin"
        ? src.name.trim()
        : null;
  if (plugin) return { source: `plugin:${plugin}`, plugin };
  return { source: type, plugin: null };
}

function parseInspectJson(raw: string): SlashCommand[] {
  let data: InspectPayload;
  try {
    data = JSON.parse(raw) as InspectPayload;
  } catch {
    return [];
  }
  const skills = Array.isArray(data.skills) ? data.skills : [];
  const out: SlashCommand[] = [];
  const seen = new Set<string>();

  for (const skill of skills) {
    if (skill.userInvocable === false) continue;
    const name =
      typeof skill.name === "string" ? skill.name.trim().toLowerCase() : "";
    if (!name || seen.has(name)) continue;
    // Skills become /name; reject names that can't be slash tokens.
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(name)) continue;
    seen.add(name);
    const description =
      typeof skill.description === "string" ? skill.description.trim() : "";
    const { source, plugin } = sourceLabel(skill);
    out.push({ name, description, source, plugin });
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * Discover slash-invocable skills via `grok inspect --json` for the given cwd.
 * Agent owns skill truth; GUI only mirrors for autocomplete.
 */
export async function listSlashCommands(
  cwd?: string | null,
  agentCommands: SlashCommand[] = [],
): Promise<{ ok: true; commands: SlashCommand[] } | { ok: false; error: string }> {
  const probe = findGrok();
  if (!probe) {
    return { ok: false, error: "Grok binary not found" };
  }

  try {
    const env = await buildSystemProxyEnvironment();
    const { stdout, stderr } = await execFileAsync(
      probe.path,
      ["inspect", "--json"],
      {
        encoding: "utf8",
        timeout: 20_000,
        maxBuffer: 8 * 1024 * 1024,
        cwd: cwd && cwd.trim() ? cwd : process.cwd(),
        env,
      },
    );
    // Some builds may print warnings on stderr; still parse stdout.
    const discovered = parseInspectJson(stdout || "");
    if (discovered.length === 0 && stderr?.trim()) {
      // Empty can be legitimate; only surface stderr when we got nothing.
      console.warn("[grok-gui] grok inspect stderr:", stderr.slice(0, 500));
    }
    // Agent session commands are authoritative, then inspected skills, with
    // GUI/fallback builtins filling only names neither source advertised.
    const merged = new Map<string, SlashCommand>();
    for (const command of BUILTIN_SLASH_COMMANDS) {
      merged.set(command.name.toLowerCase(), command);
    }
    for (const command of discovered) {
      merged.set(command.name.toLowerCase(), command);
    }
    for (const command of agentCommands) {
      merged.set(command.name.toLowerCase(), command);
    }
    const commands = [...merged.values()];
    commands.sort((a, b) => a.name.localeCompare(b.name));
    return { ok: true, commands };
  } catch (e) {
    // Prefer builtins over hard fail so `/browser` autocomplete never dies.
    console.warn(
      "[grok-gui] listSlashCommands:",
      e instanceof Error ? e.message : e,
    );
    return {
      ok: true,
      commands: [...new Map(
        [...BUILTIN_SLASH_COMMANDS, ...agentCommands].map((command) => [
          command.name.toLowerCase(),
          command,
        ]),
      ).values()].sort((a, b) => a.name.localeCompare(b.name)),
    };
  }
}
