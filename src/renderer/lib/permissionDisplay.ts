/**
 * Turn ACP permission payloads into a human-readable summary.
 * Mirrors the CLI's build_permission_display intent without shell deps.
 */
import type { TFunction } from "i18next";

export type PermissionKindCategory =
  | "execute"
  | "edit"
  | "delete"
  | "read"
  | "mcp"
  | "other";

export type PermissionDetail = {
  /** Section label shown above the value (e.g. "Command"). */
  label: string;
  /** Preformatted body (command, path, JSON args). */
  body: string;
  /** Monospace code block vs plain text. */
  mono?: boolean;
};

export type PermissionDisplay = {
  category: PermissionKindCategory;
  /** Dialog heading, e.g. "Allow command?" */
  heading: string;
  /** One-line purpose (agent description or short title). */
  purpose: string | null;
  /** Structured detail blocks under the purpose. */
  details: PermissionDetail[];
  /** Soft risk hint when the payload looks destructive. */
  riskNote: string | null;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v != null && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

function firstString(
  obj: Record<string, unknown> | null,
  keys: string[],
): string | null {
  if (!obj) return null;
  for (const k of keys) {
    const s = str(obj[k]);
    if (s) return s;
  }
  return null;
}

/** Pull command from title forms like `Execute \`rm -rf …\``. */
function commandFromTitle(title: string | undefined): string | null {
  if (!title) return null;
  const m = title.match(/^Execute\s+`([\s\S]+)`\s*$/i);
  return m?.[1]?.trim() || null;
}

function prettyJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function looksDestructive(command: string): boolean {
  const c = command.toLowerCase();
  return (
    /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|--recursive)\b/.test(c) ||
    /\bsudo\b/.test(c) ||
    /\bmkfs\b/.test(c) ||
    /\bdd\s+if=/.test(c) ||
    />\s*\/dev\//.test(c) ||
    /\bchmod\s+-R\s+777\b/.test(c) ||
    /\bcurl\b.*\|\s*(ba)?sh\b/.test(c)
  );
}

function categorizeKind(
  kind: string | undefined,
  hasCommand: boolean,
  hasPath: boolean,
  isMcp: boolean,
): PermissionKindCategory {
  if (isMcp) return "mcp";
  const k = (kind ?? "").toLowerCase();
  if (k === "execute" || hasCommand) return "execute";
  if (k === "delete") return "delete";
  if (k === "edit" || k === "write") return "edit";
  if (k === "read" || k === "search" || k === "fetch") return "read";
  if (hasPath && (k === "" || k === "other")) return "edit";
  return "other";
}

function headingFor(
  cat: PermissionKindCategory,
  t: TFunction<"translation">,
): string {
  switch (cat) {
    case "execute":
      return t("permission.heading.execute");
    case "edit":
      return t("permission.heading.edit");
    case "delete":
      return t("permission.heading.delete");
    case "read":
      return t("permission.heading.read");
    case "mcp":
      return t("permission.heading.mcp");
    default:
      return t("permission.heading.other");
  }
}

export type PermissionDisplayInput = {
  title?: string;
  kind?: string;
  rawInput?: unknown;
};

/**
 * Build a readable permission summary from ACP toolCall fields.
 */
export function buildPermissionDisplay(
  input: PermissionDisplayInput,
  t: TFunction<"translation">,
): PermissionDisplay {
  const raw = asRecord(input.rawInput);
  const title = str(input.title);

  // Nested MCP envelope: { variant, tool_name, tool_input }
  const variant = str(raw?.variant);
  const isMcp =
    variant === "UseTool" ||
    variant === "MCPTool" ||
    Boolean(str(raw?.tool_name) && raw?.tool_input != null);

  const mcpToolName = firstString(raw, ["tool_name", "toolName", "name"]);
  const mcpArgs = raw?.tool_input ?? raw?.arguments ?? raw?.args;

  const command =
    firstString(raw, ["command", "cmd"]) ?? commandFromTitle(title ?? undefined);

  const description = firstString(raw, [
    "description",
    "summary",
    "reason",
    "message",
  ]);

  const filePath = firstString(raw, [
    "file_path",
    "filePath",
    "path",
    "target_file",
    "targetFile",
  ]);

  const oldString = firstString(raw, ["old_string", "oldString"]);
  const newString = firstString(raw, ["new_string", "newString"]);
  const content = firstString(raw, ["content"]);

  const category = categorizeKind(
    input.kind,
    Boolean(command),
    Boolean(filePath),
    isMcp,
  );

  const details: PermissionDetail[] = [];
  let purpose: string | null = description;
  let riskNote: string | null = null;

  if (category === "execute" && command) {
    if (!purpose) {
      purpose = t("permission.executePurpose");
    }
    details.push({
      label: t("permission.command"),
      body: command,
      mono: true,
    });
    if (looksDestructive(command)) {
      riskNote = t("permission.destructiveRisk");
    }
    const timeout = raw?.timeout;
    if (typeof timeout === "number" && timeout > 0) {
      details.push({
        label: t("permission.timeout"),
        body: timeout >= 1000 ? `${Math.round(timeout / 1000)}s` : `${timeout}ms`,
      });
    }
    if (raw?.background === true) {
      details.push({
        label: t("permission.mode"),
        body: t("permission.background"),
      });
    }
  } else if (category === "edit" || category === "delete") {
    if (filePath) {
      details.push({
        label:
          category === "delete"
            ? t("permission.pathToDelete")
            : t("permission.file"),
        body: filePath,
        mono: true,
      });
    }
    if (!purpose) {
      purpose =
        category === "delete"
          ? filePath
            ? t("permission.deletePath", { path: filePath })
            : t("permission.deleteFile")
          : filePath
            ? t("permission.editPath", { path: filePath })
            : t("permission.editFile");
    }
    if (oldString != null && newString != null) {
      const preview = `− ${truncate(oldString, 400)}\n+ ${truncate(newString, 400)}`;
      details.push({
        label: t("permission.changePreview"),
        body: preview,
        mono: true,
      });
    } else if (content && category === "edit") {
      details.push({
        label: t("permission.newContentPreview"),
        body: truncate(content, 800),
        mono: true,
      });
    }
  } else if (category === "mcp" || isMcp) {
    const prettyName = mcpToolName
      ? mcpToolName.replace(/__/g, " · ")
      : title ?? t("permission.externalTool");
    if (!purpose) {
      purpose = t("permission.callTool", { name: prettyName });
    }
    details.push({
      label: t("permission.tool"),
      body: mcpToolName ?? prettyName,
      mono: true,
    });
    if (mcpArgs != null && mcpArgs !== "") {
      details.push({
        label: t("permission.arguments"),
        body:
          typeof mcpArgs === "string" ? mcpArgs : prettyJson(mcpArgs),
        mono: true,
      });
    }
  } else if (category === "read" && filePath) {
    if (!purpose) purpose = t("permission.readPath", { path: filePath });
    details.push({
      label: t("permission.path"),
      body: filePath,
      mono: true,
    });
  } else {
    // Fallback: show the best human string + compact payload
    if (!purpose) {
      purpose =
        title ??
        t("permission.approvalPurpose");
    }
    if (command) {
      details.push({
        label: t("permission.command"),
        body: command,
        mono: true,
      });
    }
    if (filePath) {
      details.push({
        label: t("permission.path"),
        body: filePath,
        mono: true,
      });
    }
    if (details.length === 0 && raw) {
      // Prefer a few known keys over full dump
      const interesting = pickInteresting(raw);
      if (interesting) {
        details.push({
          label: t("permission.details"),
          body: interesting,
          mono: true,
        });
      } else {
        details.push({
          label: t("permission.rawRequest"),
          body: truncate(prettyJson(raw), 2000),
          mono: true,
        });
      }
    } else if (details.length === 0 && title && purpose !== title) {
      details.push({
        label: t("permission.action"),
        body: title,
      });
    }
  }

  return {
    category,
    heading: headingFor(category, t),
    purpose,
    details,
    riskNote,
  };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

/** Show a short subset of keys instead of the whole JSON blob. */
function pickInteresting(raw: Record<string, unknown>): string | null {
  const keys = [
    "url",
    "query",
    "pattern",
    "path",
    "prompt",
    "name",
    "id",
    "target_directory",
    "glob",
  ];
  const lines: string[] = [];
  for (const k of keys) {
    const v = raw[k];
    if (v == null) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      lines.push(`${k}: ${v}`);
    }
  }
  return lines.length ? lines.join("\n") : null;
}

/** Friendlier button labels from ACP option kind/name. */
export function permissionOptionLabel(opt: {
  name: string;
  kind: string;
}, t: TFunction<"translation">): string {
  const kind = opt.kind.toLowerCase();
  const name = opt.name.trim();
  if (kind === "allow_once" || /^allow once$/i.test(name)) {
    return t("permission.allowOnce");
  }
  if (kind === "allow_always" || /always allow|allow always/i.test(name)) {
    return t("permission.alwaysAllow");
  }
  if (kind === "reject_once" || /^(reject|deny|no)\b/i.test(name)) {
    return t("permission.deny");
  }
  if (kind === "reject_always") {
    return t("permission.neverAllow");
  }
  return name || t("permission.ok");
}

export function isAllowOption(opt: { name: string; kind: string }): boolean {
  const kind = opt.kind.toLowerCase();
  return (
    kind === "allow_once" ||
    kind === "allow_always" ||
    /allow|yes|approve/i.test(opt.name)
  );
}
